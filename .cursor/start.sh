#!/usr/bin/env bash
# Cloud Memo — Cloud Agent start (per-boot, idempotent).
# Brings up PostgreSQL, reconciles the role/db, applies migrations and
# ensures the bootstrap user. Returns once the database is ready; the API
# and web dev servers run as named terminals (see environment.json).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export PATH="$PATH:/usr/lib/postgresql/16/bin"

echo "==> Starting PostgreSQL cluster"
sudo pg_ctlcluster 16 main start 2>/dev/null || true
for i in $(seq 1 30); do
  if sudo -u postgres pg_isready -q; then break; fi
  sleep 1
done

echo "==> Ensuring 'memo' role and database"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='memo'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE memo LOGIN PASSWORD 'memo';"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='memo'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE memo OWNER memo;"

if [ ! -f "$REPO_ROOT/api/.env" ]; then
  echo "==> api/.env missing; run .cursor/install.sh first" >&2
fi

echo "==> Applying migrations and ensuring bootstrap user"
( cd "$REPO_ROOT/api" && ./.venv/bin/alembic upgrade head )
( cd "$REPO_ROOT/api" && ./.venv/bin/python -m app.bootstrap )

echo "==> Database ready."
