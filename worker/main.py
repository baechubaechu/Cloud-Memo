"""memo-worker — placeholder.

Polls /api/ai-jobs?status=queued and would run jobs locally (local AI / OpenClaw / etc.).
For now it just logs queued jobs and marks them as `cancelled` after one cycle so the queue
does not grow unbounded during integration testing. Replace with real handlers later.
"""
from __future__ import annotations

import os
import time
from typing import Any

import httpx

API_URL = os.environ.get("API_URL", "http://backend:8000").rstrip("/")
WORKER_TOKEN = os.environ.get("WORKER_TOKEN")  # JWT for the worker user
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "10"))


def headers() -> dict[str, str]:
    if not WORKER_TOKEN:
        return {}
    return {"Authorization": f"Bearer {WORKER_TOKEN}"}


def fetch_queued() -> list[dict[str, Any]]:
    if not WORKER_TOKEN:
        return []
    try:
        r = httpx.get(f"{API_URL}/api/ai-jobs", params={"status": "queued"}, headers=headers(), timeout=10.0)
        r.raise_for_status()
        return r.json()
    except Exception as e:  # pragma: no cover
        print("worker: fetch_queued failed:", e, flush=True)
        return []


def cancel(job_id: str, message: str) -> None:
    try:
        httpx.patch(
            f"{API_URL}/api/ai-jobs/{job_id}",
            headers=headers(),
            json={"status": "cancelled", "error_message": message, "worker_type": "placeholder"},
            timeout=10.0,
        )
    except Exception as e:  # pragma: no cover
        print("worker: cancel failed:", e, flush=True)


def main() -> None:
    print(f"memo-worker placeholder started (API={API_URL}, token={'yes' if WORKER_TOKEN else 'no'})", flush=True)
    while True:
        jobs = fetch_queued()
        for j in jobs:
            print(f"worker: would run job {j.get('id')} type={j.get('job_type')}", flush=True)
            cancel(j["id"], "no AI worker implementation available yet")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
