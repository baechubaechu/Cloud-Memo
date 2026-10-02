"""동기화 폴링.

클라이언트는 몇 초마다 `GET /sync/changes?since=<seq>` 를 부른다. 바뀐 게 없으면
카운터 한 행만 읽고 끝난다.
"""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, defer, selectinload

from app.database import get_db
from app.deps import CurrentUser
from app.models import Note, NoteTombstone, SyncCounter
from app.routers.notes import list_item
from app.schemas import SyncChanges

router = APIRouter(prefix="/sync", tags=["sync"])

Db = Annotated[Session, Depends(get_db)]


@router.get("/changes", response_model=SyncChanges)
def changes(db: Db, me: CurrentUser, since: Optional[int] = Query(default=None, ge=0)):
    counter = db.get(SyncCounter, 1)
    seq = int(counter.seq) if counter else 0
    # since 없음 = 첫 호출. 현재 위치만 알려준다 (목록은 클라이언트가 이미 읽었다).
    if since is None or since == seq:
        return SyncChanges(seq=seq)
    # 서버 카운터가 클라이언트보다 작다 = DB 가 교체됨. 전부 다시 읽게 한다.
    if since > seq:
        return SyncChanges(seq=seq, meta_changed=True)

    notes = (
        db.execute(
            select(Note)
            .options(selectinload(Note.tags), defer(Note.content), defer(Note.overlay_strokes))
            .where(Note.user_id == me.id, Note.change_seq > since, Note.deleted_at.is_(None))
            .order_by(Note.change_seq)
        )
        .unique()
        .scalars()
        .all()
    )
    deleted = (
        db.execute(
            select(NoteTombstone.note_id).where(NoteTombstone.user_id == me.id, NoteTombstone.seq > since)
        )
        .scalars()
        .all()
    )
    return SyncChanges(
        seq=seq,
        meta_changed=bool(counter and counter.meta_seq > since),
        notes=[list_item(n) for n in notes],
        deleted=list(deleted),
    )
