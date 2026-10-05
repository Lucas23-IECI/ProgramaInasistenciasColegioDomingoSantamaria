[CmdletBinding()]
param(
  [switch]$PermitirOtraRama,
  [switch]$OmitirRespaldo
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BaseComposeFiles = @('-f', 'docker-compose.yml')
$ComposeFiles = $BaseComposeFiles
Set-Location $ProjectRoot
$ManagedHttps = Test-Path -LiteralPath '.https-lan\estado.json'
$UpdateMode = 'http'
$LegacyHttps = $false
if ($ManagedHttps) {
  Import-Module "$PSScriptRoot\https\Server.psm1" -Force
  $httpsState = Get-Content -LiteralPath '.https-lan\estado.json' -Raw | ConvertFrom-Json
  if (-not (Test-LdsmManagedOverride (Join-Path $ProjectRoot 'docker-compose.override.yml') $httpsState)) {
    throw 'La configuracion HTTPS local fue modificada o falta. No se reconstruyo el servidor.'
  }
  $ComposeFiles = @('-f', 'docker-compose.yml', '-f', 'docker-compose.override.yml')
  $UpdateMode = 'managed-https'
}

function Invoke-NativeChecked([string]$Description, [scriptblock]$Action) {
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "Falló: $Description." }
}

function Get-ComposeContainer([string]$Service) {
  $containerId = (& docker compose @BaseComposeFiles ps -q $Service).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($containerId)) {
    throw "El servicio $Service no tiene un contenedor iniciado. No se puede detectar la configuración existente con seguridad."
  }
  $inspection = (& docker inspect $containerId | ConvertFrom-Json)
  if ($LASTEXITCODE -ne 0 -or @($inspection).Count -ne 1) {
    throw "No se pudo inspeccionar el contenedor de $Service."
  }
  return $inspection[0]
}

function Test-PublishedPort($Container, [int]$TargetPort) {
  $key = "${TargetPort}/tcp"
  $portProperty = $Container.NetworkSettings.Ports.PSObject.Properties[$key]
  return $null -ne $portProperty -and @($portProperty.Value | Where-Object { $_ -and -not [string]::IsNullOrWhiteSpace([string]$_.HostPort) }).Count -gt 0
}

function Test-PublishedHostPort($Container, [int]$TargetPort, [int]$HostPort) {
  $key = "${TargetPort}/tcp"
  $portProperty = $Container.NetworkSettings.Ports.PSObject.Properties[$key]
  if ($null -eq $portProperty) { return $false }
  return @($portProperty.Value | Where-Object { [int]$_.HostPort -eq $HostPort }).Count -gt 0
}

function Get-PublishedHostPort($Container, [int]$TargetPort) {
  $key = "${TargetPort}/tcp"
  $portProperty = $Container.NetworkSettings.Ports.PSObject.Properties[$key]
  if ($null -eq $portProperty) { return $null }
  $binding = @($portProperty.Value | Where-Object { $_ -and -not [string]::IsNullOrWhiteSpace([string]$_.HostPort) }) | Select-Object -First 1
  if ($null -eq $binding) { return $null }
  return [int]$binding.HostPort
}

function Assert-HttpHealth([int]$HostPort) {
  $origin = "http://127.0.0.1:$HostPort"
  $webStatus = (& curl.exe --silent --show-error --noproxy '*' --max-time 10 --output NUL --write-out '%{http_code}' "$origin/healthz").Trim()
  if ($LASTEXITCODE -ne 0 -or $webStatus -ne '200') { throw "El frontend HTTP no respondio correctamente en el puerto $HostPort." }
  $apiRaw = (& curl.exe --silent --show-error --noproxy '*' --max-time 15 "$origin/api/health/ready").Trim()
  if ($LASTEXITCODE -ne 0) { throw "El backend no respondio por HTTP en el puerto $HostPort." }
  try { $api = $apiRaw | ConvertFrom-Json } catch { throw 'La respuesta de salud del backend no es JSON valido.' }
  if ($api.status -ne 'OK' -or $api.database -ne 'ready') { throw 'El backend respondio, pero la base no esta lista.' }
}

