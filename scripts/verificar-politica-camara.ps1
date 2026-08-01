param(
    [string]$ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'frontend\frontend.https.conf')
)

$ErrorActionPreference = 'Stop'
$resolvedPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -LiteralPath $resolvedPath -Raw -Encoding UTF8

if ($config -notmatch 'Permissions-Policy\s+"camera=\(self\), microphone=\(\), geolocation=\(\)"') {
    throw 'La configuración HTTPS no permite la cámara para el mismo origen.'
}

if ($config -match 'Permissions-Policy\s+"camera=\(\)') {
    throw 'La configuración HTTPS contiene una política que bloquea completamente la cámara.'
}

if ($config -notmatch 'ssl_protocols\s+TLSv1\.2 TLSv1\.3;') {
    throw 'La configuración HTTPS no limita el servidor a TLS 1.2 y TLS 1.3.'
}

Write-Host "Política de cámara y TLS verificada: $resolvedPath"
