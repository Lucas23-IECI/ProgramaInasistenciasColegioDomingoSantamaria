#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$BundlePath = '',
    [string]$ExpectedRootSha256 = '',
    [switch]$Diagnostico
)

# Windows PowerShell 5.1 can evaluate parameter defaults before PSScriptRoot
# is populated when launched with -File. Resolve it in the script body, not
# relative to the caller's current directory (which may be System32).
if ([string]::IsNullOrWhiteSpace($BundlePath)) { $BundlePath = $PSScriptRoot }

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Initialize-HttpsClientProbe {
    if ('PuroCole.HttpsClientProbe' -as [type]) { return }
    Add-Type -TypeDefinition @'
#pragma warning disable
using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace PuroCole {
    public static class HttpsClientProbe {
        private static bool Same(byte[] a, byte[] b) {
            if (a.Length != b.Length) return false;
            int difference = 0;
            for (int i = 0; i < a.Length; i++) difference |= a[i] ^ b[i];
            return difference == 0;
        }
        private static int Length(byte[] bytes, ref int offset) {
            if (offset >= bytes.Length) throw new ArgumentException("Certificado incompleto.");
            int value = bytes[offset++];
            if (value < 128) return value;
            int count = value & 127;
            if (count == 0 || count > 4 || offset + count > bytes.Length) throw new ArgumentException("Certificado no valido.");
            value = 0;
            for (int i = 0; i < count; i++) value = checked(value * 256 + bytes[offset++]);
            if (value < 0 || value > bytes.Length - offset) throw new ArgumentException("Certificado no valido.");
            return value;
        }
        public static bool HasIpSan(X509Certificate2 certificate, string address) {
            byte[] expected = IPAddress.Parse(address).GetAddressBytes();
            foreach (X509Extension extension in certificate.Extensions) {
                if (extension.Oid.Value != "2.5.29.17") continue;
                byte[] data = extension.RawData;
                int position = 0;
                if (data.Length < 2 || data[position++] != 48) return false;
                int length = Length(data, ref position);
                int end = position + length;
                if (end != data.Length) return false;
                while (position < end) {
                    int tag = data[position++];
                    int size = Length(data, ref position);
                    if (position + size > end) return false;
                    if (tag == 135 && size == expected.Length) {
                        byte[] candidate = new byte[size];
                        Buffer.BlockCopy(data, position, candidate, 0, size);
                        if (Same(expected, candidate)) return true;
                    }
                    position += size;
                }
            }
            return false;
        }
        public static bool ValidSelfSignature(X509Certificate2 certificate) {
            if (!Same(certificate.SubjectName.RawData, certificate.IssuerName.RawData)) return false;
            string oid = certificate.SignatureAlgorithm.Value;
            HashAlgorithmName hash;
            if (oid == "1.2.840.113549.1.1.11") hash = HashAlgorithmName.SHA256;
            else if (oid == "1.2.840.113549.1.1.12") hash = HashAlgorithmName.SHA384;
            else if (oid == "1.2.840.113549.1.1.13") hash = HashAlgorithmName.SHA512;
            else return false;
            byte[] data = certificate.RawData;
            int position = 0;
            if (data[position++] != 48) return false;
            int outer = Length(data, ref position);
            if (position + outer != data.Length) return false;
            int tbsStart = position;
            if (data[position++] != 48) return false;
            int tbsLength = Length(data, ref position);
            position += tbsLength;
            byte[] tbs = new byte[position - tbsStart];
            Buffer.BlockCopy(data, tbsStart, tbs, 0, tbs.Length);
            if (data[position++] != 48) return false;
            int algorithmLength = Length(data, ref position);
            position += algorithmLength;
            if (data[position++] != 3) return false;
            int signatureLength = Length(data, ref position);
            if (signatureLength < 2 || position + signatureLength != data.Length || data[position++] != 0) return false;
            byte[] signature = new byte[signatureLength - 1];
            Buffer.BlockCopy(data, position, signature, 0, signature.Length);
            using (RSA key = certificate.GetRSAPublicKey()) {
                return key != null && key.KeySize >= 3072 && key.VerifyData(tbs, signature, hash, RSASignaturePadding.Pkcs1);
            }
        }
        public static void Verify(string host, int port, byte[] rootBytes) {
            using (X509Certificate2 root = new X509Certificate2(rootBytes))
            using (TcpClient tcp = new TcpClient()) {
                var connection = tcp.ConnectAsync(host, port);
                if (!connection.Wait(10000)) throw new TimeoutException("El servidor no responde en el puerto HTTPS.");
                connection.GetAwaiter().GetResult();
                string problem = "El servidor no presento un certificado HTTPS valido.";
                RemoteCertificateValidationCallback validate = delegate(object sender, X509Certificate remote, X509Chain supplied, SslPolicyErrors errors) {
                    if (remote == null || (errors & (SslPolicyErrors.RemoteCertificateNameMismatch | SslPolicyErrors.RemoteCertificateNotAvailable)) != 0) {
                        problem = "La identidad HTTPS no corresponde a la direccion del servidor.";
                        return false;
                    }
                    using (X509Certificate2 leaf = new X509Certificate2(remote))
                    using (X509Chain chain = new X509Chain()) {
                        if (!HasIpSan(leaf, host)) { problem = "El certificado no incluye la IP del servidor."; return false; }
                        chain.ChainPolicy.ExtraStore.Add(root);
                        if (supplied != null) foreach (X509ChainElement element in supplied.ChainElements) chain.ChainPolicy.ExtraStore.Add(element.Certificate);
                        // Only this TLS connection accepts the explicitly verified, as-yet-uninstalled root.
                        // No global callbacks or system trust changes. This private CA has no public
                        // revocation endpoint; the complete expected chain is supplied in memory.
                        chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
                        chain.ChainPolicy.VerificationFlags = X509VerificationFlags.AllowUnknownCertificateAuthority;
                        chain.ChainPolicy.UrlRetrievalTimeout = TimeSpan.FromMilliseconds(1);
                        chain.ChainPolicy.ApplicationPolicy.Add(new Oid("1.3.6.1.5.5.7.3.1"));
                        bool built = chain.Build(leaf);
                        if (!built || chain.ChainElements.Count != 2 || !Same(chain.ChainElements[1].Certificate.RawData, rootBytes)) {
                            problem = "El certificado del servidor no pertenece a la autoridad de este colegio.";
                            return false;
                        }
                        foreach (X509ChainStatus status in chain.ChainStatus) {
                            if ((status.Status & ~X509ChainStatusFlags.UntrustedRoot) != X509ChainStatusFlags.NoError) {
                                problem = "La cadena del certificado del servidor no es valida.";
                                return false;
                            }
                        }
                        foreach (X509ChainElement element in chain.ChainElements) {
                            if (element.Certificate.NotBefore.ToUniversalTime() > DateTime.UtcNow || element.Certificate.NotAfter.ToUniversalTime() <= DateTime.UtcNow) {
                                problem = "Hay un certificado vencido o con fecha futura. Revisa el reloj del equipo.";
                                return false;
                            }
                        }
                        return true;
                    }
                };
                using (SslStream ssl = new SslStream(tcp.GetStream(), false, validate)) {
                    ssl.ReadTimeout = 10000;
                    ssl.WriteTimeout = 10000;
                    try { ssl.AuthenticateAsClient(host, null, SslProtocols.Tls12, false); }
                    catch (AuthenticationException error) { throw new AuthenticationException(problem, error); }
                }
            }
        }
    }
}
'@
}

