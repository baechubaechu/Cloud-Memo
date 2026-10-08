"""Folder-scoped note names, serialized across concurrent requests for one user."""
from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Folder, Note, User

UNTITLED = "무제 노트"


def name_key(title: str) -> str:
    return title.strip().lower()


def lock_note_names(db: Session, user_id: uuid.UUID) -> None:
    # A user row exists even when the target folder has no notes yet.
    db.execute(select(User.id).where(User.id == user_id).with_for_update()).scalar_one()


def choose_note_title(
    db: Session,
    user_id: uuid.UUID,
    folder_id: uuid.UUID | None,
    title: str,
    *,
    exclude_id: uuid.UUID | None = None,
    fallback_on_conflict: bool = False,
) -> str:
    """Call under lock_note_names, before mutating a note's title or folder."""
    if folder_id is not None:
        folder = db.get(Folder, folder_id)
        if not folder or folder.user_id != user_id or folder.deleted_at is not None:
            raise HTTPException(status_code=404, detail="대상 폴더를 찾을 수 없습니다.")
    query = select(Note.title).where(
        Note.user_id == user_id, Note.folder_id == folder_id, Note.deleted_at.is_(None)
    )
    if exclude_id is not None:
        query = query.where(Note.id != exclude_id)
    occupied = {name_key(value) for value in db.execute(query).scalars()}
    requested = title.strip()
    if requested:
        if name_key(requested) not in occupied:
            return requested
        if not fallback_on_conflict:
            raise HTTPException(
                status_code=409,
                detail=f"같은 폴더에 '{requested}' 이름의 노트가 이미 있습니다. 다른 이름을 입력해 주세요.",
            )
    candidate = UNTITLED
    number = 2
    while name_key(candidate) in occupied:
        candidate = f"{UNTITLED} {number}"
        number += 1
    return candidate
