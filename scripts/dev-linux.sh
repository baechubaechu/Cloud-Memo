#!/usr/bin/env bash
set -euo pipefail

# 리눅스 개발 환경 (도커 없이). 클라우드 세션·WSL·리눅스 PC 에서 사용.
# 윈도우의 dev-up.ps1 + dev-api.ps1 + dev-web.ps1 을 한 파일로 옮긴 것.
#
# 사용법:
#   bash scripts/dev-linux.sh setup   # Postgres·venv·npm 설치, DB 생성, 마이그레이션 (한 번)
#   bash scripts/dev-linux.sh up      # API(8000)·웹(3000) 을 백그라운드로 실행, 로그는 data/dev-logs/
#   bash scripts/dev-linux.sh down    # 둘 다 종료
#   bash scripts/dev-linux.sh test    # 오프라인 테스트 + (API 가 떠 있으면) 실제 API 테스트
#   bash scripts/dev-linux.sh check   # 타입 검사 + 프로덕션 빌드 (web/.next 를 같이 쓰므로 'down' 후 실행)
#
# 로컬 전용 테스트 값만 쓴다 (memo/memo DB, 비밀번호 1234). 실제 VPS DB 에는 연결하지 않는다.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$REPO_ROOT/api"
WEB_DIR="$REPO_ROOT/web"
VENV_PY="$API_DIR/.venv/bin/python"
LOG_DIR="$REPO_ROOT/data/dev-logs"

SUDO=""
if [[ "$(id -u)" -ne 0 ]]; then SUDO="sudo"; fi

export DATABASE_URL="postgresql://memo:memo@localhost:5432/memo"
export JWT_SECRET="dev-local-secret-change-me"
export UPLOAD_DIR="$REPO_ROOT/data/uploads"
export EXPORT_DIR="$REPO_ROOT/data/exports"
export BACKUP_DIR="$REPO_ROOT/data/backups"
export CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000"
export INITIAL_USER_EMAIL="admin@local"
export INITIAL_USER_PASSWORD="1234"
export MAX_UPLOAD_MB="25"

start_postgres() {
  if pg_isready -h localhost -q 2>/dev/null; then return; fi
  echo "==> Postgres 시작"
  $SUDO service postgresql start >/dev/null 2>&1 || $SUDO pg_ctlcluster "$(ls /etc/postgresql | sort -V | tail -1)" main start
  for _ in $(seq 1 30); do
    pg_isready -h localhost -q && return
    sleep 1
  done
  echo "[ERROR] Postgres 가 30초 안에 뜨지 않았습니다." >&2
  exit 1
}

wait_http() {
  local url="$1" name="$2"
  for _ in $(seq 1 120); do
    curl -fs "$url" >/dev/null 2>&1 && return
    sleep 1
  done
  echo "[ERROR] $name 가 응답하지 않습니다: $url (로그: $LOG_DIR)" >&2
  exit 1
}

cmd_setup() {
  if ! command -v pg_isready >/dev/null 2>&1; then
    echo "==> Postgres 설치"
    $SUDO apt-get update -qq
    $SUDO apt-get install -y -qq postgresql >/dev/null
  fi
  start_postgres

  echo "==> DB·계정 생성 (memo/memo, 이미 있으면 skip)"
  $SUDO -u postgres psql -qtc "SELECT 1 FROM pg_roles WHERE rolname='memo'" | grep -q 1 \
    || $SUDO -u postgres psql -qc "CREATE ROLE memo LOGIN PASSWORD 'memo'"
  $SUDO -u postgres psql -qtc "SELECT 1 FROM pg_database WHERE datname='memo'" | grep -q 1 \
    || $SUDO -u postgres psql -qc "CREATE DATABASE memo OWNER memo"

  if [[ ! -x "$VENV_PY" ]]; then
    echo "==> api/.venv 생성"
    python3 -m venv "$API_DIR/.venv" 2>/dev/null || {
      $SUDO apt-get install -y -qq python3-venv >/dev/null
      python3 -m venv "$API_DIR/.venv"
    }
  fi
  echo "==> pip install (requirements + 테스트용 httpx)"
  "$VENV_PY" -m pip install -q -r "$API_DIR/requirements.txt" httpx

  mkdir -p "$UPLOAD_DIR" "$EXPORT_DIR" "$BACKUP_DIR"
  (cd "$API_DIR" && "$VENV_PY" -m alembic upgrade head && "$VENV_PY" -m app.bootstrap)

  echo "==> npm ci"
  (cd "$WEB_DIR" && npm ci --no-audit --no-fund)
  echo "setup 완료. 다음: bash scripts/dev-linux.sh up"
}

