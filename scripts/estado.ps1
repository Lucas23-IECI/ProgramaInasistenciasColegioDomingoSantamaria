[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

docker compose ps
if ($LASTEXITCODE -ne 0) { throw 'No fue posible consultar Docker Compose.' }

$requiredServices = @('postgres', 'backend', 'frontend', 'backup')
foreach ($service in $requiredServices) {
  $containerId = [string](& docker compose ps --all -q $service)
  $containerId = $containerId.Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($containerId)) {
    throw "El servicio $service no tiene un contenedor creado."
  }

  $containerState = (& docker inspect --format '{{.State.Status}}' $containerId).Trim()
  $healthState = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}sin-control{{end}}' $containerId).Trim()
  if ($LASTEXITCODE -ne 0) { throw "No fue posible consultar el estado del servicio $service." }
  if ($containerState -ne 'running' -or $healthState -ne 'healthy') {
    throw "El servicio $service no esta saludable (estado: $containerState; control: $healthState)."
  }
}

# ── Detectar si HTTPS está disponible (puerto 443) o usar HTTP (puerto 80) ──
$scheme    = $null
$webStatus = $null

# Intentar HTTPS primero (silenciosamente, sin romper si falla)
try {
  $ErrorActionPreference = 'Continue'
  $webStatus = & curl.exe --ssl-no-revoke --insecure --silent --max-time 5 --output NUL --write-out '%{http_code}' 'https://127.0.0.1/healthz' 2>&1 | Where-Object { $_ -match '^\d+$' }
  $ErrorActionPreference = 'Stop'
  if ($webStatus -eq '200') { $scheme = 'https' }
} catch {
  $ErrorActionPreference = 'Stop'
}

# Si HTTPS no funcionó, intentar HTTP
if (-not $scheme) {
  $webStatus = & curl.exe --silent --max-time 5 --output NUL --write-out '%{http_code}' 'http://127.0.0.1/healthz'
  if ($LASTEXITCODE -ne 0 -or $webStatus -ne '200') {
    throw "El frontend no respondio correctamente ni por HTTPS ni por HTTP (HTTP $webStatus)."
  }
  $scheme = 'http'
}

$apiRaw = & curl.exe --ssl-no-revoke --insecure --silent "${scheme}://127.0.0.1/api/health/ready"
if ($LASTEXITCODE -ne 0) { throw "El backend no respondio por ${scheme}." }
$api = $apiRaw | ConvertFrom-Json
if ($api.status -ne 'OK' -or $api.database -ne 'ready') {
  throw "El backend respondio, pero no esta listo (servicio: $($api.status); base: $($api.database))."
}

Write-Host "Frontend ($($scheme.ToUpper())): $webStatus"
Write-Host "Backend: $($api.status)"

$status = Join-Path $ProjectRoot 'backups\last-success.env'
if (Test-Path $status) {
  $backupValues = @{}
  Get-Content -LiteralPath $status | ForEach-Object {
    if ($_ -match '^(?<key>[a-z]+)=(?<value>.+)$') { $backupValues[$Matches.key] = $Matches.value.Trim() }
  }
  foreach ($key in @('timestamp', 'database', 'documents', 'manifest')) {
    if ([string]::IsNullOrWhiteSpace([string]$backupValues[$key])) {
      throw "El estado del respaldo esta incompleto: falta $key."
    }
  }

  try { $backupTimestamp = [DateTimeOffset]::Parse([string]$backupValues.timestamp) }
  catch { throw 'La fecha del ultimo respaldo no es valida.' }
  $backupAge = [DateTimeOffset]::Now - $backupTimestamp
  if ($backupAge.TotalHours -gt 26 -or $backupAge.TotalMinutes -lt -5) {
    throw "El ultimo respaldo verificado no esta vigente (antiguedad: $([Math]::Round($backupAge.TotalHours, 1)) horas)."
  }

  foreach ($key in @('database', 'documents', 'manifest')) {
    $fileName = [string]$backupValues[$key]
    if ([IO.Path]::GetFileName($fileName) -ne $fileName) {
      throw "El estado del respaldo contiene una ruta no valida en $key."
    }
    $backupFile = Join-Path (Join-Path $ProjectRoot 'backups') $fileName
    if (-not (Test-Path -LiteralPath $backupFile -PathType Leaf) -or (Get-Item -LiteralPath $backupFile).Length -le 0) {
      throw "Falta el archivo verificado del respaldo: $fileName."
    }
  }

  Write-Host 'Ultimo respaldo verificado:'
  Get-Content -LiteralPath $status | ForEach-Object { Write-Host "  $_" }
} else {
  throw 'Aun no existe un estado de respaldo exitoso.'
}

Write-Host 'Servicios, aplicacion y respaldo: saludables.' -ForegroundColor Green
