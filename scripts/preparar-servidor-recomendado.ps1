[CmdletBinding()]
param(
  [string]$LanIp = '',
  [string]$Hostname = 'asistencia.ldsm.test',
  [switch]$OmitirRespaldo
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EnvironmentFile = Join-Path $ProjectRoot '.env'
$NextEnvironmentFile = Join-Path $ProjectRoot '.env.recommended-next'
$BackupEnvironmentFile = Join-Path $ProjectRoot '.env.recommended-backup'
$ComposeFiles = @('-f', 'docker-compose.yml', '-f', 'docker-compose.https.yml')
Set-Location $ProjectRoot

function Invoke-NativeChecked([string]$Description, [scriptblock]$Action) {
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "Falló: $Description." }
}

function New-HexSecret([int]$Bytes) {
  $buffer = New-Object byte[] $Bytes
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
  return (($buffer | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Get-LanAddress {
  $candidate = Get-NetIPConfiguration |
    Where-Object { $_.NetAdapter.Status -eq 'Up' -and $_.IPv4DefaultGateway } |
    ForEach-Object { $_.IPv4Address.IPAddress } |
    Where-Object { $_ -and $_ -notlike '169.254.*' } |
    Select-Object -First 1
  if (-not $candidate) { throw 'No se encontró una dirección IPv4 activa con puerta de enlace.' }
  return $candidate
}

function Read-EnvironmentValues([string]$Path) {
  $result = @{}
  Get-Content -LiteralPath $Path | ForEach-Object {
    if ($_ -match '^(?<key>[A-Z0-9_]+)=(?<value>.*)$') {
      $result[$Matches.key] = $Matches.value.Trim('"')
    }
  }
  return $result
}

function Write-UpdatedEnvironment([string]$Source, [string]$Destination, [hashtable]$Updates) {
  $written = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  $output = [System.Collections.Generic.List[string]]::new()
  foreach ($line in Get-Content -LiteralPath $Source) {
    if ($line -match '^(?<key>[A-Z0-9_]+)=') {
      $key = $Matches.key
      if ($written.Contains($key)) { continue }
      if ($Updates.ContainsKey($key)) {
        $output.Add("$key=$($Updates[$key])")
      } else {
        $output.Add($line)
      }
      [void]$written.Add($key)
    } else {
      $output.Add($line)
    }
  }
  foreach ($key in $Updates.Keys | Sort-Object) {
    if (-not $written.Contains($key)) { $output.Add("$key=$($Updates[$key])") }
  }
  [System.IO.File]::WriteAllLines($Destination, $output, [System.Text.UTF8Encoding]::new($false))
}

function Set-DatabaseRolePassword([string]$DatabaseUser, [string]$DatabaseName, [string]$Password) {
  if ($DatabaseUser -notmatch '^[A-Za-z_][A-Za-z0-9_]*$' -or $DatabaseName -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
    throw 'El usuario o la base configurada no tienen un identificador seguro.'
  }
  $escapedPassword = $Password.Replace("'", "''")
  $sql = "ALTER ROLE `"$DatabaseUser`" WITH PASSWORD '$escapedPassword';"
  $sql | docker compose exec -T postgres psql -U $DatabaseUser -d $DatabaseName -v ON_ERROR_STOP=1 --quiet
  if ($LASTEXITCODE -ne 0) { throw 'No fue posible rotar coordinadamente la contraseña de PostgreSQL.' }
}

function Wait-DatabaseReady([string]$DatabaseUser, [string]$DatabaseName) {
  for ($attempt = 1; $attempt -le 30; $attempt += 1) {
    docker compose exec -T postgres pg_isready -U $DatabaseUser -d $DatabaseName *> $null
    if ($LASTEXITCODE -eq 0) { return }
    Start-Sleep -Seconds 2
  }
  throw 'PostgreSQL no quedó disponible después de 60 segundos. No se modificó la configuración.'
}

function New-VerifiedBackup {
  docker compose run --rm --no-deps --entrypoint sh backup /backup.sh
  if ($LASTEXITCODE -ne 0) { throw 'La preparación se detuvo porque el respaldo previo falló.' }
  $status = Join-Path $ProjectRoot 'backups\last-success.env'
  if (-not (Test-Path -LiteralPath $status)) {
    throw 'El respaldo terminó sin crear el archivo de verificación esperado.'
  }
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) { throw 'La preparación inicial debe ejecutarse una vez en PowerShell como administrador.' }
if (-not (Test-Path -LiteralPath $EnvironmentFile)) { throw 'No existe .env. No se modificó la instalación.' }

$dockerService = Get-Service -Name 'com.docker.service' -ErrorAction SilentlyContinue
if (-not $dockerService) { throw 'No se encontró el servicio de Docker Desktop. Instala o repara Docker antes de continuar.' }
Set-Service -Name 'com.docker.service' -StartupType Automatic
if ((Get-Service -Name 'com.docker.service').Status -ne 'Running') {
  Start-Service -Name 'com.docker.service'
  (Get-Service -Name 'com.docker.service').WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
}

Invoke-NativeChecked 'consultar Docker' { docker info *> $null }
if ([string]::IsNullOrWhiteSpace($LanIp)) { $LanIp = Get-LanAddress }

$values = Read-EnvironmentValues $EnvironmentFile
$databaseUser = [string]$values.DB_USER
$databaseName = [string]$values.DB_NAME
$oldDatabasePassword = [string]$values.DB_PASSWORD
$newDatabasePassword = $oldDatabasePassword
if ([string]::IsNullOrWhiteSpace($databaseUser) -or
    [string]::IsNullOrWhiteSpace($databaseName) -or
    [string]::IsNullOrWhiteSpace($oldDatabasePassword)) {
  throw 'DB_USER, DB_NAME y DB_PASSWORD deben estar definidos en .env. No se modificó la instalación.'
}

Invoke-NativeChecked 'iniciar PostgreSQL con la configuración vigente' { docker compose up -d postgres }
Wait-DatabaseReady $databaseUser $databaseName
$databaseIsRunning = $true

if (-not $OmitirRespaldo) { New-VerifiedBackup }

if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw 'Falta mkcert y winget no está disponible para instalarlo automáticamente.'
  }
  Invoke-NativeChecked 'instalar mkcert' {
    winget install --id FiloSottile.mkcert -e --silent --accept-package-agreements --accept-source-agreements
  }
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machinePath;$userPath"
  if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
    throw 'mkcert se instaló, pero esta consola todavía no puede encontrarlo. Cierra PowerShell, vuelve a abrirlo y repite el script.'
  }
}

& "$PSScriptRoot\preparar-https-red-interna.ps1" -LanIp $LanIp -Hostname $Hostname -InstalarAutoridadLocal
if ($LASTEXITCODE -ne 0) { throw 'No fue posible preparar el certificado HTTPS.' }

if ($newDatabasePassword.Length -lt 16) { $newDatabasePassword = New-HexSecret 32 }
$jwtSecret = [string]$values.JWT_SECRET
if ($jwtSecret.Length -lt 32) { $jwtSecret = New-HexSecret 48 }
$defaultPassword = [string]$values.DEFAULT_USER_PASSWORD
if ($defaultPassword -match 'reemplaza_|changeme|example' -or $defaultPassword.Length -lt 12) {
  $defaultPassword = "Ldsm-$(New-HexSecret 10)-A9"
}
$httpsOrigins = "https://$Hostname,https://$LanIp"
$updates = @{
  DB_PASSWORD = $newDatabasePassword
  JWT_SECRET = $jwtSecret
  DEFAULT_USER_PASSWORD = $defaultPassword
  NODE_ENV = 'production'
  STRICT_ENV_VALIDATION = 'true'
  COOKIE_SECURE = 'true'
  CORS_ORIGIN = $httpsOrigins
  HTTPS_CORS_ORIGIN = $httpsOrigins
  LDSM_LAN_IP = $LanIp
  LDSM_HOSTNAME = $Hostname
}

Remove-Item -LiteralPath $NextEnvironmentFile, $BackupEnvironmentFile -Force -ErrorAction SilentlyContinue
Write-UpdatedEnvironment $EnvironmentFile $NextEnvironmentFile $updates
$passwordRotated = $false
$environmentReplaced = $false

try {
  if ($databaseIsRunning -and $newDatabasePassword -ne $oldDatabasePassword) {
    Set-DatabaseRolePassword $databaseUser $databaseName $newDatabasePassword
    $passwordRotated = $true
  }

  [System.IO.File]::Replace($NextEnvironmentFile, $EnvironmentFile, $BackupEnvironmentFile, $true)
  $environmentReplaced = $true

  foreach ($port in 80, 443) {
    $ruleName = "LDSM - Sistema institucional (TCP $port)"
    if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Private | Out-Null
    }
  }

  Invoke-NativeChecked 'validar Docker Compose HTTPS' { docker compose @ComposeFiles config --quiet }
  Invoke-NativeChecked 'construir las imágenes HTTPS' { docker compose @ComposeFiles build }
  Invoke-NativeChecked 'iniciar y esperar HTTPS' { docker compose @ComposeFiles up -d --wait --wait-timeout 180 }
} catch {
  $originalError = $_
  try {
    if ($environmentReplaced -and (Test-Path -LiteralPath $BackupEnvironmentFile)) {
      Copy-Item -LiteralPath $BackupEnvironmentFile -Destination $EnvironmentFile -Force
    }
    if ($passwordRotated) {
      Set-DatabaseRolePassword $databaseUser $databaseName $oldDatabasePassword
    }
    docker compose up -d *> $null
  } finally {
    Remove-Item -LiteralPath $BackupEnvironmentFile -Force -ErrorAction SilentlyContinue
  }
  throw $originalError
} finally {
  Remove-Item -LiteralPath $NextEnvironmentFile -Force -ErrorAction SilentlyContinue
}

Remove-Item -LiteralPath $BackupEnvironmentFile -Force -ErrorAction SilentlyContinue
& "$PSScriptRoot\estado.ps1"
if ($LASTEXITCODE -ne 0) { throw 'El modo HTTPS se inició, pero no superó la comprobación de salud.' }

& "$PSScriptRoot\verificar-produccion.ps1"
if ($LASTEXITCODE -ne 0) { throw 'HTTPS funciona, pero el diagnóstico anterior todavía exige resolver controles de producción.' }

& "$PSScriptRoot\instalar-actualizacion-por-pull.ps1"
if ($LASTEXITCODE -ne 0) { throw 'HTTPS quedó activo, pero no pudo habilitarse la actualización automática por pull.' }

Write-Host ''
Write-Host 'Preparación recomendada completada.' -ForegroundColor Green
Write-Host "Acceso seguro por IP: https://$LanIp"
Write-Host "Acceso por nombre cuando exista DNS interno: https://$Hostname"
Write-Host 'La autoridad raíz pública debe instalarse una sola vez en cada equipo autorizado.'