function Assert-LegacyHttpsHealth($BackendContainer) {
  $rootCertificate = Join-Path $ProjectRoot 'certs\rootCA.pem'
  $cors = Get-EnvironmentValue $BackendContainer 'CORS_ORIGIN'
  if ([string]::IsNullOrWhiteSpace($cors)) { $cors = Get-EnvironmentValue $BackendContainer 'HTTPS_CORS_ORIGIN' }
  $origins = @($cors -split ',' | ForEach-Object { $_.Trim().TrimEnd('/') } | Where-Object { $_ -match '^https://[^/]+$' })
  if ($origins.Count -eq 0) { throw 'HTTPS heredado no declara un origen HTTPS verificable en CORS_ORIGIN.' }

  foreach ($origin in $origins) {
    $health = (& curl.exe --silent --show-error --ssl-revoke-best-effort --noproxy '*' --cacert $rootCertificate --max-time 15 --output NUL --write-out '%{http_code}' "$origin/healthz" 2>$null).Trim()
    if ($LASTEXITCODE -ne 0 -or $health -ne '200') { continue }
    $apiRaw = (& curl.exe --silent --show-error --ssl-revoke-best-effort --noproxy '*' --cacert $rootCertificate --max-time 15 "$origin/api/health/ready" 2>$null).Trim()
    if ($LASTEXITCODE -ne 0) { continue }
    try { $api = $apiRaw | ConvertFrom-Json } catch { continue }
    if ($api.status -eq 'OK' -and $api.database -eq 'ready') {
      Write-Host "HTTPS heredado verificado con cadena confiable: $origin" -ForegroundColor Green
      return
    }
  }
  throw 'No se pudo verificar HTTPS heredado con la raiz configurada y un origen CORS vigente. No se declaro la actualizacion saludable.'
}

function Get-EnvironmentValue($Container, [string]$Name) {
  $prefix = "$Name="
  $entry = @($Container.Config.Env | Where-Object { $_.StartsWith($prefix, [StringComparison]::Ordinal) }) | Select-Object -First 1
  if ($null -eq $entry) { return '' }
  return $entry.Substring($prefix.Length)
}

function Assert-VerifiedBackup([DateTimeOffset]$MinimumTimestamp = [DateTimeOffset]::MinValue) {
  $statusPath = Join-Path $ProjectRoot 'backups\last-success.env'
  if (-not (Test-Path -LiteralPath $statusPath -PathType Leaf)) {
    throw 'El respaldo no dejo backups\last-success.env; no se reconstruyo el servidor.'
  }

  $values = @{}
  Get-Content -LiteralPath $statusPath | ForEach-Object {
    if ($_ -match '^(?<key>[a-z]+)=(?<value>.+)$') { $values[$Matches.key] = $Matches.value.Trim() }
  }
  foreach ($key in @('timestamp', 'database', 'documents', 'manifest')) {
    if ([string]::IsNullOrWhiteSpace([string]$values[$key])) {
      throw "El estado del respaldo no contiene $key; no se reconstruyo el servidor."
    }
  }
  try { $backupTimestamp = [DateTimeOffset]::Parse([string]$values.timestamp) }
  catch { throw 'La fecha del respaldo no es valida; no se reconstruyo el servidor.' }
  $backupAge = [DateTimeOffset]::Now - $backupTimestamp
  if ($backupAge.TotalMinutes -lt -5 -or $backupAge.TotalHours -gt 26) {
    throw 'El respaldo verificado no es reciente; no se reconstruyo el servidor.'
  }
  if ($MinimumTimestamp -ne [DateTimeOffset]::MinValue -and $backupTimestamp -lt $MinimumTimestamp.AddMinutes(-2)) {
    throw 'El respaldo informado no corresponde a esta actualización; no se reconstruyo el servidor.'
  }

  foreach ($key in @('database', 'documents', 'manifest')) {
    $fileName = [string]$values[$key]
    if ([IO.Path]::GetFileName($fileName) -ne $fileName) {
      throw "El respaldo contiene una ruta invalida en $key; no se reconstruyo el servidor."
    }
    $filePath = Join-Path (Join-Path $ProjectRoot 'backups') $fileName
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf) -or (Get-Item -LiteralPath $filePath).Length -le 0) {
      throw "Falta el archivo verificado del respaldo $fileName; no se reconstruyo el servidor."
    }
  }
}

if (-not (Test-Path -LiteralPath '.git')) {
  throw 'La carpeta actual no es la copia Git instalada del sistema.'
}

$branch = (git branch --show-current).Trim()
if (-not $PermitirOtraRama -and $branch -ne 'main') {
  throw "La actualización automática solo se ejecuta en main. Rama actual: $branch."
}

$workingTreeChanges = @(git status --porcelain=v1 --untracked-files=normal)
if ($workingTreeChanges.Count -gt 0) {
  throw 'Hay cambios o archivos locales no incorporados en el sistema. No se reconstruyó nada para evitar una versión mezclada.'
}

Invoke-NativeChecked 'consultar Docker' { docker info *> $null }

if (-not (Test-Path -LiteralPath '.env' -PathType Leaf)) {
  throw 'Falta .env. No se reconstruyo el servidor ni se genero uno nuevo automaticamente.'
}

