"""Top-level search router.

ILIKE-based across:
- note title
- note body
- tag names
- attachment file names

Results: same shape as /notes list (NoteListItem). Trash and archive
are excluded by default — pass `trash=true` or `archived=true` to include.
"""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, defer, selectinload

from app.database import get_db
from app.deps import CurrentUser
from app.models import Attachment, Note, Tag
from app.schemas import NoteListItem, TagOut
from app.services.search_query import split_query as _split_query

router = APIRouter(tags=["search"])

Db = Annotated[Session, Depends(get_db)]


@router.get("/search", response_model=list[NoteListItem])
def search(
    db: Db,
    me: CurrentUser,
    q: str = Query(min_length=1, max_length=200),
    trash: bool = False,
    archived: Optional[bool] = False,
    limit: int = Query(default=100, ge=1, le=500),
):
    tag_tokens, text_q = _split_query(q.strip())
    stmt = (
        select(Note)
        .options(selectinload(Note.tags), defer(Note.content), defer(Note.overlay_strokes))
        .where(Note.user_id == me.id)
    )
    stmt = stmt.where(Note.deleted_at.isnot(None) if trash else Note.deleted_at.is_(None))
    if not trash:
        if archived is True:
            stmt = stmt.where(Note.is_archived.is_(True))
        elif archived is False:
            stmt = stmt.where(Note.is_archived.is_(False))

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

    stmt = stmt.order_by(Note.updated_at.desc()).limit(limit)

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
