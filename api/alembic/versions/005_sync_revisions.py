"""sync: note revisions, change sequence, tombstones

Revision ID: 005
Revises: 004
Create Date: 2026-10-03

여러 기기 동기화용.
- notes.revision: 제목·본문이 바뀔 때마다 +1. 저장 시 클라이언트가 본 revision 과
  다르면 서버가 3-way 병합한다.
- notes.change_seq: 노트에 어떤 변경이든 생길 때마다 전역 카운터 값을 찍는다.
  클라이언트는 "이 seq 이후 바뀐 것" 만 폴링한다.
- sync_counter: 전역 카운터(단일 행). meta_seq 는 폴더·태그가 마지막으로 바뀐 seq.
- note_tombstones: 영구 삭제된 노트 id (다른 기기가 삭제를 알 수 있게).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("notes", sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("notes", sa.Column("change_seq", sa.BigInteger(), nullable=False, server_default="0"))
    op.create_index("ix_notes_change_seq", "notes", ["change_seq"])

    op.create_table(
        "sync_counter",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("seq", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("meta_seq", sa.BigInteger(), nullable=False, server_default="0"),
    )
    op.execute("INSERT INTO sync_counter (id, seq, meta_seq) VALUES (1, 0, 0)")

    op.create_table(
        "note_tombstones",
        sa.Column("note_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seq", sa.BigInteger(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_note_tombstones_seq", "note_tombstones", ["seq"])


def downgrade() -> None:
    op.drop_index("ix_note_tombstones_seq", table_name="note_tombstones")
    op.drop_table("note_tombstones")
    op.drop_table("sync_counter")
    op.drop_index("ix_notes_change_seq", table_name="notes")
    op.drop_column("notes", "change_seq")
    op.drop_column("notes", "revision")
