#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/deploy/hub/.env"
COMPOSE_FILE="${ROOT_DIR}/deploy/hub/docker-compose.yml"

cd "$ROOT_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "${ROOT_DIR}/deploy/hub/.env.example" "$ENV_FILE"
  echo "[INFO] deploy/hub/.env 를 생성했습니다. LAN IP 등을 수정한 뒤 다시 실행하세요."
  exit 1
fi

get_env() {
  local key="$1"
  awk -F '=' -v k="$key" '$1==k {sub(/^[^=]*=/, "", $0); print $0; exit}' "$ENV_FILE"
}

JWT_SECRET="$(get_env JWT_SECRET || true)"
INITIAL_USER_PASSWORD="$(get_env INITIAL_USER_PASSWORD || true)"

if [[ -z "$JWT_SECRET" || ${#JWT_SECRET} -lt 32 ]]; then
  echo "[ERROR] JWT_SECRET 을 32자 이상으로 설정하세요." >&2
  exit 1
fi

if [[ -z "$INITIAL_USER_PASSWORD" || "$INITIAL_USER_PASSWORD" == change-me* ]]; then
  echo "[ERROR] INITIAL_USER_PASSWORD 를 바꾸세요." >&2
  exit 1
fi

mkdir -p "$(get_env DATA_DIR || echo "${ROOT_DIR}/data")"

echo "[INFO] 허브 프로필로 docker compose up..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

echo ""
echo "[DONE] 허브 기동 완료"
echo "  API : http://<허브-LAN-IP>:$(get_env API_PORT || echo 8000)"
echo "  Web : http://<허브-LAN-IP>:$(get_env WEB_PORT || echo 3000)"
