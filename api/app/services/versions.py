"""Versioning helpers.

`reason` follows the spec vocabulary:
    manual, before_delete, before_ai_edit, restore, periodic_autosave
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional
import uuid as uuid_pkg

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Note, NoteVersion

VersionReason = Literal[
    "manual",
    "before_delete",
    "before_ai_edit",
    "restore",
    "periodic_autosave",
]


def next_version_index(db: Session, note_id: uuid_pkg.UUID) -> int:
    m = db.execute(select(func.max(NoteVersion.version_index)).where(NoteVersion.note_id == note_id)).scalar()
    return (int(m) + 1) if m is not None else 1


def maybe_snapshot_before_update(
    db: Session,
    note: Note,
    *,
    force: bool = False,
    reason: VersionReason = "periodic_autosave",
    source_ref: Optional[uuid_pkg.UUID] = None,
) -> Optional[NoteVersion]:
    """Save current title/content as a NoteVersion if enough time has passed (or forced)."""
    now = datetime.now(timezone.utc)

    if not force and note.last_versioned_at is not None:
        elapsed = (now - note.last_versioned_at).total_seconds()
        if elapsed < settings.version_autosave_min_seconds:
            return None

    v = NoteVersion(
        note_id=note.id,
        version_index=next_version_index(db, note.id),
        title=note.title,
        content=note.content,
        reason=reason,
        source_ref=source_ref,
        meta={},
    )
    db.add(v)
    note.last_versioned_at = now
    return v