cmd_up() {
  start_postgres
  mkdir -p "$LOG_DIR" "$UPLOAD_DIR" "$EXPORT_DIR" "$BACKUP_DIR"
  (cd "$API_DIR" && "$VENV_PY" -m alembic upgrade head >/dev/null && "$VENV_PY" -m app.bootstrap)

  if ! curl -fs http://localhost:8000/api/health >/dev/null 2>&1; then
    echo "==> API 시작 (http://localhost:8000)"
    (cd "$API_DIR" && nohup "$VENV_PY" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 \
      >"$LOG_DIR/api.log" 2>&1 & echo $! >"$LOG_DIR/api.pid")
  fi
  wait_http http://localhost:8000/api/health API

  if ! curl -fs http://localhost:3000 >/dev/null 2>&1; then
    echo "==> 웹 시작 (http://localhost:3000, 자동 로그인)"
    (cd "$WEB_DIR" && NEXT_PUBLIC_API_URL="http://localhost:8000" NEXT_PUBLIC_DEV_AUTOLOGIN=1 \
      NEXT_PUBLIC_DEV_PASSWORD=1234 nohup npx next dev -H 127.0.0.1 -p 3000 \
      >"$LOG_DIR/web.log" 2>&1 & echo $! >"$LOG_DIR/web.pid")
  fi
  wait_http http://localhost:3000 웹
  echo "API·웹 실행 중. 로그: $LOG_DIR/{api,web}.log"
}

cmd_down() {
  for name in web api; do
    local pid_file="$LOG_DIR/$name.pid"
    if [[ -f "$pid_file" ]]; then
      pkill -P "$(cat "$pid_file")" 2>/dev/null || true
      kill "$(cat "$pid_file")" 2>/dev/null || true
      rm -f "$pid_file"
    fi
  done
  pkill -f "uvicorn app.main:app" 2>/dev/null || true
  pkill -f "next dev -H 127.0.0.1 -p 3000" 2>/dev/null || true
  echo "API·웹 종료"
}

cmd_test() {
  local failed=0
  echo "==> 오프라인 테스트"
  for t in "$REPO_ROOT"/scripts/test_*.cjs; do
    node "$t" || failed=1
  done
  for t in test_backlinks test_wikilink_paths test_template_variables; do
    (cd "$API_DIR" && "$VENV_PY" "$REPO_ROOT/scripts/$t.py") || failed=1
  done

  if curl -fs http://localhost:8000/api/health >/dev/null 2>&1; then
    echo "==> 실제 API 테스트"
    for t in test_note_names test_wikilinks_api test_templates_api test_link_rename_commit; do
      "$VENV_PY" "$REPO_ROOT/scripts/$t.py" || failed=1
    done
  else
    echo "(API 가 꺼져 있어 실제 API 테스트는 건너뜀 — 먼저 'up')"
  fi

  if [[ "$failed" -ne 0 ]]; then
    echo "[FAIL] 실패한 테스트가 있습니다." >&2
    exit 1
  fi
  echo "모든 테스트 통과"
}

cmd_check() {
  echo "==> 타입 검사"
  (cd "$WEB_DIR" && npx tsc --noEmit)
  echo "==> 프로덕션 빌드"
  (cd "$WEB_DIR" && NEXT_PUBLIC_API_URL="http://localhost:8000" npx next build)
}

case "${1:-}" in
  setup) cmd_setup ;;
  up) cmd_up ;;
  down) cmd_down ;;
  test) cmd_test ;;
  check) cmd_check ;;
  *)
    echo "사용법: bash scripts/dev-linux.sh {setup|up|down|test|check}" >&2
    exit 1
    ;;
esac
