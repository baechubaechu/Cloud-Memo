"""End-to-end smoke test against a running memo-api."""
from __future__ import annotations

import io
import json
import sys
import time
import zipfile
from pathlib import Path

import httpx

BASE = "http://localhost:8000"
EMAIL = "admin@local"
PASSWORD = "1234"


def must(label: str, ok: bool, detail: object = "") -> None:
    mark = "OK " if ok else "FAIL"
    print(f"[{mark}] {label}", "" if not detail else f"-> {detail}")
    if not ok:
        sys.exit(1)


def main() -> None:
    with httpx.Client(base_url=BASE, timeout=15.0) as client:
        r = client.get("/api/health")
        must("health", r.status_code == 200, r.text)

        r = client.post(
            "/api/auth/login",
            data={"username": EMAIL, "password": PASSWORD, "grant_type": "password"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        must("login", r.status_code == 200, r.text)
        token = r.json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        r = client.get("/api/auth/me", headers=h)
        must("me", r.status_code == 200 and r.json()["email"] == EMAIL, r.text)

        r = client.post("/api/folders", headers=h, json={"name": "수집함"})
        must("folder.create", r.status_code == 200, r.text)
        folder_id = r.json()["id"]

        r = client.post("/api/tags", headers=h, json={"name": "아이디어"})
        must("tag.create", r.status_code == 200, r.text)
        tag_id = r.json()["id"]

        r = client.post(
            "/api/notes",
            headers=h,
            json={
                "title": "first note",
                "content": "처음 작성한 메모입니다.",
                "folder_id": folder_id,
                "tag_ids": [tag_id],
            },
        )
        must("note.create", r.status_code == 200, r.text)
        note = r.json()
        note_id = note["id"]
        must("note.has tag", any(t["id"] == tag_id for t in note["tags"]))
        must("note.has folder", note["folder_id"] == folder_id)

        # Update body — should not snapshot (interval 120s, fresh note).
        r = client.patch(
            f"/api/notes/{note_id}",
            headers=h,
            json={"title": "first note", "content": "추가 본문 v2"},
        )
        must("note.patch v2", r.status_code == 200, r.text)

        # Force a manual snapshot.
        r = client.post(f"/api/notes/{note_id}/versions", headers=h)
        must("note.snapshot manual", r.status_code == 200, r.text)
        manual_v = r.json()
        must("snapshot.reason=manual", manual_v["reason"] == "manual", manual_v)

        # Patch again — content changes, should NOT make new version (within window) ...
        # Force another snapshot reasoning by force_snapshot.
        r = client.patch(
            f"/api/notes/{note_id}",
            headers=h,
            json={"content": "추가 본문 v3", "force_snapshot": True},
        )
        must("note.patch v3 force", r.status_code == 200, r.text)

        r = client.get(f"/api/notes/{note_id}/versions", headers=h)
        must("versions.list", r.status_code == 200, r.text)
        versions = r.json()
        must("versions >= 2", len(versions) >= 2, len(versions))

        # Restore to oldest version.
        oldest = versions[-1]
        r = client.post(
            f"/api/notes/{note_id}/restore-version/{oldest['id']}",
            headers=h,
        )
        must("note.restore-version", r.status_code == 200, r.text)
        restored = r.json()
        must("restore body matches", restored["content"] == oldest["content"], (restored["content"], oldest["content"]))

        # Search by content.
        r = client.get("/api/search", headers=h, params={"q": "처음"})
        must("search content", r.status_code == 200 and any(item["id"] == note_id for item in r.json()), r.text)

        # Search by tag name.
        r = client.get("/api/search", headers=h, params={"q": "아이디어"})
        must("search tag", r.status_code == 200 and any(item["id"] == note_id for item in r.json()), r.text)

        # Favorite + archive.
        r = client.patch(f"/api/notes/{note_id}", headers=h, json={"is_favorite": True})
        must("note.favorite", r.status_code == 200 and r.json()["is_favorite"] is True, r.text)
        r = client.get("/api/notes", headers=h, params={"favorite": "true"})
        must("list.favorite", any(it["id"] == note_id for it in r.json()), r.text)

        r = client.patch(f"/api/notes/{note_id}", headers=h, json={"is_archived": True})
        must("note.archive", r.status_code == 200 and r.json()["is_archived"] is True, r.text)
        r = client.get("/api/notes", headers=h, params={"archived": "true"})
        must("list.archive", any(it["id"] == note_id for it in r.json()), r.text)
        # Default list (archived=false) excludes it.
        r = client.get("/api/notes", headers=h)
        must("list.default excludes archived", not any(it["id"] == note_id for it in r.json()), r.text)
        # Un-archive for the rest of the test.
        client.patch(f"/api/notes/{note_id}", headers=h, json={"is_archived": False})

        # Image upload (1x1 PNG).
        png = bytes.fromhex(
            "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA63"
            "F8FFFFFFFFFFFFFF1F0007FB05FE2BB6CD7C0000000049454E44AE426082"
        )
        files = {"file": ("pixel.png", png, "image/png")}
        r = client.post(f"/api/notes/{note_id}/attachments", headers=h, files=files)
        must("attachment.upload", r.status_code == 200, r.text)
        att_id = r.json()["id"]

        r = client.get(f"/api/attachments/{att_id}/download", headers=h)
        must("attachment.download", r.status_code == 200 and r.content == png, r.headers)

        r = client.get(f"/api/attachments/{att_id}/thumbnail", headers=h)
        must("attachment.thumbnail", r.status_code == 200, r.headers)

        # Storage usage.
        r = client.get("/api/storage/usage", headers=h)
        must("storage.usage", r.status_code == 200, r.text)
        usage = r.json()
        must("usage.total_bytes >= upload size", usage["total_bytes"] >= len(png), usage)

        # Trash + restore.
        r = client.delete(f"/api/notes/{note_id}", headers=h)
        must("note.trash", r.status_code == 200 and r.json()["deleted_at"] is not None, r.text)
        r = client.get("/api/notes", headers=h, params={"trash": "true"})
        must("list.trash", any(it["id"] == note_id for it in r.json()), r.text)
        r = client.post(f"/api/notes/{note_id}/restore", headers=h)
        must("note.restore", r.status_code == 200 and r.json()["deleted_at"] is None, r.text)

        # Verify before_delete snapshot is in the timeline.
        r = client.get(f"/api/notes/{note_id}/versions", headers=h)
        reasons = [v["reason"] for v in r.json()]
        must("versions include before_delete", "before_delete" in reasons, reasons)
        must("versions include restore", "restore" in reasons, reasons)
        must("versions include manual", "manual" in reasons, reasons)

        # Markdown export.
        r = client.get("/api/export/markdown", headers=h)
        must("export.markdown 200", r.status_code == 200, r.headers)
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        names = zf.namelist()
        must("export contains manifest.json", "manifest.json" in names, names)
        manifest = json.loads(zf.read("manifest.json"))
        must("export.note_count >= 1", manifest["note_count"] >= 1, manifest)

        # AI job lifecycle.
        r = client.post(
            "/api/ai-jobs",
            headers=h,
            json={
                "job_type": "summarize",
                "target_note_id": note_id,
                "input_payload": {"prompt": "요약해줘"},
            },
        )
        must("ai_jobs.create", r.status_code == 200, r.text)
        job_id = r.json()["id"]

        r = client.patch(
            f"/api/ai-jobs/{job_id}",
            headers=h,
            json={
                "status": "completed",
                "worker_type": "smoke",
                "result_payload": {"title": "first note", "content": "AI가 다시 쓴 본문"},
                "apply_to_target": True,
            },
        )
        must("ai_jobs.apply", r.status_code == 200, r.text)
        r = client.get(f"/api/notes/{note_id}", headers=h)
        must("note has ai content applied", r.json()["content"] == "AI가 다시 쓴 본문", r.text)
        r = client.get(f"/api/notes/{note_id}/versions", headers=h)
        reasons = [v["reason"] for v in r.json()]
        must("versions include before_ai_edit", "before_ai_edit" in reasons, reasons)

        print("\nALL SMOKE TESTS PASSED")


if __name__ == "__main__":
    main()
