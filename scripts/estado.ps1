[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

docker compose ps
if ($LASTEXITCODE -ne 0) { throw 'No fue posible consultar Docker Compose.' }

$webStatus = & curl.exe --ssl-no-revoke --silent --show-error --output NUL --write-out '%{http_code}' 'https://127.0.0.1/healthz'
if ($LASTEXITCODE -ne 0 -or $webStatus -ne '200') {
  throw "El frontend HTTPS no respondió correctamente (HTTP $webStatus)."
}
$apiRaw = & curl.exe --ssl-no-revoke --silent --show-error 'https://127.0.0.1/api/health/ready'
if ($LASTEXITCODE -ne 0) { throw 'El backend HTTPS no respondió.' }
$api = $apiRaw | ConvertFrom-Json
Write-Host "Frontend HTTPS: $webStatus"
Write-Host "Backend: $($api.status)"

$status = Join-Path $ProjectRoot 'backups\last-success.env'
if (Test-Path $status) {
  Write-Host 'Ultimo respaldo verificado:'
  Get-Content -LiteralPath $status | ForEach-Object { Write-Host "  $_" }
} else {
  Write-Warning 'Aun no existe un estado de respaldo exitoso.'
}
