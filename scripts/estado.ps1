[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

docker compose ps
if ($LASTEXITCODE -ne 0) { throw 'No fue posible consultar Docker Compose.' }

$web = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1/healthz' -TimeoutSec 5
$api = Invoke-RestMethod -Uri 'http://127.0.0.1/api/health/ready' -TimeoutSec 5
Write-Host "Frontend HTTP: $($web.StatusCode)"
Write-Host "Backend: $($api.status)"

$status = Join-Path $ProjectRoot 'backups\last-success.env'
if (Test-Path $status) {
  Write-Host 'Ultimo respaldo verificado:'
  Get-Content -LiteralPath $status | ForEach-Object { Write-Host "  $_" }
} else {
  Write-Warning 'Aun no existe un estado de respaldo exitoso.'
}
