# 로컬 백엔드 개발 서버 (FastAPI + uvicorn --reload)
# 사용법: powershell.exe -ExecutionPolicy Bypass -File .\scripts\dev-api.ps1
# 사전조건: docker compose up -d memo-postgres 가 떠 있고, .venv 가 만들어져 있어야 함.

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$apiDir   = Join-Path $repoRoot "api"
$venvPy   = Join-Path $apiDir ".venv\Scripts\python.exe"

. (Join-Path $PSScriptRoot "_lib.ps1")

if (-not (Test-Path $venvPy)) {
    Write-Host "venv가 없습니다. 다음을 먼저 실행하세요:"
    Write-Host "  cd api; python -m venv .venv; .\.venv\Scripts\python -m pip install -r requirements.txt"
    exit 1
}

# LAN IP 자동 감지 → CORS 에 자동 추가
$lan = Get-PrimaryLanIp
$origins = @("http://localhost:3000", "http://127.0.0.1:3000")
if ($lan) {
    $origins += "http://$($lan):3000"
}

# 로컬 dev 환경변수
$env:DATABASE_URL                  = "postgresql://memo:memo@localhost:5432/memo"
$env:JWT_SECRET                    = "dev-local-secret-change-me"
$env:UPLOAD_DIR                    = (Join-Path $repoRoot "data\uploads")
$env:EXPORT_DIR                    = (Join-Path $repoRoot "data\exports")
$env:BACKUP_DIR                    = (Join-Path $repoRoot "data\backups")
$env:CORS_ORIGINS                  = $origins -join ","
$env:INITIAL_USER_EMAIL            = "admin@local"
$env:INITIAL_USER_PASSWORD         = "1234"
$env:VERSION_AUTOSAVE_MIN_SECONDS  = "120"
$env:MAX_UPLOAD_MB                 = "25"

# 업로드 디렉터리 보장
foreach ($d in @($env:UPLOAD_DIR, $env:EXPORT_DIR, $env:BACKUP_DIR)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

Show-DevHostBanner -Role "API" -LocalUrl "http://localhost:8000" -LanIp $lan
Write-Host "CORS 허용: $env:CORS_ORIGINS" -ForegroundColor DarkGray

Push-Location $apiDir
try {
    Write-Host "==> alembic upgrade head" -ForegroundColor Cyan
    & $venvPy -m alembic upgrade head
    if ($LASTEXITCODE -ne 0) { throw "alembic 실패" }

    Write-Host "==> 초기 사용자 부트스트랩 (이미 있으면 skip)" -ForegroundColor Cyan
    & $venvPy -m app.bootstrap

    Write-Host "==> uvicorn --reload (host 0.0.0.0, port 8000)" -ForegroundColor Green
    & $venvPy -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
}
finally {
    Pop-Location
}
