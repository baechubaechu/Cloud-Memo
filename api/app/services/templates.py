"""User-owned template settings stored in the existing metadata document."""
import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Folder, User
from app.schemas import TemplateSettings

KEY = "note_templates"


def load_settings(db: Session, user: User) -> TemplateSettings:
    db.refresh(user, attribute_names=["meta"])
    return TemplateSettings.model_validate((user.meta or {}).get(KEY, {}))


def require_folder(db: Session, user_id: uuid.UUID, folder_id: uuid.UUID | None):
    if folder_id is None:
        return
    folder = db.get(Folder, folder_id)
    if not folder or folder.user_id != user_id or folder.deleted_at is not None:
        raise HTTPException(status_code=404, detail="대상 폴더를 찾을 수 없습니다.")


def save_settings(user: User, settings: TemplateSettings):
    user.meta = {**(user.meta or {}), KEY: settings.model_dump(mode="json")}
