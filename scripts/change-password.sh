#!/usr/bin/env bash
set -euo pipefail

# Cloud Memo 비밀번호 변경 (bash)
# 사용법:
#   bash ./scripts/change-password.sh
#   bash ./scripts/change-password.sh --new-password "새비밀번호"
#   bash ./scripts/change-password.sh --mode docker --new-password "새비밀번호"
#
# 모드:
# - auto   : docker compose 가 동작 중이면 docker, 아니면 local
# - docker : docker compose exec memo-api 로 변경
# - local  : api/.venv/bin/python 으로 변경

MODE="auto"
NEW_PASSWORD=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --new-password)
      NEW_PASSWORD="${2:-}"
      shift 2
      ;;
    *)
      echo "[ERROR] unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "$MODE" != "auto" && "$MODE" != "docker" && "$MODE" != "local" ]]; then
  echo "[ERROR] --mode 는 auto|docker|local 중 하나여야 합니다." >&2
  exit 1
fi

if [[ -z "$NEW_PASSWORD" ]]; then
  read -r -s -p "새 잠금 비밀번호를 입력하세요: " NEW_PASSWORD
  echo ""
fi
if [[ -z "$NEW_PASSWORD" ]]; then
  echo "[ERROR] 비밀번호가 비어 있습니다." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/api"
VENV_PY="$API_DIR/.venv/bin/python"

docker_available="false"
if command -v docker >/dev/null 2>&1; then
  if (cd "$ROOT_DIR" && docker compose ps >/dev/null 2>&1); then
    docker_available="true"
  fi
fi

RESOLVED_MODE="$MODE"
if [[ "$MODE" == "auto" ]]; then
  if [[ "$docker_available" == "true" ]]; then
    RESOLVED_MODE="docker"
  else
    RESOLVED_MODE="local"
  fi
fi

if [[ "$RESOLVED_MODE" == "docker" ]]; then
  (cd "$ROOT_DIR" && docker compose exec -T memo-api python -m app.scripts.change_password_cli --password "$NEW_PASSWORD")
  echo "[DONE] docker 모드로 비밀번호를 변경했습니다."
  exit 0
fi

if [[ ! -x "$VENV_PY" ]]; then
  echo "[ERROR] local 모드에 필요한 venv python 이 없습니다: $VENV_PY" >&2
  echo "        먼저 'cd api && python -m venv .venv && .venv/bin/python -m pip install -r requirements.txt' 실행" >&2
  exit 1
fi

(cd "$API_DIR" && "$VENV_PY" -m app.scripts.change_password_cli --password "$NEW_PASSWORD")
echo "[DONE] local 모드로 비밀번호를 변경했습니다."
