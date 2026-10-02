#requires -Version 5.1
[CmdletBinding()]
param([string]$LanIp = '', [string]$Hostname = '', [switch]$OmitirRespaldo)

# Retired: old guides must not silently start a different installer.
throw 'Este instalador fue retirado. No se hizo ningun cambio. Usa .\scripts\instalar-https-colegio.ps1 -Diagnostico y sigue docs/HTTPS_COLEGIO.md. La nueva instalacion no cambia contrasenas ni requiere mkcert o dominio.'
