#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/deploy/vps/.env"
COMPOSE_FILE="${ROOT_DIR}/deploy/vps/docker-compose.yml"

cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "[ERROR] docker 명령을 찾을 수 없습니다." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "[ERROR] docker compose 플러그인을 찾을 수 없습니다." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "${ROOT_DIR}/deploy/vps/.env.example" "$ENV_FILE"
  echo "[INFO] deploy/vps/.env 를 생성했습니다. 수정 후 다시 실행하세요."
  exit 1
fi

get_env() {
  local key="$1"
  awk -F '=' -v k="$key" '$1==k {sub(/^[^=]*=/, "", $0); print $0; exit}' "$ENV_FILE"
}

APP_ENV="$(get_env APP_ENV || true)"
JWT_SECRET="$(get_env JWT_SECRET || true)"
INITIAL_USER_PASSWORD="$(get_env INITIAL_USER_PASSWORD || true)"
DOMAIN="$(get_env DOMAIN || true)"

if [[ "$APP_ENV" != "production" ]]; then
  echo "[ERROR] deploy/vps/.env 에 APP_ENV=production 이 필요합니다." >&2
  exit 1
fi

if [[ -z "$JWT_SECRET" || "$JWT_SECRET" == dev-change-me* || ${#JWT_SECRET} -lt 32 ]]; then
  echo "[ERROR] JWT_SECRET 이 약합니다. 32자 이상으로 설정하세요." >&2
  exit 1
fi

if [[ -z "$INITIAL_USER_PASSWORD" || "$INITIAL_USER_PASSWORD" == "1234" || "$INITIAL_USER_PASSWORD" == change-me* ]]; then
  echo "[ERROR] INITIAL_USER_PASSWORD 를 강한 값으로 바꾸세요." >&2
  exit 1
fi

echo "[INFO] VPS 프로필로 docker compose up..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

echo ""
echo "[DONE] 배포 완료"
if [[ -n "$DOMAIN" && "$DOMAIN" != "localhost" ]]; then
  echo "접속: https://${DOMAIN}"
else
  echo "접속: http://localhost (또는 VPS 공인 IP)"
fi
