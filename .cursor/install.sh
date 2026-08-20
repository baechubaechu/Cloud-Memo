#!/usr/bin/env bash
# Cloud Memo — Cloud Agent install (idempotent).
# Prepares system packages, Python venv, Node deps, PostgreSQL cluster,
# database migrations and the bootstrap user. Safe to run repeatedly.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log() { printf '\n==> %s\n' "$*"; }

# --- 1. System packages (PostgreSQL 16 + venv/build tooling) ---------------
log "Installing system packages (postgresql, python venv/dev)"
export DEBIAN_FRONTEND=noninteractive
apt_install() {
  for i in 1 2 3 4 5; do
    if sudo apt-get install -y --no-install-recommends "$@"; then return 0; fi
    echo "apt-get install failed (attempt $i), retrying..." >&2
    sleep $((i * 4))
  done
  return 1
}
sudo apt-get update -qq || true
apt_install postgresql postgresql-contrib python3.12-venv python3-dev

PG_BIN="/usr/lib/postgresql/16/bin"
export PATH="$PATH:$PG_BIN"

# --- 2. Start PostgreSQL so we can create the role/db and migrate ----------
log "Starting PostgreSQL cluster"
sudo pg_ctlcluster 16 main start 2>/dev/null || true
for i in $(seq 1 30); do
  if sudo -u postgres pg_isready -q; then break; fi
  sleep 1
done

log "Ensuring 'memo' role and database"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='memo'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE memo LOGIN PASSWORD 'memo';"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='memo'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE memo OWNER memo;"

# --- 3. Local dev env files (gitignored; dev-only weak defaults) ------------
log "Writing dev env files"
mkdir -p "$REPO_ROOT/data/uploads"
if [ ! -f "$REPO_ROOT/api/.env" ]; then
  cat > "$REPO_ROOT/api/.env" <<EOF
APP_ENV=development
DATABASE_URL=postgresql://memo:memo@localhost:5432/memo
JWT_SECRET=dev-secret-change-me
INITIAL_USER_EMAIL=admin@local
INITIAL_USER_PASSWORD=1234
CORS_ORIGINS=http://localhost:3000,http://localhost
UPLOAD_DIR=$REPO_ROOT/data/uploads
VERSION_AUTOSAVE_MIN_SECONDS=120
MAX_UPLOAD_MB=25
EOF
fi
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > "$REPO_ROOT/web/.env.local"

# --- 4. Python API + worker deps -------------------------------------------
log "Setting up Python venv and API/worker deps"
if [ ! -x "$REPO_ROOT/api/.venv/bin/python" ]; then
  python3 -m venv "$REPO_ROOT/api/.venv"
fi
"$REPO_ROOT/api/.venv/bin/pip" install --upgrade pip -q
"$REPO_ROOT/api/.venv/bin/pip" install -q -r "$REPO_ROOT/api/requirements.txt"
"$REPO_ROOT/api/.venv/bin/pip" install -q -r "$REPO_ROOT/worker/requirements.txt"
# httpx powers scripts/smoke_test.py (repo e2e test).
"$REPO_ROOT/api/.venv/bin/pip" install -q httpx==0.27.2

# --- 5. Node web deps -------------------------------------------------------
log "Installing web deps (npm ci)"
( cd "$REPO_ROOT/web" && npm ci )

# --- 6. Migrate + bootstrap the single user --------------------------------
log "Applying migrations and bootstrapping user"
( cd "$REPO_ROOT/api" && ./.venv/bin/alembic upgrade head )
( cd "$REPO_ROOT/api" && ./.venv/bin/python -m app.bootstrap )

log "Install complete."
