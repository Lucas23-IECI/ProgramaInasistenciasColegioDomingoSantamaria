[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

docker compose ps
if ($LASTEXITCODE -ne 0) { throw 'No fue posible consultar Docker Compose.' }

# ── Detectar si HTTPS está disponible (puerto 443) o usar HTTP (puerto 80) ──
$scheme   = 'https'
$webStatus = & curl.exe --ssl-no-revoke --insecure --silent --show-error --max-time 5 --output NUL --write-out '%{http_code}' 'https://127.0.0.1/healthz' 2>$null
if ($LASTEXITCODE -ne 0 -or $webStatus -ne '200') {
  # HTTPS no responde, intentar HTTP
  $scheme   = 'http'
  $webStatus = & curl.exe --silent --show-error --max-time 5 --output NUL --write-out '%{http_code}' 'http://127.0.0.1/healthz' 2>$null
  if ($LASTEXITCODE -ne 0 -or $webStatus -ne '200') {
    throw "El frontend no respondió correctamente ni por HTTPS ni por HTTP (HTTP $webStatus)."
  }
}

$apiRaw = & curl.exe --ssl-no-revoke --insecure --silent --show-error "${scheme}://127.0.0.1/api/health/ready"
if ($LASTEXITCODE -ne 0) { throw "El backend no respondió por ${scheme}." }
$api = $apiRaw | ConvertFrom-Json

Write-Host "Frontend ($($scheme.ToUpper())): $webStatus"
Write-Host "Backend: $($api.status)"

$status = Join-Path $ProjectRoot 'backups\last-success.env'
if (Test-Path $status) {
  Write-Host 'Ultimo respaldo verificado:'
  Get-Content -LiteralPath $status | ForEach-Object { Write-Host "  $_" }
} else {
  Write-Warning 'Aun no existe un estado de respaldo exitoso.'
}
