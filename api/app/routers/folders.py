import uuid as uuid_pkg
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.models import Folder, Note
from app.schemas import FolderCreate, FolderOut, FolderUpdate
from app.services.sync import touch_meta, touch_note
from app.services.note_names import choose_note_title, lock_note_names, name_key
from app.services.versions import maybe_snapshot_before_update
from app.services.wikilinks import FolderRef, NoteRef, LinkIndex, encode_part, folder_path, rewrite_link_paths

router = APIRouter(prefix="/folders", tags=["folders"])

Db = Annotated[Session, Depends(get_db)]


def _parse_uid(raw: str) -> uuid_pkg.UUID:
    try:
        return uuid_pkg.UUID(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid UUID") from exc


@router.get("", response_model=list[FolderOut])
def list_folders(db: Db, me: CurrentUser, trash: bool = False):
    q = select(Folder).where(Folder.user_id == me.id)
    if trash:
        q = q.where(Folder.deleted_at.isnot(None))
    else:
        q = q.where(Folder.deleted_at.is_(None))
    q = q.order_by(Folder.sort_order, Folder.created_at)
    return list(db.execute(q).scalars().all())


@router.post("", response_model=FolderOut)
def create_folder(body: FolderCreate, db: Db, me: CurrentUser):
    f = Folder(
        user_id=me.id,
        name=body.name.strip(),
        parent_id=body.parent_id,
        sort_order=body.sort_order,
    )
    db.add(f)
    touch_meta(db)
    db.commit()
    db.refresh(f)
    return f


@router.patch("/{folder_id}", response_model=FolderOut)
def update_folder(body: FolderUpdate, folder_id: Annotated[str, Path()], db: Db, me: CurrentUser):
    lock_note_names(db, me.id)
    fid = _parse_uid(folder_id)
    folder = db.get(Folder, fid)
    if not folder or folder.user_id != me.id:
        raise HTTPException(status_code=404, detail="Not found")

    data = body.model_dump(exclude_unset=True)
    if folder.deleted_at is not None:
        raise HTTPException(status_code=400, detail="Restore the folder first")
    next_name = str(data["name"]).strip() if data.get("name") is not None else folder.name
    if not next_name:
        raise HTTPException(status_code=400, detail="폴더 이름을 입력해 주세요.")
    next_parent = data.get("parent_id", folder.parent_id)
    all_folders = list(db.scalars(select(Folder).where(Folder.user_id == me.id, Folder.deleted_at.is_(None))))
    by_id = {f.id: f for f in all_folders}
    seen = {fid}
    ancestor = next_parent
    while ancestor is not None:
        if ancestor in seen:
            raise HTTPException(status_code=400, detail="폴더를 자기 자신이나 하위 폴더로 이동할 수 없습니다.")
        if ancestor not in by_id:
            raise HTTPException(status_code=400, detail="대상 폴더를 찾을 수 없습니다.")
        seen.add(ancestor)
        ancestor = by_id[ancestor].parent_id
    path_changed = next_name != folder.name or next_parent != folder.parent_id
    if path_changed and any(f.id != fid and f.parent_id == next_parent and name_key(f.name) == name_key(next_name)
                            for f in all_folders):
        raise HTTPException(status_code=409, detail="같은 위치에 같은 이름의 폴더가 이미 있습니다.")
    old_folders = [FolderRef(f.id, f.name, f.parent_id) for f in all_folders]
    link_notes = list(db.scalars(select(Note).where(Note.user_id == me.id, Note.deleted_at.is_(None)))) if path_changed else []
    note_refs = [NoteRef(n.id, n.title, n.folder_id) for n in link_notes]
    old_index = LinkIndex(note_refs, old_folders)
    if "name" in data and data["name"]:
        folder.name = str(data["name"]).strip()
    if "parent_id" in data:
        folder.parent_id = data["parent_id"]
    if "sort_order" in data:
        folder.sort_order = int(data["sort_order"])
    updated_count = None
    if path_changed:
        new_folders = [FolderRef(f.id, f.name, f.parent_id) for f in all_folders]
        new_index = LinkIndex(note_refs, new_folders)
        new_paths = {}
        for note in note_refs:
            old_parent = folder_path(note.folder_id, old_folders)
            new_parent = folder_path(note.folder_id, new_folders)
            if old_parent is None or new_parent is None or old_parent == new_parent:
                continue
            new_path = f"{new_parent}/{encode_part(note.title)}"
            if len(new_index.resolve(new_path, note.folder_id)) != 1:
                raise HTTPException(status_code=409, detail="변경 후 노트 경로가 중복됩니다. 폴더나 노트 이름을 먼저 정리해 주세요.")
            new_paths[note.id] = new_path
        updated_count = 0
        for source in link_notes:
            rewritten = rewrite_link_paths(source.content, source.folder_id, old_index, new_paths)
            if rewritten == source.content:
                continue
            maybe_snapshot_before_update(db, source, force=True, reason="before_link_update")
            source.content = rewritten
            touch_note(db, source, text_changed=True)
            updated_count += 1
    touch_meta(db)
    db.commit()
    db.refresh(folder)
    result = FolderOut.model_validate(folder)
    result.updated_link_note_count = updated_count
    return result


@router.delete("/{folder_id}", response_model=FolderOut)
def delete_folder(folder_id: Annotated[str, Path()], db: Db, me: CurrentUser):
    lock_note_names(db, me.id)
    fid = _parse_uid(folder_id)
    folder = db.get(Folder, fid)
    if not folder or folder.user_id != me.id:
        raise HTTPException(status_code=404, detail="Not found")
    # 폴더 삭제 시 내부 항목은 유지하고 소속만 해제한다.
    child_folders = db.execute(
        select(Folder).where(Folder.user_id == me.id, Folder.parent_id == fid)
    ).scalars().all()
    child_notes = db.execute(
        select(Note).where(Note.user_id == me.id, Note.folder_id == fid)
    ).scalars().all()
    incoming_names: set[str] = set()
    for n in child_notes:
        if n.deleted_at is not None:
            continue
        title = choose_note_title(db, me.id, None, n.title, exclude_id=n.id)
        key = name_key(title)
        if key in incoming_names:
            raise HTTPException(status_code=409, detail="폴더를 삭제하면 루트에 같은 이름의 노트가 생깁니다. 노트 이름을 먼저 변경해 주세요.")
        incoming_names.add(key)
    for ch in child_folders:
        ch.parent_id = None
    for n in child_notes:
        previous_title = n.title
        if n.deleted_at is None and not n.title.strip():
            n.title = choose_note_title(db, me.id, None, "", exclude_id=n.id)
        n.folder_id = None
        touch_note(db, n, text_changed=n.title != previous_title)
    out = FolderOut.model_validate(folder)
    db.delete(folder)
    touch_meta(db)
    db.commit()
    return out


@router.post("/{folder_id}/restore", response_model=FolderOut)
def restore_folder(folder_id: Annotated[str, Path()], db: Db, me: CurrentUser):
    fid = _parse_uid(folder_id)
    folder = db.get(Folder, fid)
    if not folder or folder.user_id != me.id:
        raise HTTPException(status_code=404, detail="Not found")
    folder.deleted_at = None
    db.commit()
    db.refresh(folder)
    return folder
