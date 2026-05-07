"""AI job queue.

The API never calls AI directly — workers (local AI, OpenClaw, etc.) poll this queue
and post results back. AI edits MUST create a `before_ai_edit` snapshot before applying.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any, Optional
import uuid as uuid_pkg

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.models import AiJob, Note
from app.schemas import AiJobCreate, AiJobOut
from app.services.versions import maybe_snapshot_before_update

router = APIRouter(prefix="/ai-jobs", tags=["ai"])

Db = Annotated[Session, Depends(get_db)]


def _uid(raw: str) -> uuid_pkg.UUID:
    try:
        return uuid_pkg.UUID(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid UUID") from exc


class AiJobUpdate(BaseModel):
    status: Optional[str] = None
    worker_type: Optional[str] = None
    result_payload: Optional[dict[str, Any]] = None
    error_message: Optional[str] = None
    apply_to_target: bool = False


@router.get("", response_model=list[AiJobOut])
def list_jobs(db: Db, me: CurrentUser, status: Optional[str] = Query(default=None), limit: int = 100):
    stmt = select(AiJob).where(AiJob.user_id == me.id).order_by(AiJob.created_at.desc()).limit(limit)
    if status:
        stmt = stmt.where(AiJob.status == status)
    rows = db.execute(stmt).scalars().all()
    return [AiJobOut.model_validate(r) for r in rows]


@router.post("", response_model=AiJobOut)
def create_job(body: AiJobCreate, db: Db, me: CurrentUser):
    if body.target_note_id is not None:
        note = db.get(Note, body.target_note_id)
        if not note or note.user_id != me.id:
            raise HTTPException(status_code=404, detail="target_note_id not found")

    job = AiJob(
        user_id=me.id,
        target_note_id=body.target_note_id,
        job_type=body.job_type,
        worker_type=body.worker_type,
        status="queued",
        input_payload=body.input_payload,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return AiJobOut.model_validate(job)


@router.get("/{job_id}", response_model=AiJobOut)
def get_job(job_id: Annotated[str, Path()], db: Db, me: CurrentUser):
    j = db.get(AiJob, _uid(job_id))
    if not j or j.user_id != me.id:
        raise HTTPException(status_code=404, detail="Not found")
    return AiJobOut.model_validate(j)


@router.patch("/{job_id}", response_model=AiJobOut)
def update_job(body: AiJobUpdate, job_id: Annotated[str, Path()], db: Db, me: CurrentUser):
    j = db.get(AiJob, _uid(job_id))
    if not j or j.user_id != me.id:
        raise HTTPException(status_code=404, detail="Not found")

    if body.status is not None:
        j.status = body.status
        now = datetime.now(timezone.utc)
        if body.status == "running" and j.started_at is None:
            j.started_at = now
        if body.status in ("completed", "failed", "cancelled"):
            j.completed_at = now
    if body.worker_type is not None:
        j.worker_type = body.worker_type
    if body.result_payload is not None:
        j.result_payload = body.result_payload
    if body.error_message is not None:
        j.error_message = body.error_message

    if body.apply_to_target and j.target_note_id and j.result_payload:
        note = db.get(Note, j.target_note_id)
        if note and note.user_id == me.id and note.deleted_at is None:
            maybe_snapshot_before_update(db, note, force=True, reason="before_ai_edit", source_ref=j.id)
            new_title = j.result_payload.get("title")
            new_content = j.result_payload.get("content")
            if isinstance(new_title, str):
                note.title = new_title
            if isinstance(new_content, str):
                note.content = new_content

    db.commit()
    db.refresh(j)
    return AiJobOut.model_validate(j)
