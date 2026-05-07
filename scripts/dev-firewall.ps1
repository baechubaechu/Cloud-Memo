# 폰/태블릿이 같은 WiFi에서 dev 서버에 닿게 하려고 Windows Defender 방화벽
# inbound 룰을 추가합니다.
# 한 번만, 관리자 권한 PowerShell에서 실행하세요.
#
# 사용법:
#   1) 시작메뉴 -> Windows PowerShell -> 우클릭 -> "관리자 권한으로 실행"
#   2) 거기서: cd <repo>; .\scripts\dev-firewall.ps1

$ErrorActionPreference = "Stop"

$adminCheck = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $adminCheck) {
    Write-Host "이 스크립트는 관리자 권한 PowerShell 에서 실행해야 합니다." -ForegroundColor Yellow
    Write-Host "  - 시작메뉴 -> Windows PowerShell -> 우클릭 -> '관리자 권한으로 실행'"
    Write-Host "  - 그 뒤: cd '$((Split-Path $PSScriptRoot -Parent))'; .\scripts\dev-firewall.ps1"
    exit 1
}

$rules = @(
    @{ Name = "Cloud Memo Dev Web (3000)"; Port = 3000 }
    @{ Name = "Cloud Memo Dev API (8000)"; Port = 8000 }
)

foreach ($r in $rules) {
    $existing = Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "EXISTS : $($r.Name)" -ForegroundColor DarkGray
    } else {
        New-NetFirewallRule -DisplayName $r.Name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $r.Port -Profile Private,Domain | Out-Null
        Write-Host "CREATED: $($r.Name)" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "완료. 폰/태블릿에서 같은 WiFi 로 LAN IP 에 접속하시면 됩니다." -ForegroundColor Cyan
