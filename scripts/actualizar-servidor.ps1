[CmdletBinding()]
param(
  [switch]$PermitirOtraRama,
  [switch]$OmitirRespaldo
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ComposeFiles = @('-f', 'docker-compose.yml', '-f', 'docker-compose.https.yml')
Set-Location $ProjectRoot

function Invoke-NativeChecked([string]$Description, [scriptblock]$Action) {
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "Falló: $Description." }
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

foreach ($required in @('.env', 'certs\ldsm-lan.pem', 'certs\ldsm-lan-key.pem', 'docker-compose.https.yml')) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "Falta $required. Ejecuta primero la preparación HTTPS inicial con soporte técnico."
  }
}

Invoke-NativeChecked 'consultar Docker' { docker info *> $null }

if (-not $OmitirRespaldo) {
  & "$PSScriptRoot\respaldo-ahora.ps1"
  if ($LASTEXITCODE -ne 0) { throw 'No se reconstruyó el sistema porque el respaldo previo falló.' }
}

Invoke-NativeChecked 'validar Docker Compose HTTPS' { docker compose @ComposeFiles config --quiet }
Invoke-NativeChecked 'construir las imágenes nuevas' { docker compose @ComposeFiles build }
Invoke-NativeChecked 'iniciar y esperar la versión nueva' { docker compose @ComposeFiles up -d --wait --wait-timeout 180 }

& "$PSScriptRoot\estado.ps1"
if ($LASTEXITCODE -ne 0) { throw 'La versión se inició, pero no superó la comprobación de salud.' }

& "$PSScriptRoot\verificar-produccion.ps1"
if ($LASTEXITCODE -ne 0) {
  throw 'La aplicación responde, pero conserva controles de producción pendientes. Revisa el diagnóstico anterior.'
}

$head = (git rev-parse --short HEAD).Trim()
Write-Host ''
Write-Host "Actualización HTTPS completada y saludable: $head" -ForegroundColor Green
