param(
    [string]$LanIp = '',

    [string]$Hostname = 'asistencia.ldsm.test',

    [switch]$InstalarAutoridadLocal
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$certDirectory = Join-Path $projectRoot 'certs'
$mkcert = Get-Command mkcert -ErrorAction SilentlyContinue

function Get-LanAddress {
    $candidate = Get-NetIPConfiguration |
        Where-Object { $_.NetAdapter.Status -eq 'Up' -and $_.IPv4DefaultGateway } |
        ForEach-Object { $_.IPv4Address.IPAddress } |
        Where-Object { $_ -and $_ -notlike '169.254.*' } |
        Select-Object -First 1
    if (-not $candidate) { throw 'No se encontró una dirección IPv4 activa con puerta de enlace.' }
    return $candidate
}

if ([string]::IsNullOrWhiteSpace($LanIp)) { $LanIp = Get-LanAddress }
$parsedIp = $null
if (-not [System.Net.IPAddress]::TryParse($LanIp, [ref]$parsedIp) -or
    $parsedIp.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
    throw 'La dirección indicada no es una IPv4 válida.'
}
if ($Hostname -notmatch '^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$') {
    throw 'El nombre interno indicado no es válido.'
}

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
$temporaryCertificate = Join-Path $certDirectory "ldsm-lan-$([guid]::NewGuid().ToString('N')).tmp.pem"
$temporaryKey = Join-Path $certDirectory "ldsm-lan-$([guid]::NewGuid().ToString('N')).tmp-key.pem"

try {
    & $mkcert.Source `
        -cert-file $temporaryCertificate `
        -key-file $temporaryKey `
        $Hostname localhost 127.0.0.1 '::1' $LanIp

    if ($LASTEXITCODE -ne 0 -or
        -not (Test-Path -LiteralPath $temporaryCertificate) -or
        -not (Test-Path -LiteralPath $temporaryKey)) {
        throw 'mkcert no pudo generar el certificado.'
    }

    Move-Item -LiteralPath $temporaryCertificate -Destination $certificatePath -Force
    Move-Item -LiteralPath $temporaryKey -Destination $privateKeyPath -Force
} finally {
    Remove-Item -LiteralPath $temporaryCertificate, $temporaryKey -Force -ErrorAction SilentlyContinue
}

$caRoot = (& $mkcert.Source -CAROOT).Trim()
$rootCertificate = Join-Path $caRoot 'rootCA.pem'
if (-not (Test-Path -LiteralPath $rootCertificate)) {
    throw 'No se encontró el certificado público de la autoridad local de mkcert.'
}
Copy-Item -LiteralPath $rootCertificate -Destination (Join-Path $certDirectory 'rootCA.pem') -Force
$rootFingerprint = (Get-FileHash -LiteralPath (Join-Path $certDirectory 'rootCA.pem') -Algorithm SHA256).Hash

Write-Host ''
Write-Host 'Certificado generado correctamente.'
Write-Host "Nombre interno: $Hostname"
Write-Host "IP incluida: $LanIp"
Write-Host "Certificado público para equipos autorizados: $certDirectory\rootCA.pem"
Write-Host "Huella SHA-256: $rootFingerprint"
Write-Host ''
Write-Host 'Si ejecutaste solo este generador, continúa con la configuración HTTPS indicada en la guía.'
