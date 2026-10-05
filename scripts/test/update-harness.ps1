[CmdletBinding()]
param([switch]$ConservarFixture)

$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$fixture = Join-Path $env:TEMP ('ldsm-update-harness-' + [guid]::NewGuid().ToString('N'))
$bin = Join-Path $fixture 'bin'
$scripts = Join-Path $fixture 'scripts'
$backups = Join-Path $fixture 'backups'
New-Item -ItemType Directory -Path $bin, $scripts, $backups -Force | Out-Null
$keep = $ConservarFixture

try {
  Copy-Item (Join-Path $repository 'scripts\actualizar-servidor.ps1') $scripts
  Copy-Item (Join-Path $repository 'scripts\instalar-actualizacion-por-pull.ps1') $scripts
  Set-Content (Join-Path $fixture '.env') @('DB_PASSWORD=fixture-only', 'JWT_SECRET=fixture-only', 'COOKIE_SECURE=false')
  Set-Content (Join-Path $fixture 'docker-compose.yml') 'services: {}'
  Set-Content (Join-Path $fixture '.gitignore') @('backups/', 'docker.log', 'certs/', 'docker-compose.https.yml')
  Set-Content (Join-Path $scripts 'respaldo-ahora.ps1') @'
$root = Split-Path -Parent $PSScriptRoot
$backup = Join-Path $root 'backups'
if ($env:FAKE_BACKUP_MODE -eq 'missing') { Remove-Item (Join-Path $backup '*') -Force -ErrorAction SilentlyContinue; exit 0 }
$now = (Get-Date).ToUniversalTime().ToString('o')
Set-Content (Join-Path $backup 'ldsm_db_fixture.dump') 'fixture'
Set-Content (Join-Path $backup 'ldsm_documentos_fixture.tar.gz') 'fixture'
Set-Content (Join-Path $backup 'ldsm_fixture.sha256') 'fixture'
Set-Content (Join-Path $backup 'last-success.env') @("timestamp=$now", 'database=ldsm_db_fixture.dump', 'documents=ldsm_documentos_fixture.tar.gz', 'manifest=ldsm_fixture.sha256')
'@
  Set-Content (Join-Path $scripts 'estado.ps1') "Write-Host 'estado fixture OK'"
  Set-Content (Join-Path $scripts 'verificar-produccion.ps1') "Write-Host 'produccion fixture OK'"

  Set-Content (Join-Path $bin 'frontend.json') '{"Config":{"Env":[]},"NetworkSettings":{"Ports":{"80/tcp":[{"HostPort":"80"}]}}}'
  Set-Content (Join-Path $bin 'frontend-legacy.json') '{"Config":{"Env":[]},"NetworkSettings":{"Ports":{"80/tcp":[{"HostPort":"80"}],"443/tcp":[{"HostPort":"443"}]}}}'
  Set-Content (Join-Path $bin 'backend-http.json') '{"Config":{"Env":["COOKIE_SECURE=false","CORS_ORIGIN=https://127.0.0.1"]},"NetworkSettings":{"Ports":{}}}'
  Set-Content (Join-Path $bin 'backend-secure.json') '{"Config":{"Env":["COOKIE_SECURE=true","CORS_ORIGIN=https://127.0.0.1"]},"NetworkSettings":{"Ports":{}}}'
  Set-Content (Join-Path $bin 'docker.cmd') @'
@echo off
set "args=%*"
if "%1"=="info" exit /b 0
if "%1"=="inspect" (
  if "%2"=="frontend-id" if "%FAKE_SCENARIO%"=="legacy" (type "%FAKE_DOCKER_DATA%\frontend-legacy.json") else (type "%FAKE_DOCKER_DATA%\frontend.json")
  if "%2"=="backend-id" if "%FAKE_SCENARIO%"=="secure" (type "%FAKE_DOCKER_DATA%\backend-secure.json") else (type "%FAKE_DOCKER_DATA%\backend-http.json")
  exit /b 0
)
if "%1"=="compose" (
  echo %args%>>"%FAKE_DOCKER_LOG%"
  echo %args%|findstr /c:"ps -q frontend" >nul && (echo frontend-id&exit /b 0)
  echo %args%|findstr /c:"ps -q backend" >nul && (echo backend-id&exit /b 0)
  exit /b 0
)
exit /b 0
'@

  # The updater must use curl for real endpoint checks. This local executable is
  # only a deterministic fixture; it never contacts the school or a container.
  $curlSource = Join-Path $fixture 'curl-fixture.cs'
  Set-Content $curlSource @'
using System;
using System.Linq;
public static class FixtureCurl {
  public static int Main(string[] args) {
    var url = args.Reverse().FirstOrDefault(value => value.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || value.StartsWith("https://", StringComparison.OrdinalIgnoreCase));
    if (url == null) return 2;
    if (url.EndsWith("/healthz", StringComparison.OrdinalIgnoreCase)) { Console.Write("200"); return 0; }
    if (url.EndsWith("/api/health/ready", StringComparison.OrdinalIgnoreCase)) { Console.Write("{\"status\":\"OK\",\"database\":\"ready\"}"); return 0; }
    return 2;
  }
}
'@
  $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  if (-not (Test-Path -LiteralPath $csc)) { throw "No se encontró csc.exe para el fixture: $csc" }
  $curlExe = Join-Path $bin 'curl.exe'
  & $csc /nologo /target:exe /out:$curlExe $curlSource
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $curlExe)) { throw 'No se pudo compilar el curl fixture.' }

  git init --initial-branch=main $fixture | Out-Null
  git -C $fixture config user.email qa@example.invalid
  git -C $fixture config user.name 'LDSM QA'
  git -C $fixture add .
  git -C $fixture commit -m fixture | Out-Null

  $oldPath = $env:PATH
  $oldData = $env:FAKE_DOCKER_DATA
  $oldLog = $env:FAKE_DOCKER_LOG
  $oldScenario = $env:FAKE_SCENARIO
  $oldBackup = $env:FAKE_BACKUP_MODE
  $env:PATH = "$bin;$oldPath"
  $env:FAKE_DOCKER_DATA = $bin
  $env:FAKE_DOCKER_LOG = Join-Path $fixture 'docker.log'
  function Invoke-FixtureUpdater([string]$Scenario = 'http', [string]$BackupMode = '') {
    $env:FAKE_SCENARIO = $Scenario
    $env:FAKE_BACKUP_MODE = $BackupMode
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $output = @(powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scripts 'actualizar-servidor.ps1') 2>&1) }
    finally { $ErrorActionPreference = $previous }
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
  }

  $http = Invoke-FixtureUpdater -BackupMode good
  if ($http.ExitCode -ne 0) { throw "HTTP fixture falló: $($http.Output)" }
  if (-not ((Get-Content $env:FAKE_DOCKER_LOG -Raw) -match 'build')) { throw 'HTTP no reconstruyó después del respaldo verificado.' }

  $before = @(Get-Content $env:FAKE_DOCKER_LOG).Count
  $missing = Invoke-FixtureUpdater -BackupMode missing
  $after = @(Get-Content $env:FAKE_DOCKER_LOG)
  if ($missing.ExitCode -eq 0 -or @($after[$before..($after.Count - 1)] | Where-Object { $_ -match 'build' }).Count -gt 0) { throw 'El respaldo faltante no detuvo el build.' }

  $secure = Invoke-FixtureUpdater -Scenario secure -BackupMode missing
  if ($secure.ExitCode -eq 0 -or $secure.Output -notmatch 'cookies seguras') { throw 'No se rechazó COOKIE_SECURE=true sin HTTPS.' }

  New-Item -ItemType Directory -Path (Join-Path $fixture 'certs') -Force | Out-Null
  Set-Content (Join-Path $fixture 'docker-compose.https.yml') 'services: {}'
  Set-Content (Join-Path $fixture 'certs\ldsm-lan.pem') 'fixture'
  Set-Content (Join-Path $fixture 'certs\ldsm-lan-key.pem') 'fixture'
  Set-Content (Join-Path $fixture 'certs\rootCA.pem') 'fixture'
  $legacy = Invoke-FixtureUpdater -Scenario legacy -BackupMode good
  if ($legacy.ExitCode -ne 0 -or $legacy.Output -notmatch 'legacy-https') { throw "HTTPS heredado falló: $($legacy.Output)" }

  # Verify the hook does not replace unrelated local automation.
  $hookPath = Join-Path $fixture '.git\hooks\post-merge'
  $hookInstaller = Join-Path $scripts 'instalar-actualizacion-por-pull.ps1'
  Set-Content $hookPath "#!/bin/sh`necho foreign"
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $foreign = @(powershell.exe -NoProfile -ExecutionPolicy Bypass -File $hookInstaller 2>&1) }
  finally { $ErrorActionPreference = $previous }
  if ($LASTEXITCODE -eq 0 -or (Get-Content $hookPath -Raw) -notmatch 'foreign') { throw 'El instalador reemplazó un hook ajeno.' }

  $env:PATH = $oldPath
  if ($null -eq $oldData) { Remove-Item Env:FAKE_DOCKER_DATA -ErrorAction SilentlyContinue } else { $env:FAKE_DOCKER_DATA = $oldData }
  if ($null -eq $oldLog) { Remove-Item Env:FAKE_DOCKER_LOG -ErrorAction SilentlyContinue } else { $env:FAKE_DOCKER_LOG = $oldLog }
  if ($null -eq $oldScenario) { Remove-Item Env:FAKE_SCENARIO -ErrorAction SilentlyContinue } else { $env:FAKE_SCENARIO = $oldScenario }
  if ($null -eq $oldBackup) { Remove-Item Env:FAKE_BACKUP_MODE -ErrorAction SilentlyContinue } else { $env:FAKE_BACKUP_MODE = $oldBackup }
  $fixtureLabel = if ($ConservarFixture) { " Fixture: $fixture" } else { '' }
  Write-Output "PASS: HTTP/HTTPS, backup fail-safe, cookie mismatch y preservación del hook.$fixtureLabel"
} finally {
  if (-not $keep) { Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue }
}
