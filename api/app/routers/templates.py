import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.schemas import TemplateBody, TemplateOut, TemplateSettings
from app.services.note_names import lock_note_names
from app.services.sync import touch_meta
from app.services.templates import load_settings, require_folder, save_settings

router = APIRouter(prefix="/templates", tags=["templates"])
Db = Annotated[Session, Depends(get_db)]


def checked_body(body: TemplateBody, settings: TemplateSettings, exclude=None):
    body.name = body.name.strip()
    body.title = body.title.strip()
    if not body.name:
        raise HTTPException(status_code=400, detail="템플릿 이름을 입력해 주세요.")
    if len(body.content) + sum(len(t.content) for t in settings.templates if t.id != exclude) > 2_000_000:
        raise HTTPException(status_code=400, detail="템플릿 본문 전체 용량 제한을 초과했습니다.")
    for other in settings.templates:
        if other.id == exclude:
            continue
        if other.name.lower() == body.name.lower():
            raise HTTPException(status_code=409, detail="같은 이름의 템플릿이 이미 있습니다.")
        if body.shortcut and other.shortcut == body.shortcut:
            raise HTTPException(status_code=409, detail="다른 템플릿에서 사용 중인 단축키입니다.")


def commit_settings(db, me, settings):
    save_settings(me, settings)
    touch_meta(db)
    db.commit()
    return settings


@router.get("", response_model=TemplateSettings)
def list_templates(db: Db, me: CurrentUser):
    return load_settings(db, me)


@router.post("", response_model=TemplateSettings)
def create_template(body: TemplateBody, db: Db, me: CurrentUser):
    lock_note_names(db, me.id)
    settings = load_settings(db, me)
    if len(settings.templates) >= 100:
        raise HTTPException(status_code=400, detail="템플릿은 최대 100개까지 만들 수 있습니다.")
    require_folder(db, me.id, body.target_folder_id)
    checked_body(body, settings)
    settings.templates.append(TemplateOut(id=uuid.uuid4(), **body.model_dump()))
    return commit_settings(db, me, settings)


@router.put("/{template_id}", response_model=TemplateSettings)
def update_template(template_id: uuid.UUID, body: TemplateBody, db: Db, me: CurrentUser):
    lock_note_names(db, me.id)
    settings = load_settings(db, me)
    position = next((i for i, t in enumerate(settings.templates) if t.id == template_id), None)
    if position is None:
        raise HTTPException(status_code=404, detail="템플릿을 찾을 수 없습니다.")
    require_folder(db, me.id, body.target_folder_id)
    checked_body(body, settings, template_id)
    settings.templates[position] = TemplateOut(id=template_id, **body.model_dump())
    return commit_settings(db, me, settings)


@router.delete("/{template_id}", response_model=TemplateSettings)
def delete_template(template_id: uuid.UUID, db: Db, me: CurrentUser):
    lock_note_names(db, me.id)
    settings = load_settings(db, me)
    if not any(t.id == template_id for t in settings.templates):
        raise HTTPException(status_code=404, detail="템플릿을 찾을 수 없습니다.")
    settings.templates = [t for t in settings.templates if t.id != template_id]
    return commit_settings(db, me, settings)
