#!/usr/bin/env bash
# 하위 호환 — deploy/vps/setup.sh 로 위임
exec bash "$(dirname "$0")/../deploy/vps/setup.sh" "$@"
