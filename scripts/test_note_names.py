"""Exercise note-name rules against the running local API; clean up only test data."""
from concurrent.futures import ThreadPoolExecutor
import uuid

import httpx

BASE = "http://localhost:8000"


def main():
    note_ids = []
    folder_ids = []
    with httpx.Client(base_url=BASE, timeout=30) as client:
        login = client.post("/api/auth/login", data={"username": "local", "password": "1234", "grant_type": "password"})
        login.raise_for_status()
        client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"
        prefix = f"name-check-{uuid.uuid4().hex}"

        def folder(suffix):
            response = client.post("/api/folders", json={"name": f"{prefix}-{suffix}"})
            response.raise_for_status()
            folder_ids.append(response.json()["id"])
            return response.json()["id"]

        def create(title=None, folder_id=None, content=""):
            body = {"folder_id": folder_id, "content": content}
            if title is not None:
                body["title"] = title
            response = client.post("/api/notes", json=body)
            response.raise_for_status()
            note = response.json()
            note_ids.append(note["id"])
            return note

        def conflict(response):
            assert response.status_code == 409, (response.status_code, response.text)

        try:
            a, b = folder("a"), folder("b")
            unnamed = [create(folder_id=a), create("", a), create("  ", a)]
            assert [n["title"] for n in unnamed] == ["무제 노트", "무제 노트 2", "무제 노트 3"]
            assert create(folder_id=b)["title"] == "무제 노트"

            # Independent requests must reserve different names even when they overlap.
            with ThreadPoolExecutor(max_workers=6) as pool:
                concurrent = list(pool.map(lambda _: create(folder_id=a), range(6)))
            assert {n["title"] for n in concurrent} == {f"무제 노트 {i}" for i in range(4, 10)}
            assert create(" 무제 노트 12 ", a)["title"] == "무제 노트 12"

            first = create("Meeting", a, "keep original body")
            conflict(client.post("/api/notes", json={"title": " meeting ", "folder_id": a}))
            second = create("Meeting", b)
            conflict(client.patch(f"/api/notes/{second['id']}", json={"folder_id": a}))
            assert client.get(f"/api/notes/{second['id']}").json()["folder_id"] == b
            conflict(client.patch(f"/api/notes/{unnamed[0]['id']}", json={"title": "MEETING", "content": "must not be saved"}))
            current = client.get(f"/api/notes/{unnamed[0]['id']}").json()
            assert current["title"] == "무제 노트" and current["content"] == ""
            # Blurring a duplicate title requests a fallback name while saving the body.
            fallback = client.patch(f"/api/notes/{unnamed[0]['id']}", json={
                "title": "Meeting", "content": "body after title blur", "resolve_title_conflict": True,
            })
            fallback.raise_for_status()
            assert fallback.json()["title"] == "무제 노트"
            assert fallback.json()["content"] == "body after title blur"
            # A simultaneous folder move must still be rejected, even with the flag.
            conflict(client.patch(f"/api/notes/{second['id']}", json={"folder_id": a, "resolve_title_conflict": True}))
            response = client.patch(f"/api/notes/{first['id']}", json={"title": " Meeting "})
            response.raise_for_status()
            assert response.json()["title"] == "Meeting"
            client.patch(f"/api/notes/{first['id']}", json={"is_archived": True}).raise_for_status()
            conflict(client.post("/api/notes", json={"title": "Meeting", "folder_id": a}))

            # Existing names with a number reserve that number; gaps are reusable.
            client.delete(f"/api/notes/{unnamed[1]['id']}").raise_for_status()
            assert create(folder_id=a)["title"] == "무제 노트 2"

            empty_response = client.patch(f"/api/notes/{second['id']}", json={"title": ""})
            empty_response.raise_for_status()
            assert empty_response.json()["title"] == "무제 노트 2"

            root = create(f"{prefix}-root")
            conflict(client.post("/api/notes", json={"title": root["title"]}))
            root_shadow = create(root["title"], b)
            conflict(client.delete(f"/api/folders/{b}"))
            assert client.get(f"/api/notes/{root_shadow['id']}").json()["folder_id"] == b

            movable_folder = folder("move-to-root")
            movable = create(f"{prefix}-movable", movable_folder)
            client.delete(f"/api/folders/{movable_folder}").raise_for_status()
            moved = client.get(f"/api/notes/{movable['id']}").json()
            assert moved["folder_id"] is None and moved["title"] == movable["title"]
            assert moved["change_seq"] > movable["change_seq"]

            original = create("Restore name", a, "original")
            client.patch(f"/api/notes/{original['id']}", json={"title": "Renamed", "content": "new"}).raise_for_status()
            versions = client.get(f"/api/notes/{original['id']}/versions").json()
            create("Restore name", a)
            conflict(client.post(f"/api/notes/{original['id']}/restore-version/{versions[-1]['id']}"))
            current = client.get(f"/api/notes/{original['id']}").json()
            assert current["title"] == "Renamed" and current["content"] == "new"

            contestants = [create("Race one", a), create("Race two", a)]
            with ThreadPoolExecutor(max_workers=2) as pool:
                responses = list(pool.map(lambda n: client.patch(f"/api/notes/{n['id']}", json={"title": "Race winner"}), contestants))
            assert sorted(r.status_code for r in responses) == [200, 409]
            print("PASS: numbered untitled notes, folder/root scope, whitespace/case, rename/move, archive, restore, concurrent create/rename")
        finally:
            for note_id in note_ids:
                response = client.delete(f"/api/notes/{note_id}")
                assert response.status_code in (200, 404), ("cleanup note", response.status_code)
            for folder_id in folder_ids:
                response = client.delete(f"/api/folders/{folder_id}")
                assert response.status_code in (200, 404), ("cleanup folder", response.status_code)


if __name__ == "__main__":
    main()
