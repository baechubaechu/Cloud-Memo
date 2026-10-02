import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, String, Table, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def text_default_false():
    return text("false")


def jsonb_default_empty():
    return text("'{}'::jsonb")


def jsonb_default_empty_array():
    return text("'[]'::jsonb")

note_tags = Table(
    "note_tags",
    Base.metadata,
    Column("note_id", UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", UUID(as_uuid=True), ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    meta: Mapped[dict] = mapped_column("metadata_json", JSONB, nullable=False, default=dict)


class Folder(Base):
    __tablename__ = "folders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("folders.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(512), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, server_default="0", default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    meta: Mapped[dict] = mapped_column("metadata_json", JSONB, nullable=False, default=dict)

    notes: Mapped[List["Note"]] = relationship(back_populates="folder")


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    meta: Mapped[dict] = mapped_column("metadata_json", JSONB, nullable=False, default=dict)

    notes: Mapped[List["Note"]] = relationship(secondary=note_tags, back_populates="tags")


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("folders.id", ondelete="SET NULL"),
        nullable=True,
    )
    note_type: Mapped[str] = mapped_column(String(32), server_default="text", default="text")
    title: Mapped[str] = mapped_column(Text, server_default="", default="")
    content: Mapped[str] = mapped_column(Text, server_default="", default="")
    is_favorite: Mapped[bool] = mapped_column(
        Boolean, server_default=text_default_false(), default=False, nullable=False
    )
    is_archived: Mapped[bool] = mapped_column(
        Boolean, server_default=text_default_false(), default=False, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_versioned_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    meta: Mapped[dict] = mapped_column("metadata_json", JSONB, nullable=False, default=dict)
    # 본문 위에 떠 있는 자유 그림 레이어의 stroke 들. 각 stroke 는 dict 로
    # { id, tool, color, width, opacity, captureWidth, points: [[x,y], ...] }.
    # 본문 텍스트와 무관하므로 NoteVersion 스냅샷 대상에는 넣지 않는다.
    overlay_strokes: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=jsonb_default_empty_array(),
    )

    # 동기화: revision 은 제목·본문 변경마다 +1 (저장 시 병합 판단용),
    # change_seq 는 어떤 변경이든 전역 카운터 값을 찍는다 (폴링용).
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    change_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")

    folder: Mapped[Optional[Folder]] = relationship(back_populates="notes")
    tags: Mapped[List[Tag]] = relationship(secondary=note_tags, back_populates="notes")
    attachments: Mapped[List["Attachment"]] = relationship(back_populates="note")
    versions: Mapped[List["NoteVersion"]] = relationship(
        back_populates="note",
        order_by="NoteVersion.version_index",
    )


class NoteVersion(Base):
    __tablename__ = "note_versions"
    __table_args__ = (UniqueConstraint("note_id", "version_index", name="uq_note_version_index"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    note_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"))
    version_index: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str] = mapped_column(
        "source_kind",
        String(32),
        server_default="periodic_autosave",
        default="periodic_autosave",
    )
    source_ref: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    meta: Mapped[dict] = mapped_column("metadata_json", JSONB, nullable=False, default=dict)

    note: Mapped["Note"] = relationship(back_populates="versions")


class Attachment(Base):
    __tablename__ = "attachments"
    __table_args__ = (UniqueConstraint("storage_path", name="uq_attachments_storage_path"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    note_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"))
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    thumbnail_path: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    kind: Mapped[str] = mapped_column(String(32), server_default="image", default="image", nullable=False)
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    checksum_sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    meta: Mapped[dict] = mapped_column("metadata_json", JSONB, nullable=False, default=dict)

    note: Mapped["Note"] = relationship(back_populates="attachments")


class SyncCounter(Base):
    """전역 변경 카운터 (id=1 단일 행)."""

    __tablename__ = "sync_counter"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    # 폴더·태그가 마지막으로 바뀐 seq.
    meta_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")


class NoteTombstone(Base):
    """영구 삭제된 노트의 흔적 — 다른 기기가 삭제를 알 수 있게 남긴다."""

    __tablename__ = "note_tombstones"

    note_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(BigInteger, nullable=False)
    deleted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AiJob(Base):
    __tablename__ = "ai_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    target_note_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("notes.id", ondelete="SET NULL"), nullable=True
    )
    job_type: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), server_default="queued", default="queued", nullable=False)
    worker_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    input_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=jsonb_default_empty())
    result_payload: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
