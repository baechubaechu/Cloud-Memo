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
    fid = _parse_uid(folder_id)
    folder = db.get(Folder, fid)
    if not folder or folder.user_id != me.id:
        raise HTTPException(status_code=404, detail="Not found")

    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        folder.name = str(data["name"]).strip()
    if "parent_id" in data:
        folder.parent_id = data["parent_id"]
    if "sort_order" in data:
        folder.sort_order = int(data["sort_order"])
    touch_meta(db)
    db.commit()
    db.refresh(folder)
    return folder


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
