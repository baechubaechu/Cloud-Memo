"""add trigram indexes for fast search

Revision ID: 003
Revises: 002
Create Date: 2026-05-05
"""
from typing import Sequence, Union

from alembic import op

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_notes_title_trgm ON notes USING gin (title gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_notes_content_trgm ON notes USING gin (content gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_tags_name_trgm_live ON tags USING gin (name gin_trgm_ops) WHERE deleted_at IS NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_attachments_filename_trgm_live ON attachments USING gin (original_filename gin_trgm_ops) WHERE deleted_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_attachments_filename_trgm_live")
    op.execute("DROP INDEX IF EXISTS ix_tags_name_trgm_live")
    op.execute("DROP INDEX IF EXISTS ix_notes_content_trgm")
    op.execute("DROP INDEX IF EXISTS ix_notes_title_trgm")
