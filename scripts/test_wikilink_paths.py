"""Shared resolution cases keep server backlinks aligned with client navigation."""
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api"))
from app.services.wikilinks import FolderRef, LinkIndex, NoteRef


class WikilinkPathTests(unittest.TestCase):
    def test_shared_cases(self):
        fixture = json.loads((Path(__file__).parent / "fixtures/wikilink_paths.json").read_text(encoding="utf-8"))
        index = LinkIndex([NoteRef(**n) for n in fixture["notes"]], [FolderRef(**f) for f in fixture["folders"]])
        for case in fixture["cases"]:
            with self.subTest(target=case["target"], source=case["source"]):
                self.assertEqual([n.id for n in index.resolve(case["target"], case["source"])], case["ids"])


if __name__ == "__main__":
    unittest.main()
