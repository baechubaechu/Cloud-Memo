"""Storage usage report (filesystem + DB metadata)."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.models import Attachment
from app.schemas import StorageUsage
from app.services.storage import iter_kind_sizes, upload_root

router = APIRouter(prefix="/storage", tags=["storage"])

Db = Annotated[Session, Depends(get_db)]


@router.get("/usage", response_model=StorageUsage)
def usage(db: Db, me: CurrentUser):
    by_kind = {label: int(size) for label, size in iter_kind_sizes()}
    total = sum(by_kind.values())
    count = (
        db.execute(
            select(func.count(Attachment.id)).where(Attachment.user_id == me.id, Attachment.deleted_at.is_(None))
        ).scalar()
        or 0
    )
    return StorageUsage(
        upload_root=str(upload_root()),
        total_bytes=total,
        by_kind=by_kind,
        attachments_count=int(count),
    )
