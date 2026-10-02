from datetime import datetime, timezone
import uuid as uuid_pkg
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.models import Tag
from app.schemas import TagCreate, TagOut
from app.services.sync import touch_meta

router = APIRouter(prefix="/tags", tags=["tags"])

Db = Annotated[Session, Depends(get_db)]


def _tid(raw: str) -> uuid_pkg.UUID:
    try:
        return uuid_pkg.UUID(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid UUID") from exc


@router.get("", response_model=list[TagOut])
def list_tags(db: Db, me: CurrentUser, trash: bool = False):
    stmt = select(Tag).where(Tag.user_id == me.id)
    stmt = stmt.where(Tag.deleted_at.isnot(None) if trash else Tag.deleted_at.is_(None))
    stmt = stmt.order_by(Tag.name)
    rows = db.execute(stmt).scalars().all()
    return [TagOut(id=t.id, name=t.name, created_at=t.created_at, deleted_at=t.deleted_at) for t in rows]


@router.post("", response_model=TagOut)
def create_tag(body: TagCreate, db: Db, me: CurrentUser):
    row = Tag(user_id=me.id, name=body.name.strip(), meta={})
    db.add(row)
    touch_meta(db)
    db.commit()
    db.refresh(row)
    return TagOut(id=row.id, name=row.name, created_at=row.created_at, deleted_at=row.deleted_at)


@router.delete("/{tag_id}", response_model=TagOut)
def trash_tag(tag_id: Annotated[str, Path()], db: Db, me: CurrentUser):
    tid = _tid(tag_id)
    tag = db.get(Tag, tid)
    if not tag or tag.user_id != me.id:
        raise HTTPException(status_code=404, detail="Not found")
    tag.deleted_at = datetime.now(timezone.utc)
    touch_meta(db)
    db.commit()
    db.refresh(tag)
    return TagOut(id=tag.id, name=tag.name, created_at=tag.created_at, deleted_at=tag.deleted_at)


@router.post("/{tag_id}/restore", response_model=TagOut)
def restore_tag(tag_id: Annotated[str, Path()], db: Db, me: CurrentUser):
    tid = _tid(tag_id)
    tag = db.get(Tag, tid)
    if not tag or tag.user_id != me.id:
        raise HTTPException(status_code=404, detail="Not found")
    tag.deleted_at = None
    touch_meta(db)
    db.commit()
    db.refresh(tag)
    return TagOut(id=tag.id, name=tag.name, created_at=tag.created_at, deleted_at=tag.deleted_at)
