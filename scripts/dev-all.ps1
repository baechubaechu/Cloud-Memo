# 로컬 개발 풀스택 한 방에: Postgres(Docker) → API → Web
# 사용법 (레포 루트에서):
#   powershell.exe -ExecutionPolicy Bypass -File .\scripts\dev-all.ps1
#
# - memo-postgres 가 없으면 띄우고 healthy 될 때까지 기다립니다.
# - :8000 이 비어 있으면 API 를 새 PowerShell 창에서 띄운 뒤 /api/health 를 기다립니다.
# - 이 터미널에서는 Next.js dev ( :3000 ) 만 포그라운드로 실행합니다.
#
# 환경변수:
#   MEMO_DEV_SKIP_DOCKER=1  — Postgres 를 이미 다른 방식으로 띄운 경우 docker 단계 생략
#   MEMO_DEV_SKIP_API=1     — API 를 수동으로 띄울 때 API 창 생성 생략 (health 만 대기)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$apiVenvPy = Join-Path $repoRoot "api\.venv\Scripts\python.exe"

. (Join-Path $PSScriptRoot "_lib.ps1")

Push-Location $repoRoot
try {
    Write-Host ""
    Write-Host "==[ Cloud Memo dev-all ]======================================" -ForegroundColor Cyan
    Write-Host "  레포: $repoRoot"
    Write-Host "==============================================================" -ForegroundColor Cyan
    Write-Host ""

    if (-not (Test-Path $apiVenvPy)) {
        Write-Host "api\.venv 가 없습니다. 먼저 (1회):" -ForegroundColor Yellow
        Write-Host "  cd api; python -m venv .venv; .\.venv\Scripts\python -m pip install -r requirements.txt; cd .." -ForegroundColor Gray
        exit 1
    }

    if ($env:MEMO_DEV_SKIP_DOCKER -ne "1") {
        Write-Host "==> Docker: memo-postgres 기동" -ForegroundColor Cyan
        docker compose up -d memo-postgres
        if ($LASTEXITCODE -ne 0) {
            Write-Host ""
            Write-Host "docker compose 가 실패했습니다. Docker Desktop 을 켠 뒤 다시 실행하세요." -ForegroundColor Red
            exit 1
        }
        Write-Host "==> Postgres healthy 대기" -ForegroundColor Cyan
        Wait-MemoPostgresHealthy -TimeoutSec 120
        Write-Host "    OK" -ForegroundColor Green
    } else {
        Write-Host "==> MEMO_DEV_SKIP_DOCKER=1 — Postgres Docker 단계 생략" -ForegroundColor Yellow
    }

    $apiScript = Join-Path $repoRoot "scripts\dev-api.ps1"
    if ($env:MEMO_DEV_SKIP_API -ne "1") {
        if (-not (Test-DevTcpPortOpen -Port 8000)) {
            Write-Host "==> API 새 창에서 기동 (uvicorn :8000)" -ForegroundColor Cyan
            Start-Process -FilePath "powershell.exe" -WorkingDirectory $repoRoot -ArgumentList @(
                "-NoExit",
                "-NoLogo",
                "-ExecutionPolicy", "Bypass",
                "-File", $apiScript
            )
            Write-Host "    API 창이 열렸습니다. /api/health 대기…" -ForegroundColor DarkGray
        } else {
            Write-Host "==> :8000 이미 사용 중 — 기존 API 로 진행" -ForegroundColor Yellow
        }
    } else {
        Write-Host "==> MEMO_DEV_SKIP_API=1 — API 창 생략, health 만 확인" -ForegroundColor Yellow
    }

    Write-Host "==> API 헬스체크 (http://127.0.0.1:8000/api/health)" -ForegroundColor Cyan
    Wait-DevApiHealthy -Url "http://127.0.0.1:8000/api/health" -TimeoutSec 120
    Write-Host "    OK" -ForegroundColor Green

    if (Test-DevTcpPortOpen -Port 3000) {
        Write-Host ""
        Write-Host ":3000 이 이미 열려 있습니다. Next 를 중복 실행하지 않습니다." -ForegroundColor Yellow
        Write-Host "  브라우저에서 http://localhost:3000 을 새로고침 하거나, 해당 프로세스를 종료한 뒤 다시 dev-all 을 실행하세요." -ForegroundColor Gray
        exit 0
    }

    Write-Host "==> Next.js dev (이 터미널, :3000)" -ForegroundColor Green
    Write-Host ""
    & (Join-Path $PSScriptRoot "dev-web.ps1")
}
finally {
    Pop-Location
}
