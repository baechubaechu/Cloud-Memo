# 로컬 프런트엔드 개발 서버 (Next.js dev + Fast Refresh)
# 사용법: powershell.exe -ExecutionPolicy Bypass -File .\scripts\dev-web.ps1
# 사전조건: dev-api.ps1 가 8000 포트에서 떠 있어야 함.

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$webDir   = Join-Path $repoRoot "web"

. (Join-Path $PSScriptRoot "_lib.ps1")

# LAN IP 자동 감지: 폰/태블릿에서도 같은 주소가 닿게 NEXT_PUBLIC_API_URL 을 LAN IP 로 세팅.
# (localhost 로 두면 폰에서 'localhost' 가 폰 자기 자신을 가리켜서 API 호출이 실패함)
$lan = Get-PrimaryLanIp
if ($lan) {
    $env:NEXT_PUBLIC_API_URL = "http://$($lan):8000"
} else {
    $env:NEXT_PUBLIC_API_URL = "http://localhost:8000"
}

# 로컬 개발 전용 자동 로그인. dev-api 의 초기 계정과 동일하게 맞춰둠.
# 프로덕션 빌드(docker compose)에서는 이 변수들이 안 들어가므로 자동 로그인이 켜지지 않음.
$env:NEXT_PUBLIC_DEV_AUTOLOGIN = "1"
$env:NEXT_PUBLIC_DEV_PASSWORD  = "1234"

Show-DevHostBanner -Role "WEB" -LocalUrl "http://localhost:3000" -LanIp $lan
Write-Host "NEXT_PUBLIC_API_URL = $env:NEXT_PUBLIC_API_URL" -ForegroundColor DarkGray
if ($lan) {
    Write-Host ("안드로이드 Chrome 으로 http://{0}:3000 접속 후 메뉴에서 '홈 화면에 추가' 가능" -f $lan) -ForegroundColor Green
}

Push-Location $webDir
try {
    if (-not (Test-Path (Join-Path $webDir "node_modules\next"))) {
        Write-Host "==> npm install" -ForegroundColor Cyan
        npm install
    }
    Write-Host "==> next dev -H 0.0.0.0 -p 3000" -ForegroundColor Green
    # 0.0.0.0 으로 명시 바인딩해서 LAN 접속을 보장
    npx next dev -H 0.0.0.0 -p 3000
}
finally {
    Pop-Location
}
