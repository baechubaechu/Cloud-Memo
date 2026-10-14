"""Live regression: renames typed in the title box rewrite links once, on commit.

While the title box has focus the client autosaves with update_links=false. The
server must keep other notes' links (and their versions) untouched until a
request with update_links=true arrives, then rewrite from the original name to
the final one in a single pass.

Requires a running API (scripts/dev-api.ps1). Cleans up after itself.
"""
import httpx

BASE = "http://localhost:8000"


def main() -> None:
    with httpx.Client(base_url=BASE, timeout=30) as client:
        response = client.post(
            "/api/auth/login", data={"username": "local", "password": "1234", "grant_type": "password"}
        )
        response.raise_for_status()
        client.headers["Authorization"] = f"Bearer {response.json()['access_token']}"
        created: list[str] = []

        def note(title: str, content: str) -> dict:
            result = client.post("/api/notes", json={"title": title, "content": content})
            assert result.status_code == 200, result.text
            created.append(result.json()["id"])
            return result.json()

        def get(note_id: str) -> dict:
            return client.get(f"/api/notes/{note_id}").json()

        def versions(note_id: str) -> list[dict]:
            return client.get(f"/api/notes/{note_id}/versions").json()

        try:
            target = note("ZZLC Proj", "target")
            sources = [note(f"ZZLC src{i}", "a\nsee [[ZZLC Proj]] here\n") for i in range(2)]

            # 1) Typing in the title box: intermediate names are saved, links are not touched.
            for partial in ["ZZLC Proj X", "ZZLC Proj XY", "ZZLC Proj XYZ"]:
                r = client.patch(f"/api/notes/{target['id']}", json={"title": partial, "update_links": False})
                assert r.status_code == 200, r.text
                assert r.json()["title"] == partial
                assert r.json()["updated_link_note_count"] is None, r.json()
            for s in sources:
                assert get(s["id"])["content"] == "a\nsee [[ZZLC Proj]] here\n"
                assert versions(s["id"]) == [], versions(s["id"])

            # 2) Commit (e.g. title box blur): one rewrite from the original name to the final one.
            r = client.patch(f"/api/notes/{target['id']}", json={"update_links": True})
            assert r.status_code == 200, r.text
            assert r.json()["updated_link_note_count"] == 2, r.json()
            for s in sources:
                assert get(s["id"])["content"] == "a\nsee [[/ZZLC Proj XYZ]] here\n", get(s["id"])["content"]
                reasons = [v["reason"] for v in versions(s["id"])]
                assert reasons == ["before_link_update"], reasons

            # 3) A second commit with nothing pending does nothing.
            r = client.patch(f"/api/notes/{target['id']}", json={"update_links": True})
            assert r.json()["updated_link_note_count"] is None, r.json()

            # 4) Renamed and typed back before committing: links keep their original form.
            other = note("ZZLC Keep", "x")
            linker = note("ZZLC linker", "see [[ZZLC Keep]]")
            client.patch(f"/api/notes/{other['id']}", json={"title": "ZZLC Keep 2", "update_links": False})
            client.patch(f"/api/notes/{other['id']}", json={"title": "ZZLC Keep", "update_links": False})
            r = client.patch(f"/api/notes/{other['id']}", json={"update_links": True})
            assert r.json()["updated_link_note_count"] is None, r.json()
            assert get(linker["id"])["content"] == "see [[ZZLC Keep]]"

            # 5) A pending rename survives until any later default request commits it.
            client.patch(f"/api/notes/{other['id']}", json={"title": "ZZLC Kept", "update_links": False})
            r = client.patch(f"/api/notes/{other['id']}", json={"is_favorite": True})
            assert r.json()["updated_link_note_count"] == 1, r.json()
            assert get(linker["id"])["content"] == "see [[/ZZLC Kept]]"

            # 6) Ordinary renames (sidebar, API default) still rewrite immediately.
            r = client.patch(f"/api/notes/{other['id']}", json={"title": "ZZLC Final"})
            assert r.json()["updated_link_note_count"] == 1, r.json()
            assert get(linker["id"])["content"] == "see [[/ZZLC Final]]"
        finally:
            for note_id in created:
                client.delete(f"/api/notes/{note_id}")

    print("PASS: typed renames defer link rewrites to commit, single rewrite, revert keeps links, pending survives")


if __name__ == "__main__":
    main()
