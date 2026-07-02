# 공용 PowerShell 헬퍼 — dev-api.ps1 / dev-web.ps1 에서 dot-source 로 사용

function Get-PrimaryLanIp {
    <#
    .SYNOPSIS
        외부망(8.8.8.8)으로 패킷이 나갈 때 사용되는 로컬 IPv4 주소를 반환.
        Hyper-V/WSL/도커 가상 인터페이스는 자연스럽게 제외됨.
        Tailscale 등 풀터널 VPN이 켜져 있으면 그쪽 IP가 잡힐 수 있는데
        그땐 환경변수 MEMO_DEV_LAN_IP 로 강제 지정 가능.
    #>
    if ($env:MEMO_DEV_LAN_IP) {
        return $env:MEMO_DEV_LAN_IP
    }

    try {
        $route = Find-NetRoute -RemoteIPAddress 8.8.8.8 -ErrorAction Stop |
                 Select-Object -First 1
        if ($route -and $route.IPAddress) {
            return $route.IPAddress
        }
    } catch {
        # Find-NetRoute 가 실패하면 fallback 으로
    }

    # 폴백: 기본 게이트웨이가 있는 첫 인터페이스의 IPv4
    try {
        $cfg = Get-NetIPConfiguration -ErrorAction Stop |
               Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } |
               Select-Object -First 1
        if ($cfg -and $cfg.IPv4Address) {
            return $cfg.IPv4Address[0].IPAddress
        }
    } catch {}

    return $null
}

function Show-DevHostBanner {
    param(
        [string] $Role,        # "API" or "WEB"
        [string] $LocalUrl,    # http://localhost:PORT
        [string] $LanIp        # null 가능
    )
    Write-Host ""
    Write-Host "==[ $Role ]====================================" -ForegroundColor Cyan
    Write-Host "  PC 에서:    $LocalUrl"
    if ($LanIp) {
        $port = ($LocalUrl -split ':')[-1]
        Write-Host "  같은 WiFi: http://$($LanIp):$port" -ForegroundColor Green
    } else {
        Write-Host "  LAN IP 자동감지 실패 — `$env:MEMO_DEV_LAN_IP 로 직접 지정해 주세요." -ForegroundColor Yellow
    }
    Write-Host "================================================="
    Write-Host ""
}

function Test-DevTcpPortOpen {
    param([int] $Port)
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $c.ReceiveTimeout = 500
        $c.SendTimeout = 500
        $c.Connect("127.0.0.1", $Port)
        $c.Close()
        return $true
    } catch {
        return $false
    }
}

function Wait-MemoPostgresHealthy {
    param(
        [int] $TimeoutSec = 120,
        [string] $ContainerName = "memo-postgres"
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $raw = docker inspect $ContainerName 2>$null
        if (-not $raw) {
            Start-Sleep -Seconds 2
            continue
        }
        $j = $raw | ConvertFrom-Json
        if (-not $j) { Start-Sleep -Seconds 2; continue }
        $state = $j[0].State
        if ($state.Health -and $state.Health.Status -eq "healthy") { return }
        Start-Sleep -Seconds 2
    }
    throw "Docker 컨테이너 '$ContainerName' 이(가) ${TimeoutSec}s 안에 healthy 가 되지 않았습니다. Docker Desktop 과 로그를 확인하세요."
}

function Wait-DevApiHealthy {
    param(
        [string] $Url = "http://127.0.0.1:8000/api/health",
        [int] $TimeoutSec = 120
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -eq 200) { return }
        } catch {}
        Start-Sleep -Milliseconds 800
    }
    throw "API 가 응답하지 않습니다: $Url (${TimeoutSec}s 타임아웃). dev-api 창의 에러 로그를 확인하세요."
}
