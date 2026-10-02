"""Notes router.

Path scheme:
    GET    /notes                                -- list (filters: folder_id, tag_id, favorite, archived, trash)
    POST   /notes                                -- create
    GET    /notes/{id}                           -- detail
    PATCH  /notes/{id}                           -- update (autosave + favorite + archive)
    DELETE /notes/{id}                           -- permanent delete
    GET    /notes/{id}/versions                  -- list snapshots
    POST   /notes/{id}/versions                  -- manual snapshot
    POST   /notes/{id}/restore-version/{vid}     -- replace body with version (creates `restore` snapshot first)
    POST   /notes/{id}/tags                      -- bulk-set tag list
"""
from __future__ import annotations

import uuid as uuid_pkg
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session, defer, selectinload

from app.database import get_db
from app.deps import CurrentUser
from app.models import Attachment, Note, NoteVersion, Tag
from app.schemas import (
    AttachmentOut,
    NoteCreate,
    NoteDetail,
    NoteListItem,
    NoteTagsBody,
    NoteUpdate,
    NoteVersionOut,
    TagOut,
)
from app.services.search_query import split_query as _split_query
from app.services.storage import resolve_storage_path
from app.services.versions import maybe_snapshot_before_update

router = APIRouter(prefix="/notes", tags=["notes"])

Db = Annotated[Session, Depends(get_db)]


