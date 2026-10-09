"""Exercise template settings and note creation using disposable local API records."""
from concurrent.futures import ThreadPoolExecutor
import argparse
import json
from pathlib import Path
import uuid
from datetime import datetime, timedelta, timezone

import httpx


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--cleanup", action="store_true")
    args = parser.parse_args()
    record_path = Path(__file__).resolve().parents[1] / "data/dev-logs/template-qa.json"
    prefix = "template-test-" + uuid.uuid4().hex[:8]
    notes, folders, templates = [], [], []
    with httpx.Client(base_url="http://localhost:8000", timeout=30) as client:
        login = client.post("/api/auth/login", data={"username": "local", "password": "1234"})
        login.raise_for_status()
        client.headers["Authorization"] = "Bearer " + login.json()["access_token"]
        if args.cleanup:
            record = json.loads(record_path.read_text(encoding="utf-8"))
            rows = client.get("/api/notes", params={"archived": "false"}).json() + client.get("/api/notes", params={"archived": "true"}).json()
            record["notes"] = list(set(record["notes"]) | {n["id"] for n in rows if n["folder_id"] in record["folders"] or n["title"] == record["prefix"] + " UI root"})
            for kind in ["notes", "templates", "folders"]:
                for value in reversed(record[kind]):
                    result = client.delete(f"/api/{kind}/{value}")
                    assert result.status_code in (200, 404), result.text
            record_path.unlink()
            print("Template QA fixtures removed")
            return

        def request(method, path, data=None):
            result = client.request(method, path, json=data)
            result.raise_for_status()
            return result.json()

        def folder(name, parent=None):
            value = request("POST", "/api/folders", {"name": name, "parent_id": parent})["id"]
            folders.append(value)
            return value

        def template(name, title, content, **extra):
            before = {t["id"] for t in request("GET", "/api/templates")["templates"]}
            result = request("POST", "/api/templates", {"name": name, "title": title, "content": content, **extra})
            value = next(t["id"] for t in result["templates"] if t["id"] not in before)
            templates.append(value)
            return value

        def note(**data):
            result = request("POST", "/api/notes", data)
            notes.append(result["id"])
            return result

        completed = False
        try:
            parent = folder(prefix)
            child = folder("하위 폴더", parent)
            first = template(prefix + " 회의", "회의록", "# 안건\n\n- [ ] 결정사항", target_folder_id=parent)
            second = template(prefix + " 일지", "일지", "# 오늘의 기록", target_folder_id=child)
            settings = request("GET", "/api/templates")
            assert "folder_defaults" not in settings
            assert next(t for t in settings["templates"] if t["id"] == first)["target_folder_id"] == parent
            removed_endpoint = client.put(f"/api/templates/defaults/{parent}", json={"template_id": first})
            assert removed_endpoint.status_code == 404
            ordinary = note()
            assert ordinary["folder_id"] is None and ordinary["content"] == ""
            generated = note(folder_id=parent, template_id=first)
            assert generated["title"] == "회의록" and generated["content"] == "# 안건\n\n- [ ] 결정사항"
            duplicate = note(folder_id=parent, template_id=first)
            assert duplicate["title"] == "회의록 2"
            child_note = note(folder_id=child)
            assert child_note["title"] == "무제 노트" and child_note["content"] == ""
            explicit = note(folder_id=child, template_id=second)
            assert explicit["title"] == "일지" and explicit["content"] == "# 오늘의 기록"
            overridden = note(folder_id=parent, template_id=first, title="원하는 제목", content="직접 입력")
            assert overridden["title"] == "원하는 제목" and overridden["content"] == "직접 입력"
            wiki = note(folder_id=parent, title="링크에서 지정")
            assert wiki["title"] == "링크에서 지정" and wiki["content"] == ""
            body = {"name": prefix + " 회의", "title": "회의록", "content": "수정된 양식", "target_folder_id": parent}
            request("PUT", f"/api/templates/{first}", body)
            assert request("GET", f"/api/notes/{generated['id']}")["content"] == generated["content"]
            assert note(folder_id=parent, template_id=first)["content"] == "수정된 양식"
            # Parallel note creation uses the same user lock as ordinary name checks.
            def parallel_create(_):
                return request("POST", "/api/notes", {"folder_id": parent, "template_id": first})
            with ThreadPoolExecutor(max_workers=3) as pool:
                concurrent = list(pool.map(parallel_create, range(3)))
            notes.extend(n["id"] for n in concurrent)
            assert len({n["title"] for n in concurrent}) == 3
            reserved = client.put(f"/api/templates/{first}", json={**body, "shortcut": "Mod+KeyZ"})
            assert reserved.status_code == 422
            used = {t["shortcut"] for t in request("GET", "/api/templates")["templates"]}
            shortcut = next(f"Mod+Alt+Shift+Key{key}" for key in "ABCDEFGHIJKLMNOPQRSTUVWXYZ" if f"Mod+Alt+Shift+Key{key}" not in used)
            request("PUT", f"/api/templates/{first}", {**body, "shortcut": shortcut})
            duplicate_shortcut = client.put(f"/api/templates/{second}", json={"name": prefix + " 일지", "shortcut": shortcut})
            assert duplicate_shortcut.status_code == 409
            missing = client.post("/api/notes", json={"template_id": str(uuid.uuid4()), "folder_id": parent})
            assert missing.status_code == 404
            invalid_folder = client.post("/api/templates", json={"name": prefix + " invalid", "target_folder_id": str(uuid.uuid4())})
            assert invalid_folder.status_code == 404
            variable_body = {"name": prefix + " 일지", "title": "일지 {{date}}", "content": "# {{title}}\n{{date}} {{time}}\n{{unknown}}", "target_folder_id": child}
            request("PUT", f"/api/templates/{second}", variable_body)
            before = datetime.now(timezone(timedelta(hours=9)))
            dated = note(folder_id=child, template_id=second, template_timezone_offset=-540)
            after = datetime.now(timezone(timedelta(hours=9)))
            assert dated["title"] in {"일지 " + moment.strftime("%Y-%m-%d") for moment in (before, after)}
            assert dated["content"] in {f"# {dated['title']}\n{moment:%Y-%m-%d %H:%M}\n{{{{unknown}}}}" for moment in (before, after)}
            dated_copy = note(folder_id=child, template_id=second, template_timezone_offset=-540)
            assert dated_copy["content"].startswith("# " + dated_copy["title"] + "\n")
            assert dated_copy["title"] != dated["title"]
            raw = note(folder_id=child, template_id=second, title="직접 {{date}}", content="{{date}}")
            assert raw["title"] == "직접 {{date}}" and raw["content"] == "{{date}}"
            invalid_offset = client.post("/api/notes", json={"template_id": second, "template_timezone_offset": 841})
            assert invalid_offset.status_code == 422
            deleted = request("DELETE", f"/api/templates/{first}")
            templates.remove(first)
            assert all(t["id"] != first for t in deleted["templates"])
            assert note(folder_id=parent)["content"] == ""
            assert request("GET", f"/api/notes/{generated['id']}")["content"] == generated["content"]
            print("PASS: persisted templates/target folders, blank ordinary notes, removed folder defaults, numbered/concurrent titles, independent copies, validation, deletion cleanup")
            completed = True
            if args.keep:
                record_path.write_text(json.dumps({"notes": notes, "folders": folders, "templates": templates, "prefix": prefix}, ensure_ascii=False), encoding="utf-8")
                print(prefix)
        finally:
            if not args.keep or not completed:
                for value in notes:
                    client.delete(f"/api/notes/{value}").raise_for_status()
                for value in templates:
                    client.delete(f"/api/templates/{value}").raise_for_status()
                for value in reversed(folders):
                    client.delete(f"/api/folders/{value}").raise_for_status()


if __name__ == "__main__":
    main()
