"""Create the initial single user if none exist."""

from sqlalchemy import select

from app.config import settings
from app.database import SessionLocal
from app.models import User
from app.security import hash_password


def ensure_initial_user() -> None:
    db = SessionLocal()
    try:
        n = db.execute(select(User).limit(1)).scalar_one_or_none()
        if n is not None:
            print("Bootstrap: users already exist, skipping.")
            return
        u = User(
            email=settings.initial_user_email,
            hashed_password=hash_password(settings.initial_user_password),
            meta={"role": "owner"},
        )
        db.add(u)
        db.commit()
        print(f"Bootstrap: created initial user {u.email}")
    finally:
        db.close()


def main() -> None:
    ensure_initial_user()


if __name__ == "__main__":
    main()
