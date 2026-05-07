import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.security import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    sub = decode_token(token)
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    try:
        uid = uuid.UUID(sub)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid subject") from exc

    row = db.execute(select(User).where(User.id == uid)).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=401, detail="User not found")
    return row


CurrentUser = Annotated[User, Depends(get_current_user)]
