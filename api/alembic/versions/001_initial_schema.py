"""initial_schema

Revision ID: 001
Revises:
Create Date: 2026-05-05

Core memo schema with soft deletes, versioning, FTS on notes, attachment metadata JSONB placeholders.
Large files live on disk (/data/uploads); DB stores paths + metadata only.

Future-ready (document only until needed): ai_jobs, calendar links, markdown export manifests,
local_ai_worker, OpenClaw hooks — extend via nullable JSON columns + additive migrations.

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

json_default = sa.text("'{}'::jsonb")


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            nullable=False,
        ),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), server_default=json_default, nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )

    op.create_table(
        "folders",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(length=512), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), server_default=json_default, nullable=False),
        sa.ForeignKeyConstraint(["parent_id"], ["folders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_folders_user_id", "folders", ["user_id"])

    op.create_table(
        "tags",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), server_default=json_default, nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tags_user_id", "tags", ["user_id"])
    op.execute(
        "CREATE UNIQUE INDEX uq_tags_user_name_live ON tags (user_id, name) WHERE deleted_at IS NULL;"
    )

    op.create_table(
        "notes",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("folder_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "note_type",
            sa.String(length=32),
            server_default="text",
            nullable=False,
        ),
        sa.Column("title", sa.Text(), server_default="", nullable=False),
        sa.Column("content", sa.Text(), server_default="", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_versioned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), server_default=json_default, nullable=False),
        sa.ForeignKeyConstraint(["folder_id"], ["folders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notes_user_id", "notes", ["user_id"])
    op.create_index("ix_notes_folder_id", "notes", ["folder_id"])

    op.execute(
        """
        ALTER TABLE notes ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (
          setweight(to_tsvector('simple', coalesce(title, '')), 'A')
          ||
          setweight(to_tsvector('simple', coalesce(content, '')), 'B')
        ) STORED;
        """
    )
    op.create_index(
        "ix_notes_search_vector",
        "notes",
        ["search_vector"],
        unique=False,
        postgresql_using="gin",
    )

    op.create_table(
        "note_tags",
        sa.Column("note_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tag_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["note_id"], ["notes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("note_id", "tag_id"),
    )

    op.create_table(
        "note_versions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            nullable=False,
        ),
        sa.Column("note_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_index", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "source_kind",
            sa.String(length=32),
            server_default="autosave",
            nullable=False,
        ),
        sa.Column("source_ref", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "metadata_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=json_default,
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["note_id"], ["notes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("note_id", "version_index", name="uq_note_version_index"),
    )
    op.create_index("ix_note_versions_note_id", "note_versions", ["note_id"])

    op.create_table(
        "attachments",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("note_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("original_filename", sa.String(length=512), nullable=False),
        sa.Column("storage_path", sa.String(length=1024), nullable=False),
        sa.Column("mime_type", sa.String(length=128), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("checksum_sha256", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "metadata_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=json_default,
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["note_id"], ["notes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_path", name="uq_attachments_storage_path"),
    )
    op.create_index("ix_attachments_note_id", "attachments", ["note_id"])


def downgrade() -> None:
    op.drop_index("ix_attachments_note_id", table_name="attachments")
    op.drop_table("attachments")

    op.drop_index("ix_note_versions_note_id", table_name="note_versions")
    op.drop_table("note_versions")

    op.drop_table("note_tags")

    op.drop_index("ix_notes_search_vector", table_name="notes")
    op.execute("ALTER TABLE notes DROP COLUMN search_vector")

    op.drop_index("ix_notes_folder_id", table_name="notes")
    op.drop_index("ix_notes_user_id", table_name="notes")
    op.drop_table("notes")

    op.execute("DROP INDEX IF EXISTS uq_tags_user_name_live")
    op.drop_index("ix_tags_user_id", table_name="tags")
    op.drop_table("tags")

    op.drop_index("ix_folders_user_id", table_name="folders")
    op.drop_table("folders")

    op.drop_table("users")

    op.execute('DROP EXTENSION IF EXISTS "uuid-ossp";')
