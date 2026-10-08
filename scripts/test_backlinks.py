"""Backlink route regression checks using an isolated in-memory database."""
from __future__ import annotations

import os
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api"))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.routers import notes


class BacklinkTests(unittest.TestCase):
    def test_trimmed_links_match_and_respect_user_and_deletion(self):
        for title in ("Target %_", "한글 제목"):
            with self.subTest(title=title):
                engine = create_engine("sqlite:///:memory:")
                user_id, target_id = uuid.uuid4(), uuid.uuid4()
                source_id = uuid.uuid4()
                with engine.begin() as connection:
                    connection.execute(text(
                        "CREATE TABLE notes (id TEXT, user_id TEXT, title TEXT, content TEXT, deleted_at TEXT, folder_id TEXT)"
                    ))
                    connection.execute(text("CREATE TABLE folders (id TEXT, user_id TEXT, name TEXT, parent_id TEXT, deleted_at TEXT)"))
                    content = f"[[{title}]]\n[[ {title.upper()} ]]\n[[\t{title}\t]]\n[[Other]]"
                    for note_id, owner, deleted in (
                        (source_id, user_id, None),
                        (target_id, user_id, None),
                        (uuid.uuid4(), uuid.uuid4(), None),
                        (uuid.uuid4(), user_id, "2026-10-08"),
                    ):
                        connection.execute(text(
                            "INSERT INTO notes VALUES (:id, :user, :title, :content, :deleted, NULL)"
                        ), {
                            "id": note_id.hex, "user": owner.hex, "title": title if note_id == target_id else "Source",
                            "content": content, "deleted": deleted,
                        })
                with Session(engine) as session, patch.object(
                    notes, "_load_with_relations", return_value=SimpleNamespace(id=target_id, title=title)
                ):
                    rows = notes.list_backlinks(str(target_id), session, SimpleNamespace(id=user_id))
                self.assertEqual([row.line_index for row in rows], [0, 1, 2])
                self.assertTrue(all(row.note_id == source_id for row in rows))
                engine.dispose()


if __name__ == "__main__":
    unittest.main()
