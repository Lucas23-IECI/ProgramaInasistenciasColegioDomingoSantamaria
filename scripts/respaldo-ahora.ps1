[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

docker exec ldsm_backup sh /backup.sh
if ($LASTEXITCODE -ne 0) { throw 'El respaldo no pudo completarse.' }

$status = Join-Path $ProjectRoot 'backups\last-success.env'
if (-not (Test-Path $status)) { throw 'El respaldo termino sin crear el archivo de estado esperado.' }
Write-Host 'Respaldo verificado correctamente:' -ForegroundColor Green
Get-Content -LiteralPath $status
