from __future__ import annotations

import argparse
import sys

from sqlalchemy import select

from app.database import SessionLocal
from app.models import User
from app.security import hash_password


def main() -> int:
    parser = argparse.ArgumentParser(description="Change Cloud Memo single-user lock password.")
    parser.add_argument("--password", required=True, help="New password")
    args = parser.parse_args()

    if not args.password.strip():
        print("ERROR: password must not be empty", file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        user = db.execute(select(User).order_by(User.created_at.asc(), User.id.asc())).scalar_one_or_none()
        if user is None:
            print("ERROR: no user found. bootstrap first", file=sys.stderr)
            return 1
        user.hashed_password = hash_password(args.password)
        db.commit()
        print(f"password-updated {user.email}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
