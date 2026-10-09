"""Live backlink path regression, with optional browser-QA fixtures."""
import argparse
import json
from pathlib import Path
import uuid

import httpx

RECORD = Path(__file__).resolve().parents[1] / "data/dev-logs/wikilink-qa.json"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--cleanup", action="store_true")
    args = parser.parse_args()
    with httpx.Client(base_url="http://localhost:8000", timeout=30) as client:
        response = client.post("/api/auth/login", data={"username": "local", "password": "1234", "grant_type": "password"})
        response.raise_for_status()
        client.headers["Authorization"] = f"Bearer {response.json()['access_token']}"
        record = {"notes": [], "folders": []}

        def cleanup():
            for note_id in record["notes"]:
                result = client.delete(f"/api/notes/{note_id}")
                assert result.status_code in (200, 404), result.text
            for folder_id in reversed(record["folders"]):
                result = client.delete(f"/api/folders/{folder_id}")
                assert result.status_code in (200, 404), result.text

        if args.cleanup:
            record = json.loads(RECORD.read_text(encoding="utf-8"))
            cleanup()
            RECORD.unlink()
            print("QA fixtures removed")
            return

        def folder(name, parent=None):
            result = client.post("/api/folders", json={"name": name, "parent_id": parent})
            result.raise_for_status()
            data = result.json()
            record["folders"].append(data["id"])
            return data["id"]

        def note(title, folder_id, content=""):
            result = client.post("/api/notes", json={"title": title, "folder_id": folder_id, "content": content})
            result.raise_for_status()
            data = result.json()
            record["notes"].append(data["id"])
            return data["id"]

        completed = False
        try:
            base_name = f"경로확인-{uuid.uuid4().hex[:8]}"
            base = folder(base_name)
            work, personal = folder("업무", base), folder("개인", base)
            target_a = note("회의록", work, "업무 회의록의 내용")
            target_b = note("회의록", personal, "개인 회의록의 내용")
            source_name = f"위키링크 확인 {base_name}"
            source = note(source_name, work, f"[[/{base_name}/개인/회의록]]\n[[회의록]]")
            root_source = note(f"루트 참조 {base_name}", None, f"[[/{base_name}/업무/회의록]]\n[[회의록]]")
            a = client.get(f"/api/notes/{target_a}/backlinks")
            b = client.get(f"/api/notes/{target_b}/backlinks")
            a.raise_for_status()
            b.raise_for_status()
            actual_a = {(row["note_id"], row["line_index"]) for row in a.json()}
            actual_b = {(row["note_id"], row["line_index"]) for row in b.json()}
            assert actual_a == {(source, 1), (root_source, 0)}, ("work backlinks", actual_a)
            assert actual_b == {(source, 0)}, ("personal backlinks", actual_b)
            if not args.keep:
                original = client.get(f"/api/notes/{source}").json()
                client.patch(f"/api/notes/{root_source}", json={"is_archived": True}).raise_for_status()
                new_title = "새 회의/메모%"
                new_path = f"/{base_name}/업무/새 회의%2F메모%25"
                renamed = client.patch(f"/api/notes/{target_a}", json={"title": new_title})
                renamed.raise_for_status()
                assert renamed.json()["updated_link_note_count"] == 2, renamed.text
                conflict_note = note("이름 충돌 확인", work)
                conflict = client.patch(f"/api/notes/{target_a}", json={"title": "이름 충돌 확인"})
                assert conflict.status_code == 409, conflict.text
                assert client.get(f"/api/notes/{target_a}").json()["title"] == new_title
                changed = client.get(f"/api/notes/{source}").json()
                assert changed["content"] == f"[[/{base_name}/개인/회의록]]\n[[{new_path}]]", changed
                assert changed["revision"] > original["revision"]
                assert changed["change_seq"] > original["change_seq"]
                root_content = client.get(f"/api/notes/{root_source}").json()["content"]
                assert root_content == f"[[{new_path}]]\n[[회의록]]", root_content
                versions = client.get(f"/api/notes/{source}/versions").json()
                assert any(v["reason"] == "before_link_update" and v["content"] == original["content"] for v in versions)
                # An editor holding an old revision must preserve the server's link rewrite.
                stale = client.patch(f"/api/notes/{source}", json={
                    "content": original["content"] + "\n추가 내용",
                    "base_revision": original["revision"], "base_content": original["content"],
                })
                stale.raise_for_status()
                assert f"[[{new_path}]]" in stale.json()["content"] and "추가 내용" in stale.json()["content"], stale.text
                moved = client.patch(f"/api/notes/{target_a}", json={"folder_id": None})
                moved.raise_for_status()
                assert moved.json()["updated_link_note_count"] == 2, moved.text
                new_root_path = "/새 회의%2F메모%25"
                assert f"[[{new_root_path}]]" in client.get(f"/api/notes/{source}").json()["content"]
                no_op = client.patch(f"/api/notes/{target_a}", json={"title": new_title})
                no_op.raise_for_status()
                assert no_op.json()["updated_link_note_count"] is None
                backlinks = client.get(f"/api/notes/{target_a}/backlinks").json()
                assert {(x["note_id"], x["line_index"]) for x in backlinks} == {(source, 1), (root_source, 0)}
                client.patch(f"/api/notes/{target_a}", json={"folder_id": work}).raise_for_status()
                target_versions = client.get(f"/api/notes/{target_a}/versions").json()
                old_version = next(v for v in target_versions if v["title"] == "회의록")
                restored = client.post(f"/api/notes/{target_a}/restore-version/{old_version['id']}")
                restored.raise_for_status()
                assert restored.json()["updated_link_note_count"] == 2, restored.text
                assert f"[[/{base_name}/업무/회의록]]" in client.get(f"/api/notes/{source}").json()["content"]
                # A parent folder change rewrites all nested targets in one pass,
                # but counts each referencing note only once.
                renamed_base = base_name + "-수정"
                folder_rename = client.patch(f"/api/folders/{base}", json={"name": renamed_base})
                folder_rename.raise_for_status()
                assert folder_rename.json()["updated_link_note_count"] == 2, folder_rename.text
                content_after = client.get(f"/api/notes/{source}").json()["content"]
                assert f"[[/{renamed_base}/개인/회의록]]" in content_after
                assert f"[[/{renamed_base}/업무/회의록]]" in content_after
                destination_name = "이동대상-" + uuid.uuid4().hex[:8]
                destination = folder(destination_name)
                folder_move = client.patch(f"/api/folders/{base}", json={"parent_id": destination})
                folder_move.raise_for_status()
                assert folder_move.json()["updated_link_note_count"] == 2, folder_move.text
                nested_prefix = f"/{destination_name}/{renamed_base}"
                nested_content = client.get(f"/api/notes/{source}").json()["content"]
                assert f"[[{nested_prefix}/개인/회의록]]" in nested_content
                assert f"[[{nested_prefix}/업무/회의록]]" in nested_content
                cycle = client.patch(f"/api/folders/{base}", json={"parent_id": work})
                assert cycle.status_code == 400, cycle.text
                missing = client.patch(f"/api/folders/{base}", json={"parent_id": str(uuid.uuid4())})
                assert missing.status_code == 400, missing.text
                sibling = folder("중복 폴더", destination)
                folder_conflict = client.patch(f"/api/folders/{base}", json={"name": "중복 폴더"})
                assert folder_conflict.status_code == 409, folder_conflict.text
                assert client.get(f"/api/notes/{source}").json()["content"] == nested_content
                root_move = client.patch(f"/api/folders/{base}", json={"parent_id": None})
                root_move.raise_for_status()
                assert root_move.json()["updated_link_note_count"] == 2, root_move.text
                sort_only = client.patch(f"/api/folders/{base}", json={"sort_order": 1})
                sort_only.raise_for_status()
                assert sort_only.json()["updated_link_note_count"] is None
                no_op_folder = client.patch(f"/api/folders/{base}", json={"name": renamed_base})
                no_op_folder.raise_for_status()
                assert no_op_folder.json()["updated_link_note_count"] is None
                assert {(x["note_id"], x["line_index"]) for x in client.get(f"/api/notes/{target_a}/backlinks").json()} == {(source, 1), (root_source, 0)}
                print("PASS: parent folder rename/move/root move rewrites descendants, unique note counts, archive links, conflict/cycle guards, no-op behavior")
                print("PASS: rename/move rewrites only resolved links, counts notes, includes archives, snapshots, revisions, stale-edit merge, backlinks")
            record.update({"source_name": source_name, "base_name": base_name, "target_a": target_a, "target_b": target_b})
            print("PASS: qualified backlinks select the correct folder; legacy local links work; ambiguous links are excluded")
            completed = True
            if args.keep:
                RECORD.parent.mkdir(parents=True, exist_ok=True)
                RECORD.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
                print(json.dumps({"source_name": source_name, "base_name": base_name}, ensure_ascii=False))
        finally:
            if not args.keep or not completed:
                cleanup()


if __name__ == "__main__":
    main()
