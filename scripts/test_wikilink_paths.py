"""Shared resolution cases keep server backlinks aligned with client navigation."""
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api"))
from app.services.wikilinks import FolderRef, LinkIndex, NoteRef
from app.services.sync import merge_text


class WikilinkPathTests(unittest.TestCase):
    def test_stale_boundary_edits_after_link_rewrite(self):
        base = "본문\n[[/옛 이름]]"
        changed = "본문\n[[/길게 바뀐 새 이름]]"
        self.assertEqual(merge_text(base, changed, base + "\n추가"), changed + "\n추가")
        self.assertEqual(merge_text(base, changed, "추가\n" + base), "추가\n" + changed)
        self.assertEqual(merge_text(base, changed, base), changed)
        self.assertEqual(merge_text(base, base, base + "추가"), base + "추가")
        self.assertEqual(merge_text("A\nB\nC", "new A\nB\nC", "A\nB\nnew C"), "new A\nB\nnew C")

    def test_shared_cases(self):
        fixture = json.loads((Path(__file__).parent / "fixtures/wikilink_paths.json").read_text(encoding="utf-8"))
        index = LinkIndex([NoteRef(**n) for n in fixture["notes"]], [FolderRef(**f) for f in fixture["folders"]])
        for case in fixture["cases"]:
            with self.subTest(target=case["target"], source=case["source"]):
                self.assertEqual([n.id for n in index.resolve(case["target"], case["source"])], case["ids"])


if __name__ == "__main__":
    unittest.main()
