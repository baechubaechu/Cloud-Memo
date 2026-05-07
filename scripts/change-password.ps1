# Cloud Memo password changer (Windows PowerShell)
# Usage:
#   powershell.exe -ExecutionPolicy Bypass -File .\scripts\change-password.ps1
#   powershell.exe -ExecutionPolicy Bypass -File .\scripts\change-password.ps1 -NewPassword "newpass"
#   powershell.exe -ExecutionPolicy Bypass -File .\scripts\change-password.ps1 -Mode docker -NewPassword "newpass"
#
# Mode:
# - auto   : choose docker if docker compose is available, otherwise local
# - docker : run inside memo-api container
# - local  : run with api/.venv Python

param(
    [ValidateSet("auto", "docker", "local")]
    [string]$Mode = "auto",
    [string]$NewPassword = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$apiDir = Join-Path $repoRoot "api"
$venvPy = Join-Path $apiDir ".venv\Scripts\python.exe"

if ([string]::IsNullOrWhiteSpace($NewPassword)) {
    $NewPassword = Read-Host "Enter new password" -MaskInput
}
if ([string]::IsNullOrWhiteSpace($NewPassword)) {
    Write-Host "Password must not be empty." -ForegroundColor Red
    exit 1
}

$dockerAvailable = $false
try {
    Push-Location $repoRoot
    docker compose ps | Out-Null
    $dockerAvailable = $true
} catch {
    $dockerAvailable = $false
} finally {
    Pop-Location
}

$resolvedMode = $Mode
if ($Mode -eq "auto") {
    if ($dockerAvailable) {
        $resolvedMode = "docker"
    } else {
        $resolvedMode = "local"
    }
}

if ($resolvedMode -eq "docker") {
    Push-Location $repoRoot
    try {
        docker compose exec -T memo-api python -m app.scripts.change_password_cli --password $NewPassword
    } finally {
        Pop-Location
    }
    Write-Host "Done: password updated in docker mode." -ForegroundColor Green
    exit 0
}

if (-not (Test-Path $venvPy)) {
    Write-Host "Missing local venv Python: $venvPy" -ForegroundColor Red
    Write-Host "Run: cd api; python -m venv .venv; .\.venv\Scripts\python -m pip install -r requirements.txt"
    exit 1
}

Push-Location $apiDir
try {
    & $venvPy -m app.scripts.change_password_cli --password $NewPassword
} finally {
    Pop-Location
}
Write-Host "Done: password updated in local mode." -ForegroundColor Green
