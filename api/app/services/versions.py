"""버전(스냅샷) 정책.

스냅샷은 제목·본문만 담는다 (첨부·그림 레이어는 복제하지 않는다).

만들어지는 때
    - 하루 한 번: 마지막 스냅샷에서 24시간이 지난 뒤 처음 고칠 때, 고치기 직전 상태.
    - before_merge: 다른 기기의 변경과 병합하기 직전 (병합이 어색할 때의 복구 수단).
    - restore: 버전을 되돌리기 직전.
    - before_ai_edit: AI 작업 결과를 적용하기 직전.

보관: 7일. 스냅샷을 만들 때마다 그 노트의 오래된 것을 지운다.

`reason` 값: periodic_autosave(=하루 스냅샷), before_merge, restore, before_ai_edit.
manual / before_delete 는 예전 데이터에만 남아 있다.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal, Optional
import uuid as uuid_pkg

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import Note, NoteVersion

SNAPSHOT_INTERVAL = timedelta(hours=24)
RETENTION = timedelta(days=7)

VersionReason = Literal[
    "manual",
    "before_delete",
    "before_ai_edit",
    "restore",
    "periodic_autosave",
    "before_merge",
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
    """현재 제목·본문을 스냅샷으로 남긴다. force 가 아니면 하루에 한 번만."""
    now = datetime.now(timezone.utc)

    if not force and note.last_versioned_at is not None:
        if now - note.last_versioned_at < SNAPSHOT_INTERVAL:
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
    # 보관 기간이 지난 스냅샷 정리.
    db.execute(
        delete(NoteVersion).where(NoteVersion.note_id == note.id, NoteVersion.created_at < now - RETENTION)
    )
    return v
