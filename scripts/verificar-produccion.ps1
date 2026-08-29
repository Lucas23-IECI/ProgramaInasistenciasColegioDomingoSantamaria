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
$rootCertificatePath = Join-Path $ProjectRoot 'certs\rootCA.pem'
Add-Check 'Autoridad pública disponible' (Test-Path -LiteralPath $rootCertificatePath) 'certs\rootCA.pem'
Add-Check 'Clave privada de la autoridad fuera del proyecto' (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'certs\rootCA-key.pem'))) 'No distribuir ni copiar rootCA-key.pem'

$lanIp = [string]$values.LDSM_LAN_IP
$hostname = [string]$values.LDSM_HOSTNAME
$certificatePath = Join-Path $ProjectRoot 'certs\ldsm-lan.pem'
$certificateDump = ''
if (Test-Path -LiteralPath $certificatePath) {
  $certificateDump = (& certutil.exe -dump $certificatePath 2>$null | Out-String)
}
$identityDeclared = -not [string]::IsNullOrWhiteSpace($lanIp) -and -not [string]::IsNullOrWhiteSpace($hostname)
$certificateMatches = $identityDeclared -and
  $certificateDump.Contains($lanIp) -and $certificateDump.Contains($hostname)
Add-Check 'Identidad HTTPS declarada' $identityDeclared $(if ($identityDeclared) { "$hostname / $lanIp" } else { 'Faltan LDSM_HOSTNAME o LDSM_LAN_IP' })
Add-Check 'Certificado para nombre e IP vigentes' $certificateMatches $(if ($certificateMatches) { 'Nombre e IP incluidos' } else { 'Regenerar el certificado para la identidad vigente' })

$declaredOrigins = @($corsOrigin.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$expectedOrigins = @("https://$hostname", "https://$lanIp")
$originsMatchIdentity = $identityDeclared -and @($expectedOrigins | Where-Object { $_ -notin $declaredOrigins }).Count -eq 0
Add-Check 'CORS coincide con nombre e IP HTTPS' $originsMatchIdentity $(if ($originsMatchIdentity) { 'Ambos orígenes autorizados' } else { 'CORS_ORIGIN no coincide con la identidad declarada' })

$liveHttpsStatus = ''
$liveHttpsPassed = $false
if ($identityDeclared -and (Test-Path -LiteralPath $certificatePath) -and (Test-Path -LiteralPath $rootCertificatePath)) {
  $liveHttpsStatus = (& curl.exe --ssl-no-revoke --silent --show-error --max-time 10 --cacert $rootCertificatePath --output NUL --write-out '%{http_code}' "https://$lanIp/healthz" 2>$null)
  $liveHttpsPassed = $LASTEXITCODE -eq 0 -and $liveHttpsStatus -eq '200'
}
Add-Check 'HTTPS servido con certificado confiable' $liveHttpsPassed $(if ($liveHttpsPassed) { 'Respuesta 200 y cadena verificada' } else { 'No se pudo validar la URL HTTPS sin omitir controles TLS' })

$dockerService = Get-Service -Name 'com.docker.service' -ErrorAction SilentlyContinue
$dockerServiceReady = $null -ne $dockerService -and $dockerService.StartType -eq 'Automatic' -and $dockerService.Status -eq 'Running'
Add-Check 'Servicio Docker automatico y activo' $dockerServiceReady $(if ($dockerService) { "Inicio: $($dockerService.StartType); estado: $($dockerService.Status)" } else { 'No detectado' })
$dockerEngineReady = $false
try {
  docker info *> $null
  $dockerEngineReady = $LASTEXITCODE -eq 0
} catch { $dockerEngineReady = $false }
Add-Check 'Motor Docker disponible' $dockerEngineReady $(if ($dockerEngineReady) { 'Responde correctamente' } else { 'No responde; la aplicacion no sobrevivira un reinicio' })
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
