"""On-disk storage helpers.

Layout (relative to UPLOAD_DIR, e.g. /opt/memo-cloud/data/uploads):

    images/{note_id}/{att_id}_{safe}.{ext}
    audio/{note_id}/{att_id}_{safe}.{ext}        (future)
    canvas/{note_id}/{att_id}_{safe}.{ext}       (future)
    attachments/{note_id}/{att_id}_{safe}.{ext}  (generic / non-image)
    thumbnails/{note_id}/{att_id}_thumb.jpg

DB stores POSIX-style paths relative to UPLOAD_DIR.
"""
from __future__ import annotations

import io
import uuid
from pathlib import Path
from typing import Iterable, Literal, Optional, Tuple

from app.config import settings

AttachmentKind = Literal["image", "audio", "canvas", "attachment"]
KIND_DIRS = {
    "image": "images",
    "audio": "audio",
    "canvas": "canvas",
    "attachment": "attachments",
}
THUMBS_DIR = "thumbnails"


def upload_root() -> Path:
    root = Path(settings.upload_dir)
    root.mkdir(parents=True, exist_ok=True)
    for sub in (*KIND_DIRS.values(), THUMBS_DIR):
        (root / sub).mkdir(parents=True, exist_ok=True)
    return root


def safe_name(name: str) -> str:
    s = "".join(c for c in name if c.isalnum() or c in "._- ")[:160].strip()
    return s or "file"


def build_attachment_path(note_id: uuid.UUID, original_name: str, kind: AttachmentKind) -> Tuple[str, Path, uuid.UUID]:
    root = upload_root()
    base = root / KIND_DIRS[kind] / str(note_id)
    base.mkdir(parents=True, exist_ok=True)
    att_id = uuid.uuid4()
    abs_path = (base / f"{att_id.hex}_{safe_name(original_name)}").resolve()
    rel_key = abs_path.relative_to(root.resolve()).as_posix()
    return rel_key, abs_path, att_id


def build_thumbnail_path(note_id: uuid.UUID, attachment_id: uuid.UUID) -> Tuple[str, Path]:
    root = upload_root()
    base = root / THUMBS_DIR / str(note_id)
    base.mkdir(parents=True, exist_ok=True)
    abs_path = (base / f"{attachment_id.hex}_thumb.jpg").resolve()
    rel_key = abs_path.relative_to(root.resolve()).as_posix()
    return rel_key, abs_path


def resolve_storage_path(rel_key: str) -> Path:
    root = upload_root().resolve()
    candidate = (root / rel_key).resolve()
    if not str(candidate).startswith(str(root)):
        raise ValueError("Invalid path")
    return candidate


def write_thumbnail_jpeg(image_bytes: bytes, target: Path, max_side: int = 480) -> bool:
    """Best-effort thumbnail. Returns False if Pillow is not installed."""
    try:
        from PIL import Image  # type: ignore
    except Exception:
        return False
    try:
        with Image.open(io.BytesIO(image_bytes)) as im:
            im.thumbnail((max_side, max_side))
            if im.mode in ("RGBA", "P"):
                im = im.convert("RGB")
            target.parent.mkdir(parents=True, exist_ok=True)
            im.save(target, format="JPEG", quality=80, optimize=True)
        return True
    except Exception:
        return False


def iter_kind_sizes() -> Iterable[Tuple[str, int]]:
    """For each top-level kind directory, return (kind_label, total_bytes)."""
    root = upload_root()
    labels = {**KIND_DIRS, "thumbnails": THUMBS_DIR}
    for label, sub in labels.items():
        d = root / sub
        if not d.is_dir():
            yield (label, 0)
            continue
        total = 0
        for p in d.rglob("*"):
            if p.is_file():
                try:
                    total += p.stat().st_size
                except OSError:
                    pass
        yield (label, total)
