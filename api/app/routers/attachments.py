import hashlib
import mimetypes
import uuid as uuid_pkg
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Path, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import CurrentUser
from app.models import Attachment, Note
from app.services.storage import (
    AttachmentKind,
    build_attachment_path,
    build_thumbnail_path,
    resolve_storage_path,
    write_thumbnail_jpeg,
)
from app.services.sync import touch_note

router = APIRouter(tags=["attachments"])

Db = Annotated[Session, Depends(get_db)]


def _nid(raw: str) -> uuid_pkg.UUID:
    try:
        return uuid_pkg.UUID(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid UUID") from exc


def _kind_from_mime(content_type: str) -> AttachmentKind:
    if content_type.startswith("image/"):
        return "image"
    if content_type.startswith("audio/"):
        return "audio"
    return "attachment"


@router.post("/notes/{note_id}/attachments", response_model=dict)
def upload_attachment(
    note_id: Annotated[str, Path()],
    db: Db,
    me: CurrentUser,
    file: UploadFile = File(...),
):
    n = db.get(Note, _nid(note_id))
    if not n or n.user_id != me.id:
        raise HTTPException(status_code=404, detail="Not found")
    if n.deleted_at is not None:
        raise HTTPException(status_code=400, detail="Note is in trash")

    content_type = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    kind = _kind_from_mime(content_type)

    # 동기 핸들러(스레드풀)에서 돌려 썸네일 생성 중에도 다른 요청이 막히지 않게 한다.
    body = file.file.read()
    max_b = settings.max_upload_mb * 1024 * 1024
    if len(body) > max_b:
        raise HTTPException(status_code=413, detail="File too large")

    storage_key, abs_path, att_id = build_attachment_path(n.id, file.filename or "attachment", kind)
    abs_path.write_bytes(body)
    checksum = hashlib.sha256(body).hexdigest()

    thumbnail_key = None
    if kind == "image":
        thumbnail_key, thumb_abs = build_thumbnail_path(n.id, att_id)
        if not write_thumbnail_jpeg(body, thumb_abs):
            thumbnail_key = None  # Pillow not available — skip silently

    att = Attachment(
        id=att_id,
        user_id=me.id,
        note_id=n.id,
        original_filename=file.filename or "attachment",
        storage_path=storage_key,
        thumbnail_path=thumbnail_key,
        kind=kind,
        mime_type=content_type,
        size_bytes=len(body),
        checksum_sha256=checksum,
        meta={},
    )
    db.add(att)
    touch_note(db, n)
    db.commit()
    db.refresh(att)
    return {
        "id": str(att.id),
        "original_filename": att.original_filename,
        "kind": att.kind,
        "has_thumbnail": bool(att.thumbnail_path),
    }


@router.delete("/attachments/{attachment_id}", response_model=dict)
def delete_attachment(attachment_id: Annotated[str, Path()], db: Db, me: CurrentUser):
    """첨부를 영구 삭제한다 (휴지통 없음). DB 행을 먼저 지우고 파일을 정리한다."""
    aid = _nid(attachment_id)
    a = db.get(Attachment, aid)
    if not a or a.user_id != me.id:
        raise HTTPException(status_code=404, detail="Not found")
    keys = [k for k in (a.storage_path, a.thumbnail_path) if k]
    note = db.get(Note, a.note_id)
    db.delete(a)
    if note is not None:
        touch_note(db, note)
    db.commit()
    for key in keys:
        try:
            resolve_storage_path(key).unlink(missing_ok=True)
        except (OSError, ValueError):
            pass
    return {"ok": True}


@router.get("/attachments/{attachment_id}/download")
def download_attachment(attachment_id: Annotated[str, Path()], db: Db, me: CurrentUser):
    aid = _nid(attachment_id)
    row = db.execute(select(Attachment).where(Attachment.id == aid)).scalar_one_or_none()
    if not row or row.user_id != me.id:
        raise HTTPException(status_code=404, detail="Not found")
    if row.deleted_at is not None:
        raise HTTPException(status_code=410, detail="Attachment removed")
    path = resolve_storage_path(row.storage_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Missing file")
    return FileResponse(path, filename=row.original_filename, media_type=row.mime_type or "application/octet-stream")


@router.get("/attachments/{attachment_id}/thumbnail")
def download_thumbnail(attachment_id: Annotated[str, Path()], db: Db, me: CurrentUser):
    aid = _nid(attachment_id)
    row = db.execute(select(Attachment).where(Attachment.id == aid)).scalar_one_or_none()
    if not row or row.user_id != me.id:
        raise HTTPException(status_code=404, detail="Not found")
    if not row.thumbnail_path:
        # Fallback to original (browser can scale on its own).
        return download_attachment(attachment_id, db, me)
    path = resolve_storage_path(row.thumbnail_path)
    if not path.is_file():
        return download_attachment(attachment_id, db, me)
    return FileResponse(path, filename=f"thumb-{row.original_filename}.jpg", media_type="image/jpeg")