function Get-CertificateSha256 {
    param([System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($Certificate.RawData))).Replace('-', '') }
    finally { $algorithm.Dispose() }
}

function Read-HttpsClientBundle {
    param([string]$Path)
    $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).ProviderPath
    if (-not (Test-Path -LiteralPath $resolved -PathType Container)) { throw 'Selecciona la carpeta del paquete entregado por soporte.' }
    foreach ($file in Get-ChildItem -LiteralPath $resolved -Force) {
        if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'El paquete no debe contener carpetas ni enlaces. Solicita el paquete original de tres archivos a soporte.' }
        if ($file.Extension -match '^\.(key|pfx|p12)$') { throw 'El paquete contiene una posible clave privada. No lo distribuyas ni lo instales; avisa a soporte.' }
        if ($file.Extension -match '^\.(pem|cer|crt)$') {
            if ($file.Length -ge 1MB) { throw 'El paquete incluye un archivo de certificado demasiado grande. No lo instales; solicita un paquete nuevo a soporte.' }
            if ([IO.File]::ReadAllText($file.FullName) -match '-----BEGIN [^-]*PRIVATE KEY-----') { throw 'El paquete contiene una clave privada. No lo distribuyas ni lo instales; avisa a soporte.' }
        }
        if ($file.Name -notin @('rootCA.cer', 'conexion.json', 'Confiar-Equipo.ps1')) { throw 'El paquete contiene archivos inesperados. Solicita el paquete original de tres archivos a soporte.' }
    }
    $manifestPath = Join-Path $resolved 'conexion.json'
    $certificatePath = Join-Path $resolved 'rootCA.cer'
    foreach ($required in @($manifestPath, $certificatePath, (Join-Path $resolved 'Confiar-Equipo.ps1'))) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf) -or (Get-Item -LiteralPath $required).Length -gt 64KB) { throw 'El paquete esta incompleto o no tiene un formato valido. Solicita uno nuevo a soporte.' }
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($property in @('schema_version', 'server_url', 'root_sha256', 'root_thumbprint', 'root_not_after')) {
        if (-not $manifest.PSObject.Properties[$property]) { throw "El paquete no incluye el dato obligatorio $property. Solicita uno nuevo a soporte." }
    }
    if ($manifest.schema_version -ne 1 -or $manifest.root_sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or $manifest.root_thumbprint -notmatch '^[A-Fa-f0-9]{40}$') { throw 'El formato o las huellas del paquete no son validos.' }
    $uri = $null
    $address = $null
    if (-not [Uri]::TryCreate([string]$manifest.server_url, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/' -or
        -not [Net.IPAddress]::TryParse($uri.Host, [ref]$address) -or $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or
        $uri.Host -ne $address.ToString()) { throw 'La direccion debe ser HTTPS y contener solamente la IP privada del servidor, sin nombres, usuarios ni rutas adicionales.' }
    $bytes = $address.GetAddressBytes()
    if (-not ($bytes[0] -eq 10 -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168))) { throw 'La direccion del paquete no es una IPv4 privada del colegio.' }
    $certificateBytes = [IO.File]::ReadAllBytes($certificatePath)
    $type = [Security.Cryptography.X509Certificates.X509Certificate2]::GetCertContentType($certificateBytes)
    if ($type -ne [Security.Cryptography.X509Certificates.X509ContentType]::Cert -or $certificateBytes[0] -ne 48) { throw 'Se requiere solamente el certificado publico DER rootCA.cer; no se aceptan claves privadas ni paquetes de certificados.' }
    $certificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList @(,$certificateBytes)
    if ($certificate.HasPrivateKey -or [Convert]::ToBase64String($certificate.RawData) -ne [Convert]::ToBase64String($certificateBytes)) { $certificate.Dispose(); throw 'El certificado no es un archivo publico DER valido.' }
    try {
        Initialize-HttpsClientProbe
        $constraints = @($certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.19' })
        $usages = @($certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.15' })
        if ($constraints.Count -ne 1 -or $usages.Count -ne 1) { throw 'El certificado no identifica una autoridad de certificacion valida.' }
        $basic = New-Object Security.Cryptography.X509Certificates.X509BasicConstraintsExtension -ArgumentList @($constraints[0], $constraints[0].Critical)
        $usage = New-Object Security.Cryptography.X509Certificates.X509KeyUsageExtension -ArgumentList @($usages[0], $usages[0].Critical)
        if (-not $basic.CertificateAuthority -or -not $basic.Critical -or -not $basic.HasPathLengthConstraint -or $basic.PathLengthConstraint -ne 0 -or
            ($usage.KeyUsages -band [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign) -eq 0 -or -not [PuroCole.HttpsClientProbe]::ValidSelfSignature($certificate)) { throw 'La autoridad no tiene una firma propia RSA segura, restricciones de emision directa o permiso para emitir certificados.' }
        $now = [DateTime]::UtcNow
        if ($certificate.NotBefore.ToUniversalTime() -gt $now -or $certificate.NotAfter.ToUniversalTime() -le $now) { throw 'El certificado esta vencido o aun no es valido. Revisa la fecha del equipo y consulta a soporte.' }
        $sha256 = Get-CertificateSha256 $certificate
        $expectedExpiry = [DateTimeOffset]::MinValue
        # Newer PowerShell converts ISO JSON timestamps to DateTime automatically; 5.1 keeps strings.
        if ($manifest.root_not_after -is [DateTime]) {
            $expectedExpiry = [DateTimeOffset]$manifest.root_not_after
            $expiryValid = $true
        } else {
            $expiryValid = [DateTimeOffset]::TryParse([string]$manifest.root_not_after, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$expectedExpiry)
        }
        if (-not $expiryValid -or
            [Math]::Abs(($expectedExpiry.UtcDateTime - $certificate.NotAfter.ToUniversalTime()).TotalSeconds) -gt 1 -or
            $sha256 -ne $manifest.root_sha256 -or $certificate.Thumbprint -ne $manifest.root_thumbprint) { throw 'El certificado no coincide con los datos del paquete. No lo instales; solicita uno nuevo a soporte.' }
        return [pscustomobject]@{ Certificate = $certificate; Uri = $uri; Sha256 = $sha256 }
    } catch { $certificate.Dispose(); throw }
}

function Test-HttpsClientAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try { return (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }
    finally { $identity.Dispose() }
}

function Test-HttpsRootInstalled {
    param($Certificate)
    $store = New-Object Security.Cryptography.X509Certificates.X509Store('Root', 'LocalMachine')
    try {
        $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
        foreach ($existing in $store.Certificates) {
            if ([Convert]::ToBase64String($existing.RawData) -eq [Convert]::ToBase64String($Certificate.RawData)) { return $true }
        }
        return $false
    } finally { $store.Close(); $store.Dispose() }
}

function Add-HttpsTrustedRoot {
    param($Certificate)
    $store = New-Object Security.Cryptography.X509Certificates.X509Store('Root', 'LocalMachine')
    try {
        $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        foreach ($existing in $store.Certificates) {
            if ([Convert]::ToBase64String($existing.RawData) -eq [Convert]::ToBase64String($Certificate.RawData)) { return $false }
        }
        $store.Add($Certificate)
        return $true
    } finally { $store.Close(); $store.Dispose() }
}

function Remove-HttpsAddedRoot {
    param($Certificate)
    $store = New-Object Security.Cryptography.X509Certificates.X509Store('Root', 'LocalMachine')
    try {
        $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        foreach ($existing in $store.Certificates) {
            if ([Convert]::ToBase64String($existing.RawData) -eq [Convert]::ToBase64String($Certificate.RawData)) { $store.Remove($existing) }
        }
    } finally { $store.Close(); $store.Dispose() }
}

function Test-HttpsServerIdentity {
    param($Bundle)
    [PuroCole.HttpsClientProbe]::Verify($Bundle.Uri.Host, $Bundle.Uri.Port, $Bundle.Certificate.RawData)
}

function Test-HttpsServerHealth {
    param([Uri]$ServerUri)
    foreach ($path in @('/healthz', '/api/health/ready')) {
        $request = [Net.HttpWebRequest]::Create((New-Object Uri($ServerUri, $path)))
        $request.AllowAutoRedirect = $false
        $request.Timeout = 10000
        $request.ReadWriteTimeout = 10000
        $request.Proxy = $null
        $response = $null
        try {
            # Normal Windows certificate validation: never bypass trust here.
            $response = $request.GetResponse()
            if ([int]$response.StatusCode -ne 200) { throw 'El servidor HTTPS responde, pero la aplicacion todavia no esta disponible.' }
        } finally { if ($null -ne $response) { $response.Dispose() } }
    }
}

function Invoke-HttpsClientSetup {
    param([string]$Path, [string]$ExpectedSha256 = '', [switch]$ReadOnly)
    $bundle = Read-HttpsClientBundle $Path
    $added = $false
    try {
        Write-Host ''
        Write-Host 'CONEXION SEGURA DEL COLEGIO'
        Write-Host "Direccion: $($bundle.Uri.AbsoluteUri)"
        Write-Host "Huella SHA-256: $($bundle.Sha256)"
        Write-Host "Vigente hasta: $($bundle.Certificate.NotAfter.ToString('yyyy-MM-dd'))"
        Write-Host 'Esta autoridad permite confiar en certificados emitidos por el colegio para este equipo.'
        if ($ReadOnly) {
            $installed = Test-HttpsRootInstalled $bundle.Certificate
            Test-HttpsServerIdentity $bundle
            if ($installed) { Test-HttpsServerHealth $bundle.Uri }
            Write-Host "Diagnostico terminado sin cambios. Confianza instalada: $installed."
            Write-Host 'La identidad del paquete aun debe compararse con la huella entregada por soporte por otro medio.'
            return [pscustomobject]@{ Mode = 'Diagnostico'; RootInstalled = $installed; ServerIdentityVerified = $true; Url = $bundle.Uri.AbsoluteUri; Added = $false }
        }
        if (-not (Test-HttpsClientAdministrator)) { throw 'Abre PowerShell como administrador en esta carpeta y vuelve a ejecutar Confiar-Equipo.ps1. No se ha cambiado la confianza del equipo.' }
        if ([string]::IsNullOrWhiteSpace($ExpectedSha256)) {
            Write-Host 'Pide a soporte la huella SHA-256 por telefono u otro canal independiente.'
            Write-Host 'NO copies la huella de esta pantalla ni del archivo conexion.json: eso no verifica el origen.'
            $ExpectedSha256 = Read-Host 'Pega o escribe los 64 caracteres recibidos de soporte (Enter para cancelar)'
        }
        $ExpectedSha256 = ($ExpectedSha256 -replace '\s', '').ToUpperInvariant()
        if ($ExpectedSha256 -notmatch '^[A-F0-9]{64}$' -or $ExpectedSha256 -ne $bundle.Sha256) { throw 'La huella no coincide con la recibida de soporte. Instalacion cancelada sin modificar la confianza.' }
        Write-Host 'Comprobando que el servidor usa el certificado correcto antes de confiar en el...'
        Test-HttpsServerIdentity $bundle
        $added = Add-HttpsTrustedRoot $bundle.Certificate
        Test-HttpsServerHealth $bundle.Uri
        Write-Host ''
        Write-Host 'LISTO: HTTPS y la disponibilidad de la aplicacion fueron comprobados.' -ForegroundColor Green
        Write-Host "Abre $($bundle.Uri.AbsoluteUri) en Edge o Chrome. Cierra y vuelve a abrir el navegador si estaba abierto."
        Write-Host 'No aceptes avisos de certificado. En otro navegador o dispositivo puede requerirse configurar su propia confianza.'
        return [pscustomobject]@{ Mode = 'Instalacion'; RootInstalled = $true; ServerIdentityVerified = $true; Url = $bundle.Uri.AbsoluteUri; Added = $added }
    } catch {
        if ($added) {
            try { Remove-HttpsAddedRoot $bundle.Certificate; Write-Host 'Se retiro solamente el certificado agregado por este intento; la instalacion no quedo completada.' }
            catch { throw 'La comprobacion final fallo y no fue posible retirar la autoridad agregada. No continues: solicita a soporte retirar unicamente la huella mostrada arriba.' }
        }
        throw
    } finally { $bundle.Certificate.Dispose() }
}

if ($MyInvocation.InvocationName -ne '.') {
    try { Invoke-HttpsClientSetup -Path $BundlePath -ExpectedSha256 $ExpectedRootSha256 -ReadOnly:$Diagnostico }
    catch { Write-Host ''; Write-Host "NO COMPLETADO: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
}
