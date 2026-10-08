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
