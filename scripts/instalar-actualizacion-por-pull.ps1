[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$GitDirectory = Join-Path $ProjectRoot '.git'
$HooksDirectory = Join-Path $GitDirectory 'hooks'
$HookPath = Join-Path $HooksDirectory 'post-merge'

if (-not (Test-Path -LiteralPath $GitDirectory)) {
  throw 'La carpeta del sistema no es un clon Git válido.'
}

New-Item -ItemType Directory -Path $HooksDirectory -Force | Out-Null
$normalizeHook = {
  param([string]$Text)
  (($Text -replace "`r`n", "`n").Trim())
}
$legacyHook = & $normalizeHook @'
#!/bin/sh
branch="$(git branch --show-current)"
if [ "$branch" != "main" ]; then
  exit 0
fi
project_root="$(git rev-parse --show-toplevel)"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$project_root/scripts/actualizar-servidor.ps1"
'@
$managedHook = & $normalizeHook @'
#!/bin/sh
# LDSM post-merge updater v2
branch="$(git branch --show-current)"
if [ "$branch" != "main" ]; then
  exit 0
fi
project_root="$(git rev-parse --show-toplevel)"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$project_root/scripts/actualizar-servidor.ps1"
'@
if (Test-Path -LiteralPath $HookPath -PathType Leaf) {
  $existingHook = & $normalizeHook (Get-Content -LiteralPath $HookPath -Raw)
  $isManagedHook = $existingHook -eq $managedHook
  $isKnownLDSMHook = $existingHook -eq $legacyHook
  if (-not $isManagedHook -and -not $isKnownLDSMHook) {
    throw 'Ya existe un hook post-merge ajeno. No se sobrescribio; revisalo y respaldalo manualmente antes de instalar el actualizador.'
  }
  if (-not $isManagedHook) {
    $backupPath = Join-Path $HooksDirectory ('post-merge.ldsm-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
    Copy-Item -LiteralPath $HookPath -Destination $backupPath -ErrorAction Stop
    Write-Host "Hook LDSM anterior respaldado en: $backupPath" -ForegroundColor Yellow
  }
}

$hook = $managedHook -replace "`r`n", "`n"
[System.IO.File]::WriteAllText($HookPath, $hook, [System.Text.UTF8Encoding]::new($false))
Write-Host 'Actualización por pull habilitada para la rama main.' -ForegroundColor Green
Write-Host 'Desde ahora, un pull que traiga cambios ejecutará respaldo, build, migraciones y controles de salud.'
