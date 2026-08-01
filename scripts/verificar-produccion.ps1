[CmdletBinding()]
param(
  [string]$EnvironmentFile = '.env'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot
$envPath = Join-Path $ProjectRoot $EnvironmentFile
if (-not (Test-Path -LiteralPath $envPath)) { throw "No existe $EnvironmentFile." }

$values = @{}
Get-Content -LiteralPath $envPath | ForEach-Object {
  if ($_ -match '^(?<key>[A-Z0-9_]+)=(?<value>.*)$') {
    $values[$Matches.key] = $Matches.value.Trim('"')
  }
}

$checks = [System.Collections.Generic.List[object]]::new()
function Add-Check([string]$Name, [bool]$Passed, [string]$Detail) {
  $checks.Add([pscustomobject]@{ Control = $Name; Estado = $(if ($Passed) { 'OK' } else { 'PENDIENTE' }); Detalle = $Detail })
}

$dbPassword = [string]$values.DB_PASSWORD
$jwtSecret = [string]$values.JWT_SECRET
$corsOrigin = [string]$values.CORS_ORIGIN
Add-Check 'NODE_ENV de producción' ($values.NODE_ENV -eq 'production') "Actual: $($values.NODE_ENV)"
Add-Check 'Validación estricta' ($values.STRICT_ENV_VALIDATION -eq 'true') "Actual: $($values.STRICT_ENV_VALIDATION)"
Add-Check 'Cookie segura' ($values.COOKIE_SECURE -eq 'true') "Actual: $($values.COOKIE_SECURE)"
Add-Check 'Contraseña PostgreSQL robusta' ($dbPassword.Length -ge 16) 'Mínimo operativo: 16 caracteres'
Add-Check 'Secreto de sesión robusto' ($jwtSecret.Length -ge 32) 'Mínimo: 32 caracteres'
Add-Check 'Origen HTTPS explícito' ($corsOrigin -match '^https://[^,*]+(,https://[^,*]+)*$') "Actual: $corsOrigin"
Add-Check 'Sin valores de ejemplo' (-not (($values.Values -join ' ') -match 'reemplaza_|changeme|example')) 'No deben quedar marcadores'
Add-Check 'Certificado local' (Test-Path -LiteralPath (Join-Path $ProjectRoot 'certs\ldsm-lan.pem')) 'certs\ldsm-lan.pem'
Add-Check 'Clave del certificado' (Test-Path -LiteralPath (Join-Path $ProjectRoot 'certs\ldsm-lan-key.pem')) 'certs\ldsm-lan-key.pem'

$dockerService = Get-Service -Name 'com.docker.service' -ErrorAction SilentlyContinue
Add-Check 'Servicio Docker instalado' ($null -ne $dockerService) $(if ($dockerService) { "Inicio: $($dockerService.StartType)" } else { 'No detectado' })
$systemDrive = if (Get-Command Get-BitLockerVolume -ErrorAction SilentlyContinue) {
  Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction SilentlyContinue
} else { $null }
Add-Check 'Disco del servidor cifrado' ($systemDrive.ProtectionStatus -eq 'On') $(if ($systemDrive) { "Protección: $($systemDrive.ProtectionStatus)" } else { 'No verificable sin permisos' })

$checks | Format-Table -AutoSize
$pending = @($checks | Where-Object Estado -ne 'OK').Count
if ($pending -gt 0) {
  Write-Warning "Existen $pending controles pendientes. No declarar la instalación lista para producción."
  exit 2
}
Write-Host 'Todos los controles automatizables de producción están conformes.' -ForegroundColor Green
