"""Export plumbing.

Reads-only for now; later a worker can render Markdown/Obsidian bundles
to /opt/memo-cloud/data/exports based on the manifest produced here.
"""
from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.deps import CurrentUser
from app.models import Folder, Note
from app.schemas import ExportManifest, ExportManifestEntry

router = APIRouter(prefix="/export", tags=["export"])

Db = Annotated[Session, Depends(get_db)]


def _slug(name: str) -> str:
    out = []
    for ch in name.strip().lower():
        if ch.isalnum():
            out.append(ch)
        elif ch in (" ", "-", "_"):
            out.append("-")
    s = "".join(out).strip("-")
    return s or "untitled"


def _build_entries(db: Session, user_id) -> tuple[list[ExportManifestEntry], list[tuple[str, str]]]:
    folder_lookup = {
        f.id: f.name
        for f in db.execute(select(Folder).where(Folder.user_id == user_id)).scalars().all()
    }
    notes = (
        db.execute(
            select(Note)
            .options(selectinload(Note.tags))
            .where(Note.user_id == user_id, Note.deleted_at.is_(None))
            .order_by(Note.updated_at.desc())
        )
        .unique()
        .scalars()
        .all()
    )

    entries: list[ExportManifestEntry] = []
    files: list[tuple[str, str]] = []
    for n in notes:
        folder_name = folder_lookup.get(n.folder_id, "") if n.folder_id else ""
        rel_dir = f"{_slug(folder_name)}/" if folder_name else ""
        rel_file = f"{rel_dir}{_slug(n.title or 'untitled')}-{n.id.hex[:8]}.md"
        body_lines = []
        front = {
            "id": str(n.id),
            "title": n.title,
            "tags": [t.name for t in n.tags if t.deleted_at is None],
            "favorite": n.is_favorite,
            "archived": n.is_archived,
            "folder": folder_name,
            "created_at": n.created_at.isoformat(),
            "updated_at": n.updated_at.isoformat(),
        }
        body_lines.append("---")
        for k, v in front.items():
            body_lines.append(f"{k}: {json.dumps(v, ensure_ascii=False)}")
        body_lines.append("---")
        body_lines.append("")
        body_lines.append(n.content or "")
        files.append((rel_file, "\n".join(body_lines)))
        entries.append(
            ExportManifestEntry(
                id=n.id,
                title=n.title,
                folder=folder_name or None,
                tags=[t.name for t in n.tags if t.deleted_at is None],
                is_favorite=n.is_favorite,
                is_archived=n.is_archived,
                updated_at=n.updated_at,
                file_path=rel_file,
            )
        )
    return entries, files


@router.get("/manifest", response_model=ExportManifest)
def manifest(db: Db, me: CurrentUser):
    entries, _ = _build_entries(db, me.id)
    return ExportManifest(
        generated_at=datetime.now(timezone.utc),
        note_count=len(entries),
        notes=entries,
    )


@router.get("/markdown")
def markdown_zip(db: Db, me: CurrentUser):
    entries, files = _build_entries(db, me.id)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        manifest_payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "note_count": len(entries),
            "notes": [e.model_dump(mode="json") for e in entries],
        }
        zf.writestr("manifest.json", json.dumps(manifest_payload, ensure_ascii=False, indent=2))
        for path, content in files:
            zf.writestr(path, content)
    buf.seek(0)
    headers = {"Content-Disposition": 'attachment; filename="cloud-memo-export.zip"'}
    return StreamingResponse(buf, media_type="application/zip", headers=headers)
