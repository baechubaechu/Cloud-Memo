#!/usr/bin/env bash
set -euo pipefail

# Cloud Memo 개인 VPS 배포 헬퍼
# 사용법:
#   bash ./scripts/deploy-vps.sh
#
# 동작:
# 1) .env 가 없으면 .env.example 복사
# 2) 필수 환경값(APP_ENV/JWT_SECRET/INITIAL_USER_PASSWORD/DOMAIN) 점검
# 3) docker compose up -d --build 실행
# 4) 최종 접속 URL 안내

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "[ERROR] docker 명령을 찾을 수 없습니다." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "[ERROR] docker compose 플러그인을 찾을 수 없습니다." >&2
  exit 1
fi

if [[ ! -f ".env" ]]; then
  cp .env.example .env
  echo "[INFO] .env 파일이 없어 .env.example 을 복사했습니다."
fi

get_env() {
  local key="$1"
  # 단순 KEY=VALUE 포맷 기준. 주석/빈 줄 제외.
  awk -F '=' -v k="$key" '$1==k {sub(/^[^=]*=/, "", $0); print $0; exit}' .env
}

APP_ENV="$(get_env APP_ENV || true)"
JWT_SECRET="$(get_env JWT_SECRET || true)"
INITIAL_USER_PASSWORD="$(get_env INITIAL_USER_PASSWORD || true)"
DOMAIN="$(get_env DOMAIN || true)"

if [[ "$APP_ENV" != "production" ]]; then
  echo "[ERROR] .env 의 APP_ENV=production 이 필요합니다. (현재: ${APP_ENV:-<empty>})" >&2
  exit 1
fi

if [[ -z "$JWT_SECRET" || "$JWT_SECRET" == "dev-change-me" || ${#JWT_SECRET} -lt 32 ]]; then
  echo "[ERROR] JWT_SECRET 이 약하거나 비어 있습니다. 32자 이상으로 설정하세요." >&2
  exit 1
fi

if [[ -z "$INITIAL_USER_PASSWORD" || "$INITIAL_USER_PASSWORD" == "1234" ]]; then
  echo "[ERROR] INITIAL_USER_PASSWORD 가 기본값/빈값입니다. 강한 비밀번호로 바꾸세요." >&2
  exit 1
fi

if [[ -z "$DOMAIN" || "$DOMAIN" == "localhost" ]]; then
  echo "[WARN] DOMAIN 이 localhost 입니다. HTTPS 자동 발급 없이 로컬 도메인 모드로 동작할 수 있습니다."
fi

echo "[INFO] docker compose up -d --build 실행..."
docker compose up -d --build

echo ""
echo "[DONE] 배포 완료"
if [[ -n "$DOMAIN" ]]; then
  if [[ "$DOMAIN" == "localhost" ]]; then
    echo "접속: http://localhost"
  else
    echo "접속: https://${DOMAIN}"
  fi
else
  echo "접속: http://<VPS_IP>"
fi