def _uid(raw: str) -> uuid_pkg.UUID:
    try:
        return uuid_pkg.UUID(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid UUID") from exc


def _attachment_out(a: Attachment) -> AttachmentOut:
    return AttachmentOut(
        id=a.id,
        original_filename=a.original_filename,
        mime_type=a.mime_type,
        size_bytes=a.size_bytes,
        kind=a.kind,
        has_thumbnail=bool(a.thumbnail_path),
        created_at=a.created_at,
        deleted_at=a.deleted_at,
    )


def _detail(n: Note) -> NoteDetail:
    live_attachments = sorted(
        [a for a in n.attachments if a.deleted_at is None],
        key=lambda a: a.created_at,
        reverse=True,
    )
    return NoteDetail(
        id=n.id,
        title=n.title,
        content=n.content,
        folder_id=n.folder_id,
        note_type=n.note_type,
        is_favorite=n.is_favorite,
        is_archived=n.is_archived,
        created_at=n.created_at,
        updated_at=n.updated_at,
        deleted_at=n.deleted_at,
        tags=[TagOut.model_validate(t) for t in n.tags if t.deleted_at is None],
        attachments=[_attachment_out(a) for a in live_attachments],
        overlay_strokes=list(n.overlay_strokes or []),
    )


def _load_with_relations(db: Session, note_id: uuid_pkg.UUID, user_id: uuid_pkg.UUID) -> Optional[Note]:
    return (
        db.execute(
            select(Note)
            .options(selectinload(Note.tags), selectinload(Note.attachments))
            .where(Note.id == note_id, Note.user_id == user_id)
        )
        .unique()
        .scalar_one_or_none()
    )


def _sync_tags(note: Note, tag_ids: list[uuid_pkg.UUID], db: Session):
    resolved: list[Tag] = []
    for tid in tag_ids:
        t = db.get(Tag, tid)
        if t and t.user_id == note.user_id and t.deleted_at is None:
            resolved.append(t)
    note.tags = resolved


# ---------------- listing ----------------


def _base_list_stmt(user_id: uuid_pkg.UUID, *, trash: bool, archived: Optional[bool]):
    # 목록 응답은 제목·메타·태그만 쓴다. 본문과 그림 stroke 는 읽지 않는다.
    stmt = (
        select(Note)
        .options(selectinload(Note.tags), defer(Note.content), defer(Note.overlay_strokes))
        .where(Note.user_id == user_id)
    )
    stmt = stmt.where(Note.deleted_at.isnot(None) if trash else Note.deleted_at.is_(None))
    if not trash:
        if archived is True:
            stmt = stmt.where(Note.is_archived.is_(True))
        elif archived is False:
            stmt = stmt.where(Note.is_archived.is_(False))
    return stmt


@router.get("", response_model=list[NoteListItem])
def list_notes(
    db: Db,
    me: CurrentUser,
    folder_id: Optional[str] = None,
    tag_id: Optional[str] = None,
    favorite: bool = False,
    archived: Optional[bool] = Query(default=False),
    trash: bool = False,
    q: Optional[str] = None,
):
    stmt = _base_list_stmt(me.id, trash=trash, archived=archived)
    if folder_id:
        stmt = stmt.where(Note.folder_id == _uid(folder_id))
    if tag_id:
        stmt = stmt.join(Note.tags).where(Tag.id == _uid(tag_id))
    if favorite:
        stmt = stmt.where(Note.is_favorite.is_(True))
    if q and len(q.strip()) >= 1:
        tag_tokens, text_q = _split_query(q.strip())
        if text_q:
            like = f"%{text_q}%"
            attachment_match = (
                select(Attachment.note_id)
                .where(Attachment.deleted_at.is_(None))
                .where(Attachment.original_filename.ilike(like))
            )
            text_tag_match = (
                select(Note.id).join(Note.tags).where(Tag.deleted_at.is_(None)).where(Tag.name.ilike(like))
            )
            stmt = stmt.where(
                or_(
                    Note.title.ilike(like),
                    Note.content.ilike(like),
                    Note.id.in_(attachment_match),
                    Note.id.in_(text_tag_match),
                )
            )
        for tok in tag_tokens:
            tag_like = f"%{tok}%"
            one_tag_match = (
                select(Note.id)
                .join(Note.tags)
                .where(Tag.deleted_at.is_(None))
                .where(Tag.name.ilike(tag_like))
            )
            stmt = stmt.where(Note.id.in_(one_tag_match))

    stmt = stmt.order_by(Note.is_favorite.desc(), Note.updated_at.desc())
    rows = list(db.execute(stmt).unique().scalars().all())
    return [
        NoteListItem(
            id=n.id,
            title=n.title,
            folder_id=n.folder_id,
            is_favorite=n.is_favorite,
            is_archived=n.is_archived,
            created_at=n.created_at,
            updated_at=n.updated_at,
            deleted_at=n.deleted_at,
            tags=[TagOut.model_validate(t) for t in n.tags if t.deleted_at is None],
        )
        for n in rows
    ]


@router.post("", response_model=NoteDetail)
def create_note(body: NoteCreate, db: Db, me: CurrentUser):
    n = Note(user_id=me.id, title=body.title, content=body.content, folder_id=body.folder_id)
    db.add(n)
    db.flush()
    _sync_tags(n, body.tag_ids, db)
    db.commit()
    n = _load_with_relations(db, n.id, me.id)
    assert n is not None
    return _detail(n)


@router.get("/{note_id}", response_model=NoteDetail)
def get_note(note_id: Annotated[str, Path()], db: Db, me: CurrentUser):
    n = _load_with_relations(db, _uid(note_id), me.id)
    if not n:
        raise HTTPException(status_code=404, detail="Not found")
    return _detail(n)


@router.patch("/{note_id}", response_model=NoteDetail)
def update_note(body: NoteUpdate, note_id: Annotated[str, Path()], db: Db, me: CurrentUser):
    n = _load_with_relations(db, _uid(note_id), me.id)
    if not n:
        raise HTTPException(status_code=404, detail="Not found")
    if n.deleted_at is not None:
        raise HTTPException(status_code=400, detail="Note is in trash — restore first")

    # exclude_unset=True 로 "필드 미지정"과 "명시적 null" 을 구분한다.
    # 예) {"folder_id": null} 은 루트로 이동하라는 뜻이지 무시 대상이 아님.
    data = body.model_dump(exclude_unset=True)

    title_changed = "title" in data and data["title"] != n.title
    content_changed = "content" in data and data["content"] != n.content
    if title_changed or content_changed:
        maybe_snapshot_before_update(db, n, force=bool(body.force_snapshot), reason="periodic_autosave")
    elif body.force_snapshot:
        maybe_snapshot_before_update(db, n, force=True, reason="manual")

    if "title" in data and data["title"] is not None:
        n.title = data["title"]
    if "content" in data and data["content"] is not None:
        n.content = data["content"]
    if "folder_id" in data:
        n.folder_id = data["folder_id"]
    if "is_favorite" in data and data["is_favorite"] is not None:
        n.is_favorite = bool(data["is_favorite"])
    if "is_archived" in data and data["is_archived"] is not None:
        n.is_archived = bool(data["is_archived"])
    if "tag_ids" in data and data["tag_ids"] is not None:
        _sync_tags(n, data["tag_ids"], db)
    if "overlay_strokes" in data and data["overlay_strokes"] is not None:
        # 그림 레이어는 본문과 별개의 흐름이라 스냅샷을 만들지 않는다. 너무 큰
        # payload 가 들어오는 사고를 막기 위해 매우 큰 배열은 거절한다(상한
        # 50_000 stroke). 일반 사용 케이스(노트당 보통 수백~수천 stroke)는
        # 한참 여유 있는 값.
        new_strokes = data["overlay_strokes"]
        if not isinstance(new_strokes, list):
            raise HTTPException(status_code=400, detail="overlay_strokes must be a list")
        if len(new_strokes) > 50_000:
            raise HTTPException(status_code=413, detail="too many strokes")
        n.overlay_strokes = new_strokes

    db.commit()
    n2 = _load_with_relations(db, n.id, me.id)
    assert n2 is not None
    return _detail(n2)


@router.delete("/{note_id}", response_model=NoteDetail)
def delete_note(note_id: Annotated[str, Path()], db: Db, me: CurrentUser):
    n = _load_with_relations(db, _uid(note_id), me.id)
    if not n:
        raise HTTPException(status_code=404, detail="Not found")
    # 응답 스냅샷은 먼저 만든다.
    out = _detail(n)
    # 노트 삭제 전에 첨부 파일(원본/썸네일)을 디스크에서 정리한다.
    for a in n.attachments:
        try:
            path = resolve_storage_path(a.storage_path)
            if path.exists():
                path.unlink()
        except Exception:
            pass
        if a.thumbnail_path:
            try:
                thumb = resolve_storage_path(a.thumbnail_path)
                if thumb.exists():
                    thumb.unlink()
            except Exception:
                pass
    # SQLAlchemy가 FK를 NULL로 만들려고 하며 제약조건을 깨뜨리지 않도록
    # 하위 레코드(버전/첨부)를 먼저 명시적으로 지운다. 태그 연결(note_tags)은
    # db.delete(n) 이 로드된 n.tags 를 보고 직접 지운다 — 여기서 먼저 지우면
    # "1행 삭제 예상, 0행" StaleDataError 로 태그 달린 노트 삭제가 500 이 된다.
    db.execute(delete(NoteVersion).where(NoteVersion.note_id == n.id))
    db.execute(delete(Attachment).where(Attachment.note_id == n.id))
    db.delete(n)
    db.commit()
    return out


# ---------------- versions ----------------


@router.get("/{note_id}/versions", response_model=list[NoteVersionOut])
def list_versions(note_id: Annotated[str, Path()], db: Db, me: CurrentUser):
    n = _load_with_relations(db, _uid(note_id), me.id)
    if not n:
        raise HTTPException(status_code=404, detail="Not found")
    rows = (
        db.execute(
            select(NoteVersion).where(NoteVersion.note_id == n.id).order_by(NoteVersion.version_index.desc())
        )
        .scalars()
        .all()
    )
    return [NoteVersionOut.model_validate(r) for r in rows]


@router.post("/{note_id}/versions", response_model=NoteVersionOut)
def snapshot_note(note_id: Annotated[str, Path()], db: Db, me: CurrentUser):
    n = _load_with_relations(db, _uid(note_id), me.id)
    if not n:
        raise HTTPException(status_code=404, detail="Not found")
    if n.deleted_at is not None:
        raise HTTPException(status_code=400, detail="Note is in trash")
    v = maybe_snapshot_before_update(db, n, force=True, reason="manual")
    db.commit()
    if v is None:
        raise HTTPException(status_code=500, detail="Failed to snapshot")
    db.refresh(v)
    return NoteVersionOut.model_validate(v)


@router.post("/{note_id}/restore-version/{version_id}", response_model=NoteDetail)
def restore_version(
    note_id: Annotated[str, Path()],
    version_id: Annotated[str, Path()],
    db: Db,
    me: CurrentUser,
):
    n = _load_with_relations(db, _uid(note_id), me.id)
    if not n:
        raise HTTPException(status_code=404, detail="Not found")
    if n.deleted_at is not None:
        raise HTTPException(status_code=400, detail="Restore the note before restoring versions")

    v = db.get(NoteVersion, _uid(version_id))
    if not v or v.note_id != n.id:
        raise HTTPException(status_code=404, detail="Version not found")

    maybe_snapshot_before_update(db, n, force=True, reason="restore")
    n.title = v.title
    n.content = v.content
    db.commit()
    n2 = _load_with_relations(db, n.id, me.id)
    assert n2 is not None
    return _detail(n2)


# ---------------- bulk tag assign ----------------


@router.post("/{note_id}/tags", response_model=NoteDetail)
def set_tags(body: NoteTagsBody, note_id: Annotated[str, Path()], db: Db, me: CurrentUser):
    n = _load_with_relations(db, _uid(note_id), me.id)
    if not n:
        raise HTTPException(status_code=404, detail="Not found")
    _sync_tags(n, body.tag_ids, db)
    db.commit()
    n2 = _load_with_relations(db, n.id, me.id)
    assert n2 is not None
    return _detail(n2)
