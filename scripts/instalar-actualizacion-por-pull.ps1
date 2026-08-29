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
$hook = @'
#!/bin/sh
branch="$(git branch --show-current)"
if [ "$branch" != "main" ]; then
  exit 0
fi
project_root="$(git rev-parse --show-toplevel)"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$project_root/scripts/actualizar-servidor.ps1"
'@

$hook = $hook -replace "`r`n", "`n"
[System.IO.File]::WriteAllText($HookPath, $hook, [System.Text.UTF8Encoding]::new($false))
Write-Host 'Actualización por pull habilitada para la rama main.' -ForegroundColor Green
Write-Host 'Desde ahora, un pull exitoso ejecutará respaldo, build, migraciones y controles de salud.'
