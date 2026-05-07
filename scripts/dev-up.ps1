# 로컬 개발에 필요한 인프라(=Postgres만)를 띄움
# 무거운 memo-api/memo-web/memo-worker/caddy 컨테이너는 일부러 띄우지 않음.
# 사용법: pwsh -File .\scripts\dev-up.ps1

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
    Write-Host "==> docker compose up -d memo-postgres" -ForegroundColor Cyan
    docker compose up -d memo-postgres

    Write-Host ""
    Write-Host "다음 단계:" -ForegroundColor Yellow
    Write-Host "  1) 새 터미널: pwsh -File .\scripts\dev-api.ps1     (http://localhost:8000)"
    Write-Host "  2) 또 다른 터미널: pwsh -File .\scripts\dev-web.ps1 (http://localhost:3000)"
}
finally {
    Pop-Location
}
