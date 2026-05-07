# 로컬 개발용 인프라 정리 (Postgres 컨테이너 정지)
# 데이터는 ./data/postgres 볼륨에 그대로 남습니다.
# 사용법: pwsh -File .\scripts\dev-down.ps1

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
    Write-Host "==> docker compose stop memo-postgres" -ForegroundColor Cyan
    docker compose stop memo-postgres
}
finally {
    Pop-Location
}
