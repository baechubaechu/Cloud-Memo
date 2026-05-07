from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.models import User
from app.schemas import UserOut
from app.security import create_access_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def _issue_token(user: User):
    token = create_access_token(str(user.id))
    return {"access_token": token, "token_type": "bearer"}


def _single_user(db: Session) -> User:
    """단일 사용자 모드: DB의 첫 사용자만 인증 대상으로 사용한다."""
    user = db.execute(select(User).order_by(User.created_at.asc(), User.id.asc())).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No user found. Run bootstrap first.",
        )
    return user


@router.post("/login")
def login_form(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """단일 비밀번호 잠금 해제 엔드포인트.

    `username`은 호환성을 위해 받지만 사용하지 않는다.
    """
    user = _single_user(db)
    if not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return _issue_token(user)


@router.post("/token")
def token_alias(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    return login_form(form, db)


@router.post("/logout")
def logout(_: CurrentUser):
    """JWT is stateless — client just drops the token. Endpoint exists for completeness/future revocation."""
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(me: CurrentUser):
    return me
