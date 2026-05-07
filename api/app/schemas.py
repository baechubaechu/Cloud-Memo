import uuid
from datetime import datetime
from typing import Any, List, Literal, Optional

from pydantic import BaseModel, EmailStr, Field


class TokenRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: uuid.UUID
    # `str`, not EmailStr — accepts hostnames without TLD like "admin@local"
    email: str

    model_config = {"from_attributes": True}


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=512)
    parent_id: Optional[uuid.UUID] = None
    sort_order: int = 0


class FolderUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=512)
    parent_id: Optional[uuid.UUID] = None
    sort_order: Optional[int] = None


class FolderOut(BaseModel):
    id: uuid.UUID
    parent_id: Optional[uuid.UUID]
    name: str
    sort_order: int
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)


class TagOut(BaseModel):
    id: uuid.UUID
    name: str
    created_at: datetime
    deleted_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class NoteCreate(BaseModel):
    title: str = ""
    content: str = ""
    folder_id: Optional[uuid.UUID] = None
    tag_ids: List[uuid.UUID] = []


class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    folder_id: Optional[uuid.UUID] = None
    tag_ids: Optional[List[uuid.UUID]] = None
    is_favorite: Optional[bool] = None
    is_archived: Optional[bool] = None
    force_snapshot: bool = False


class AttachmentOut(BaseModel):
    id: uuid.UUID
    original_filename: str
    mime_type: str
    size_bytes: int
    kind: str = "image"
    has_thumbnail: bool = False
    created_at: datetime
    deleted_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class NoteListItem(BaseModel):
    id: uuid.UUID
    title: str
    folder_id: Optional[uuid.UUID]
    is_favorite: bool = False
    is_archived: bool = False
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None
    tags: List[TagOut] = []

    model_config = {"from_attributes": True}


class NoteDetail(BaseModel):
    id: uuid.UUID
    title: str
    content: str
    folder_id: Optional[uuid.UUID]
    note_type: str
    is_favorite: bool = False
    is_archived: bool = False
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None
    tags: List[TagOut] = []
    attachments: List[AttachmentOut] = []

    model_config = {"from_attributes": True}


class NoteVersionOut(BaseModel):
    id: uuid.UUID
    version_index: int
    title: str
    content: str
    reason: str
    created_at: datetime

    model_config = {"from_attributes": True}


class RestoreVersionBody(BaseModel):
    """Body remains optional — version_id may also come as path param."""

    version_id: Optional[uuid.UUID] = None


class NoteTagsBody(BaseModel):
    tag_ids: List[uuid.UUID]


class StorageUsage(BaseModel):
    upload_root: str
    total_bytes: int
    by_kind: dict[str, int]
    attachments_count: int


class ExportManifestEntry(BaseModel):
    id: uuid.UUID
    title: str
    folder: Optional[str]
    tags: List[str]
    is_favorite: bool
    is_archived: bool
    updated_at: datetime
    file_path: str  # relative path inside the export bundle


class ExportManifest(BaseModel):
    generated_at: datetime
    note_count: int
    notes: List[ExportManifestEntry]


class AiJobCreate(BaseModel):
    job_type: str = Field(min_length=1, max_length=64)
    target_note_id: Optional[uuid.UUID] = None
    worker_type: Optional[str] = Field(default=None, max_length=32)
    input_payload: dict[str, Any] = Field(default_factory=dict)


class AiJobOut(BaseModel):
    id: uuid.UUID
    job_type: str
    target_note_id: Optional[uuid.UUID]
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    worker_type: Optional[str]
    input_payload: dict[str, Any]
    result_payload: Optional[dict[str, Any]] = None
    error_message: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]

    model_config = {"from_attributes": True}
