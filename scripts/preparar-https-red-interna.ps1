param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')]
    [string]$LanIp,

    [string]$Hostname = 'asistencia.ldsm.test',

    [switch]$InstalarAutoridadLocal
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$certDirectory = Join-Path $projectRoot 'certs'
$mkcert = Get-Command mkcert -ErrorAction SilentlyContinue

if (-not $mkcert) {
    throw 'mkcert no está instalado. Instálelo con: winget install --id FiloSottile.mkcert -e'
}

if ($InstalarAutoridadLocal) {
    Write-Host 'Instalando la autoridad local de mkcert en este equipo...'
    & $mkcert.Source -install
}

New-Item -ItemType Directory -Path $certDirectory -Force | Out-Null

$certificatePath = Join-Path $certDirectory 'ldsm-lan.pem'
$privateKeyPath = Join-Path $certDirectory 'ldsm-lan-key.pem'

& $mkcert.Source `
    -cert-file $certificatePath `
    -key-file $privateKeyPath `
    $Hostname localhost 127.0.0.1 '::1' $LanIp

if ($LASTEXITCODE -ne 0) {
    throw 'mkcert no pudo generar el certificado.'
}

$caRoot = (& $mkcert.Source -CAROOT).Trim()

Write-Host ''
Write-Host 'Certificado generado correctamente.'
Write-Host "Nombre interno: $Hostname"
Write-Host "IP incluida: $LanIp"
Write-Host "Autoridad que debe confiar cada equipo: $caRoot\rootCA.pem"
Write-Host ''
Write-Host 'Para iniciar el sistema por HTTPS:'
Write-Host "`$env:HTTPS_CORS_ORIGIN='https://$Hostname,https://$LanIp'"
Write-Host 'docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build'