if (-not $ManagedHttps) {
  $frontendContainer = Get-ComposeContainer 'frontend'
  $backendContainer = Get-ComposeContainer 'backend'
  $hasHttpsListener = Test-PublishedPort $frontendContainer 443
  $hasHttpListener = Test-PublishedPort $frontendContainer 80
  $cookieSecure = (Get-EnvironmentValue $backendContainer 'COOKIE_SECURE').ToLowerInvariant()

  if ($hasHttpsListener) {
    $LegacyHttps = $true
    $UpdateMode = 'legacy-https'
    $ComposeFiles = @('-f', 'docker-compose.yml', '-f', 'docker-compose.https.yml')
  } elseif ($cookieSecure -eq 'true') {
    throw 'El backend exige cookies seguras, pero no hay un listener HTTPS 443 activo. No se reconstruyo el servidor.'
  } elseif (-not $hasHttpListener) {
    throw 'No se detecto un listener HTTP 80 ni HTTPS 443 en el frontend. No se adivino la configuracion.'
  }

  $RequiredFiles = if ($LegacyHttps) { @('certs\ldsm-lan.pem', 'certs\ldsm-lan-key.pem', 'certs\rootCA.pem', 'docker-compose.https.yml') } else { @() }
  foreach ($required in $RequiredFiles) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
      throw "Se detecto HTTPS heredado, pero falta $required. No se cambio la configuracion."
    }
  }
}

if ($ManagedHttps) {
  $RequiredFiles = @('.env', 'docker-compose.override.yml', (Join-Path $httpsState.release_path 'ldsm-lan.pem'), (Join-Path $httpsState.release_path 'ldsm-lan-key.pem'))
  foreach ($required in $RequiredFiles) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
      throw "Falta $required. No se reconstruyo el servidor HTTPS gestionado."
    }
  }
}

if (-not $OmitirRespaldo) {
  $backupStarted = [DateTimeOffset]::Now
  & "$PSScriptRoot\respaldo-ahora.ps1"
  if ($LASTEXITCODE -ne 0) { throw 'No se reconstruyó el sistema porque el respaldo previo falló.' }
  Assert-VerifiedBackup $backupStarted
}

Invoke-NativeChecked "validar Docker Compose ($UpdateMode)" { docker compose @ComposeFiles config --quiet }
Invoke-NativeChecked 'construir las imágenes nuevas' { docker compose @ComposeFiles build }
Invoke-NativeChecked 'iniciar y esperar la versión nueva' { docker compose @ComposeFiles up -d --wait --wait-timeout 180 }

$updatedFrontend = Get-ComposeContainer 'frontend'
if ($ManagedHttps) {
  & "$PSScriptRoot\estado.ps1"
  if ($LASTEXITCODE -ne 0) { throw 'La versión se inició, pero no superó la comprobación de salud.' }
} elseif ($LegacyHttps) {
  $updatedBackend = Get-ComposeContainer 'backend'
  Assert-LegacyHttpsHealth $updatedBackend
} else {
  Invoke-NativeChecked 'comprobar servicios saludables' { docker compose @ComposeFiles ps }
  $httpHostPort = Get-PublishedHostPort $updatedFrontend 80
  if ($null -eq $httpHostPort) { throw 'No se pudo determinar el puerto HTTP publicado despues de reconstruir.' }
  Assert-HttpHealth $httpHostPort
  Write-Warning 'La instalación usa HTTP interno. Se comprobó la respuesta HTTP, pero no se declaró endurecimiento HTTPS.'
}

if ($ManagedHttps) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\instalar-https-colegio.ps1" -Diagnostico
  if ($LASTEXITCODE -ne 0) {
    throw 'La aplicación responde, pero el diagnóstico HTTPS gestionado quedó pendiente.'
  }
} elseif ($LegacyHttps) {
  try {
    & "$PSScriptRoot\verificar-produccion.ps1"
    if ($LASTEXITCODE -ne 0) {
      Write-Warning 'HTTPS heredado respondió correctamente, pero hay controles externos de producción pendientes. Las imágenes ya fueron actualizadas; no se tocaron .env, certificados ni datos.'
    }
  } catch {
    Write-Warning "HTTPS heredado respondió correctamente, pero el diagnóstico externo quedó pendiente: $($_.Exception.Message) Las imágenes ya fueron actualizadas; no se tocaron .env, certificados ni datos."
  }
}

$head = (git rev-parse --short HEAD).Trim()
Write-Host ''
Write-Host "Actualización completada y saludable ($UpdateMode): $head" -ForegroundColor Green
