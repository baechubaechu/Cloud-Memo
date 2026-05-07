"""favorites, archive, attachment thumbnails, ai_jobs

Revision ID: 002
Revises: 001
Create Date: 2026-05-05

Brings the schema in line with the personal cloud memo spec:
- notes.is_favorite, notes.is_archived (with partial indexes)
- attachments.thumbnail_path
- ai_jobs table (queued from API, processed by future worker / OpenClaw / local AI)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "notes",
        sa.Column(
            "is_favorite",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "notes",
        sa.Column(
            "is_archived",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.execute(
        "CREATE INDEX ix_notes_is_favorite_live ON notes (user_id, updated_at DESC) WHERE is_favorite AND deleted_at IS NULL"
    )
    op.execute(
        "CREATE INDEX ix_notes_is_archived_live ON notes (user_id, updated_at DESC) WHERE is_archived AND deleted_at IS NULL"
    )

    op.add_column(
        "attachments",
        sa.Column("thumbnail_path", sa.String(length=1024), nullable=True),
    )
    op.add_column(
        "attachments",
        sa.Column(
            "kind",
            sa.String(length=32),
            nullable=False,
            server_default="image",
        ),
    )

    op.create_table(
        "ai_jobs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("target_note_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("job_type", sa.String(length=64), nullable=False),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="queued",
        ),
        sa.Column("worker_type", sa.String(length=32), nullable=True),
        sa.Column(
            "input_payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "result_payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_note_id"], ["notes.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_jobs_user_id", "ai_jobs", ["user_id"])
    op.create_index("ix_ai_jobs_status", "ai_jobs", ["status"])
    op.create_index("ix_ai_jobs_target_note_id", "ai_jobs", ["target_note_id"])


def downgrade() -> None:
    op.drop_index("ix_ai_jobs_target_note_id", table_name="ai_jobs")
    op.drop_index("ix_ai_jobs_status", table_name="ai_jobs")
    op.drop_index("ix_ai_jobs_user_id", table_name="ai_jobs")
    op.drop_table("ai_jobs")

    op.drop_column("attachments", "kind")
    op.drop_column("attachments", "thumbnail_path")

    op.execute("DROP INDEX IF EXISTS ix_notes_is_archived_live")
    op.execute("DROP INDEX IF EXISTS ix_notes_is_favorite_live")
    op.drop_column("notes", "is_archived")
    op.drop_column("notes", "is_favorite")
