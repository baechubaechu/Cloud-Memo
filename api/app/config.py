from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


# 명시적인 기본값 — 운영 환경에서 그대로 쓰면 위험하므로 시작 시 검증한다.
INSECURE_JWT_SECRET = "dev-secret-change-me"
INSECURE_INITIAL_PASSWORD = "1234"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(
        default="postgresql://memo:memo@localhost:5432/memo",
        alias="DATABASE_URL",
    )
    jwt_secret: str = Field(default=INSECURE_JWT_SECRET, alias="JWT_SECRET")
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 14

    upload_dir: str = Field(default="./data/uploads", alias="UPLOAD_DIR")
    cors_origins: str = Field(default="http://localhost:3000", alias="CORS_ORIGINS")

    initial_user_email: str = Field(default="admin@localhost", alias="INITIAL_USER_EMAIL")
    initial_user_password: str = Field(default=INSECURE_INITIAL_PASSWORD, alias="INITIAL_USER_PASSWORD")

    version_autosave_min_seconds: int = Field(default=120, alias="VERSION_AUTOSAVE_MIN_SECONDS")

    max_upload_mb: int = Field(default=25, alias="MAX_UPLOAD_MB")

    # APP_ENV=production 일 때만 안전 검증을 강제한다.
    app_env: str = Field(default="development", alias="APP_ENV")

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() in {"production", "prod"}


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


def assert_production_safe() -> None:
    """프로덕션 환경에서 약한 기본값이 그대로 노출되는 사고를 방지한다.

    APP_ENV=production 일 때만 강제하므로 개발/테스트 환경엔 영향이 없다.
    """
    if not settings.is_production:
        return
    problems: list[str] = []
    if settings.jwt_secret == INSECURE_JWT_SECRET or len(settings.jwt_secret) < 32:
        problems.append(
            "JWT_SECRET 이 비어 있거나 기본값/너무 짧음. 32자 이상의 랜덤 문자열로 설정해야 합니다."
        )
    if settings.initial_user_password == INSECURE_INITIAL_PASSWORD:
        problems.append(
            "INITIAL_USER_PASSWORD 가 기본값입니다. 첫 배포 전에 강력한 비밀번호로 바꾸세요."
        )
    if "*" in settings.cors_origins:
        problems.append("CORS_ORIGINS 에 와일드카드(*)가 포함되어 있습니다.")
    if problems:
        raise RuntimeError(
            "프로덕션 환경 설정 오류:\n  - " + "\n  - ".join(problems)
        )
