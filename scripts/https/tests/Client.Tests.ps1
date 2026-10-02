#requires -Version 5.1
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'Confiar-Equipo.ps1')
Initialize-HttpsClientProbe

if (-not ('PuroCole.HttpsTestCertificates' -as [type])) {
    Add-Type -TypeDefinition @'
#pragma warning disable
using System;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Threading;
namespace PuroCole {
    public static class HttpsTestCertificates {
        public static X509Certificate2 Root(string name, bool ca, bool keyCertSign, bool expired) {
            return RootOptions(name, ca, keyCertSign, expired, true, 0);
        }
        public static X509Certificate2 RootOptions(string name, bool ca, bool keyCertSign, bool expired, bool critical, int pathLength) {
            using (RSA key = new RSACng(3072)) {
                CertificateRequest request = new CertificateRequest("CN=" + name, key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
                request.CertificateExtensions.Add(new X509BasicConstraintsExtension(ca, ca, pathLength, critical));
                request.CertificateExtensions.Add(new X509KeyUsageExtension(keyCertSign ? X509KeyUsageFlags.KeyCertSign : X509KeyUsageFlags.DigitalSignature, true));
                request.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(request.PublicKey, false));
                using (X509Certificate2 temporary = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-3), DateTimeOffset.UtcNow.AddDays(expired ? -1 : 30))) {
                    return new X509Certificate2(temporary.Export(X509ContentType.Pfx), "", X509KeyStorageFlags.EphemeralKeySet | X509KeyStorageFlags.Exportable);
                }
            }
        }
        public static X509Certificate2 Leaf(X509Certificate2 root, string ip, bool expired) {
            using (RSA key = new RSACng(2048)) {
                CertificateRequest request = new CertificateRequest("CN=" + ip, key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
                request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
                request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
                OidCollection usages = new OidCollection(); usages.Add(new Oid("1.3.6.1.5.5.7.3.1"));
                request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(usages, false));
                SubjectAlternativeNameBuilder san = new SubjectAlternativeNameBuilder(); san.AddIpAddress(IPAddress.Parse(ip));
                request.CertificateExtensions.Add(san.Build());
                byte[] serial = new byte[16]; using (RandomNumberGenerator generator = RandomNumberGenerator.Create()) generator.GetBytes(serial);
                using (X509Certificate2 issued = request.Create(root, DateTimeOffset.UtcNow.AddDays(-2), DateTimeOffset.UtcNow.AddDays(expired ? -1 : 7), serial))
                using (X509Certificate2 withKey = issued.CopyWithPrivateKey(key)) {
                    // .NET Framework SChannel cannot serve an EphemeralKeySet key. DefaultKeySet
                    // uses a temporary key container, deleted on Dispose; never a certificate store.
                    return new X509Certificate2(withKey.Export(X509ContentType.Pfx), "", X509KeyStorageFlags.DefaultKeySet | X509KeyStorageFlags.Exportable);
                }
            }
        }
    }
    public sealed class HttpsTestListener : IDisposable {
        private TcpListener listener;
        private Thread worker;
        public int Port { get; private set; }
        public string Failure { get; private set; }
        public HttpsTestListener(X509Certificate2 certificate) {
            listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
            Port = ((IPEndPoint)listener.LocalEndpoint).Port;
            worker = new Thread(delegate() {
                try {
                    using (TcpClient client = listener.AcceptTcpClient())
                    using (SslStream ssl = new SslStream(client.GetStream(), false)) {
                        ssl.ReadTimeout = 5000; ssl.WriteTimeout = 5000;
                        ssl.AuthenticateAsServer(certificate, false, SslProtocols.Tls12, false);
                    }
                } catch (Exception error) { Failure = error.ToString(); }
            });
            worker.IsBackground = true; worker.Start();
        }
        public void Dispose() { listener.Stop(); worker.Join(10000); }
    }
}
'@
}

$script:passed = 0
function Assert-True { param($Value, [string]$Message) if (-not $Value) { throw $Message } }
function Assert-Throws { param([scriptblock]$Action, [string]$Pattern = '.')
    $failed = $false
    try { & $Action | Out-Null } catch { $failed = $true; if ($_.Exception.Message -notmatch $Pattern) { throw "Error inesperado: $($_.Exception.Message)" } }
    if (-not $failed) { throw 'La operacion debia ser rechazada.' }
}
function Test-Case { param([string]$Name, [scriptblock]$Action)
    & $Action
    $script:passed++
    Write-Host "PASS $Name"
}

$testDirectory = Join-Path ([IO.Path]::GetTempPath()) ('ldsm-https-client-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDirectory | Out-Null
$script:fixtureDirectory = $testDirectory
$script:root = [PuroCole.HttpsTestCertificates]::Root('CA QA sin almacenar', $true, $true, $false)
$rootBytes = $script:root.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert)
$rootHash = Get-CertificateSha256 $script:root
$manifestPath = Join-Path $testDirectory 'conexion.json'
$certificatePath = Join-Path $testDirectory 'rootCA.cer'
Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'Confiar-Equipo.ps1') -Destination (Join-Path $testDirectory 'Confiar-Equipo.ps1')

function Write-TestBundle {
    param($Certificate = $script:root, [string]$Url = 'https://192.168.50.28/')
    [IO.File]::WriteAllBytes((Join-Path $script:fixtureDirectory 'rootCA.cer'), $Certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert))
    $manifest = [ordered]@{ schema_version = 1; server_url = $Url; root_sha256 = Get-CertificateSha256 $Certificate; root_thumbprint = $Certificate.Thumbprint; root_not_after = $Certificate.NotAfter.ToUniversalTime().ToString('o') }
    [IO.File]::WriteAllText((Join-Path $script:fixtureDirectory 'conexion.json'), ($manifest | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
}
function Change-TestManifest { param([scriptblock]$Change)
    $value = Get-Content -LiteralPath (Join-Path $script:fixtureDirectory 'conexion.json') -Raw | ConvertFrom-Json
    & $Change $value
    [IO.File]::WriteAllText((Join-Path $script:fixtureDirectory 'conexion.json'), ($value | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
}

try {
    Test-Case 'Cliente distribuido resuelve su propia carpeta sin BundlePath en proceso nuevo' {
        # Invalid URL stops before any network/store mutation, but only AFTER
        # locating and reading the actual three-file bundle. Covers PS5.1 -File.
        Write-TestBundle -Url 'http://192.168.50.28/'
        $engine = (Get-Process -Id $PID).Path
        $previousPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $childOutput = @(& $engine -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $testDirectory 'Confiar-Equipo.ps1') -Diagnostico 2>&1) -join "`n"
            $childCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previousPreference }
        Assert-True ($childCode -ne 0 -and $childOutput -match 'La direccion debe ser HTTPS') 'El cliente no encontro/valido el paquete desde su propia carpeta sin BundlePath.'
    }
    Write-TestBundle
    Test-Case 'Paquete DER publico valido, IP privada, fechas y autofirma RSA' {
        $bundle = Read-HttpsClientBundle $testDirectory
        try { Assert-True ($bundle.Sha256 -eq $rootHash -and -not $bundle.Certificate.HasPrivateKey) 'No leyo la autoridad publica esperada.' }
        finally { $bundle.Certificate.Dispose() }
    }
    foreach ($url in @('http://192.168.50.28/', 'https://example.org/', 'https://127.0.0.1/', 'https://169.254.1.2/', 'https://8.8.8.8/', 'https://172.32.0.1/', 'https://[::1]/', 'https://user@192.168.1.2/', 'https://192.168.1.2/login', 'https://192.168.1.2/?x=1', 'https://192.168.1.2/#a')) {
        Write-TestBundle -Url $url
        Test-Case "Rechaza URL $url" { Assert-Throws { Read-HttpsClientBundle $testDirectory } }
    }
    foreach ($url in @('https://10.0.0.1/', 'https://172.16.0.1/', 'https://172.31.255.254:8443/', 'https://192.168.0.1/')) {
        Write-TestBundle -Url $url
        Test-Case "Admite RFC1918 $url" { $b = Read-HttpsClientBundle $testDirectory; $b.Certificate.Dispose() }
    }
    Write-TestBundle
    Change-TestManifest { param($m) $m.root_sha256 = 'A' * 64 }
    Test-Case 'Rechaza SHA256 alterada en manifiesto' { Assert-Throws { Read-HttpsClientBundle $testDirectory } 'no coincide' }
    Write-TestBundle
    Change-TestManifest { param($m) $m.root_thumbprint = 'A' * 40 }
    Test-Case 'Rechaza thumbprint alterado en manifiesto' { Assert-Throws { Read-HttpsClientBundle $testDirectory } 'no coincide' }
    Write-TestBundle
    Change-TestManifest { param($m) $m.root_not_after = '2000-01-01T00:00:00Z' }
    Test-Case 'Rechaza vencimiento alterado en manifiesto' { Assert-Throws { Read-HttpsClientBundle $testDirectory } 'no coincide' }
    Write-TestBundle
    Change-TestManifest { param($m) $m.schema_version = 2 }
    Test-Case 'Rechaza version desconocida de manifiesto' { Assert-Throws { Read-HttpsClientBundle $testDirectory } 'formato' }
    Write-TestBundle
    Change-TestManifest { param($m) $m.PSObject.Properties.Remove('root_sha256') }
    Test-Case 'Rechaza propiedad obligatoria ausente' { Assert-Throws { Read-HttpsClientBundle $testDirectory } 'obligatorio' }
    Write-TestBundle
    [IO.File]::WriteAllBytes($certificatePath, $script:root.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx))
    Test-Case 'Rechaza PFX disfrazado como rootCA.cer' { Assert-Throws { Read-HttpsClientBundle $testDirectory } 'publico DER' }
    Write-TestBundle
    $privateFile = Join-Path $testDirectory 'root.key'
    [IO.File]::WriteAllText($privateFile, 'not a real key')
    Test-Case 'Rechaza paquete que incluye archivo de clave privada' { Assert-Throws { Read-HttpsClientBundle $testDirectory } 'clave privada' }
    Remove-Item -LiteralPath $privateFile
    $extraFile = Join-Path $testDirectory 'archivo-inesperado.txt'
    [IO.File]::WriteAllText($extraFile, 'dato')
    Test-Case 'Rechaza archivos fuera de la lista permitida del paquete' { Assert-Throws { Read-HttpsClientBundle $testDirectory } 'inesperados' }
    Remove-Item -LiteralPath $extraFile
    $privateFile = Join-Path $testDirectory 'extra.pem'
    [IO.File]::WriteAllText($privateFile, '-----BEGIN RSA PRIVATE KEY-----')
    Test-Case 'Rechaza clave privada PEM dentro del paquete' { Assert-Throws { Read-HttpsClientBundle $testDirectory } 'clave privada' }
    Remove-Item -LiteralPath $privateFile
    foreach ($kind in @('notca', 'nocusage', 'expired')) {
        $invalid = [PuroCole.HttpsTestCertificates]::Root('CA QA invalid ' + $kind, ($kind -ne 'notca'), ($kind -ne 'nocusage'), ($kind -eq 'expired'))
        try {
            Write-TestBundle -Certificate $invalid
            Test-Case "Rechaza CA $kind" { Assert-Throws { Read-HttpsClientBundle $testDirectory } }
        } finally { $invalid.Dispose() }
    }
    foreach ($kind in @('noncritical', 'subordinateca')) {
        $pathLength = if ($kind -eq 'subordinateca') { 1 } else { 0 }
        $invalid = [PuroCole.HttpsTestCertificates]::RootOptions('CA QA ' + $kind, $true, $true, $false, ($kind -ne 'noncritical'), $pathLength)
        try {
            Write-TestBundle -Certificate $invalid
            Test-Case "Rechaza restricciones CA $kind" { Assert-Throws { Read-HttpsClientBundle $testDirectory } 'restricciones' }
        } finally { $invalid.Dispose() }
    }
    Test-Case 'Verifica autofirma, no solamente coincidencia Subject/Issuer' {
        $corrupt = [byte[]]$rootBytes.Clone()
        $corrupt[$corrupt.Length - 1] = $corrupt[$corrupt.Length - 1] -bxor 1
        $bad = New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList @(,$corrupt)
        try { Assert-True (-not [PuroCole.HttpsClientProbe]::ValidSelfSignature($bad)) 'Acepto firma corrupta.' } finally { $bad.Dispose() }
    }
    $leaf = [PuroCole.HttpsTestCertificates]::Leaf($script:root, '127.0.0.1', $false)
    try {
        Test-Case 'TLS real acepta CA exacta sin instalarla en Windows' {
            $listener = New-Object PuroCole.HttpsTestListener($leaf)
            try { [PuroCole.HttpsClientProbe]::Verify('127.0.0.1', $listener.Port, $rootBytes) } catch { Write-Host $listener.Failure; throw } finally { $listener.Dispose() }
        }
        $other = [PuroCole.HttpsTestCertificates]::Root('CA QA distinta', $true, $true, $false)
        try {
            Test-Case 'TLS real rechaza servidor firmado por otra CA' {
                $listener = New-Object PuroCole.HttpsTestListener($leaf)
                try { Assert-Throws { [PuroCole.HttpsClientProbe]::Verify('127.0.0.1', $listener.Port, $other.RawData) } } finally { $listener.Dispose() }
            }
        } finally { $other.Dispose() }
    } finally { $leaf.Dispose() }
    foreach ($case in @('wrongip', 'expired')) {
        $ip = if ($case -eq 'wrongip') { '192.168.50.28' } else { '127.0.0.1' }
        $leaf = [PuroCole.HttpsTestCertificates]::Leaf($script:root, $ip, ($case -eq 'expired'))
        try {
            Test-Case "TLS real rechaza $case" {
                $listener = New-Object PuroCole.HttpsTestListener($leaf)
                try { Assert-Throws { [PuroCole.HttpsClientProbe]::Verify('127.0.0.1', $listener.Port, $rootBytes) } } finally { $listener.Dispose() }
            }
        } finally { $leaf.Dispose() }
    }

    # Below, every store/network/admin operation is replaced in memory. No real trust store is opened.
    function Test-HttpsClientAdministrator { return $script:admin }
    function Test-HttpsRootInstalled { param($Certificate) return $script:installed }
    function Test-HttpsServerIdentity { param($Bundle) $script:identityCalls++; if ($script:identityFail) { throw 'Identidad incorrecta.' } }
    function Add-HttpsTrustedRoot { param($Certificate) $script:addCalls++; return $script:addNew }
    function Remove-HttpsAddedRoot { param($Certificate) $script:removeCalls++ }
    function Test-HttpsServerHealth { param($ServerUri) $script:healthCalls++; if ($script:healthFail) { throw 'Salud no disponible.' } }
    function Reset-Fakes {
        $script:admin = $true; $script:installed = $false; $script:identityFail = $false; $script:healthFail = $false; $script:addNew = $true
        $script:identityCalls = 0; $script:addCalls = 0; $script:removeCalls = 0; $script:healthCalls = 0
        Write-TestBundle
    }
    Reset-Fakes
    Test-Case 'Instalacion exige administrador sin agregar confianza' {
        $script:admin = $false
        Assert-Throws { Invoke-HttpsClientSetup $testDirectory $rootHash } 'administrador'
        Assert-True ($script:addCalls -eq 0) 'Modifico confianza sin admin.'
    }
    Reset-Fakes
    Test-Case 'Huella externa incorrecta bloquea antes de importar y de conectar' {
        Assert-Throws { Invoke-HttpsClientSetup $testDirectory ('B' * 64) } 'huella no coincide'
        Assert-True ($script:addCalls -eq 0 -and $script:identityCalls -eq 0) 'Confio antes de comparar hash externo.'
    }
    Reset-Fakes
    Test-Case 'Servidor incorrecto bloquea antes de importar confianza' {
        $script:identityFail = $true
        Assert-Throws { Invoke-HttpsClientSetup $testDirectory $rootHash } 'Identidad'
        Assert-True ($script:addCalls -eq 0) 'Importo CA antes de verificar servidor.'
    }
    Reset-Fakes
    Test-Case 'Instala una sola CA publica y comprueba salud normal' {
        $result = Invoke-HttpsClientSetup $testDirectory $rootHash
        Assert-True ($result.Added -and $script:addCalls -eq 1 -and $script:healthCalls -eq 1 -and $script:removeCalls -eq 0) 'Secuencia incorrecta.'
    }
    Reset-Fakes
    Test-Case 'Fallo posterior retira solamente CA nueva de este intento' {
        $script:healthFail = $true
        Assert-Throws { Invoke-HttpsClientSetup $testDirectory $rootHash } 'Salud'
        Assert-True ($script:addCalls -eq 1 -and $script:removeCalls -eq 1) 'No restauro confianza tras fallo.'
    }
    Reset-Fakes
    Test-Case 'Fallo posterior no retira CA ya instalada anteriormente' {
        $script:healthFail = $true; $script:addNew = $false
        Assert-Throws { Invoke-HttpsClientSetup $testDirectory $rootHash } 'Salud'
        Assert-True ($script:removeCalls -eq 0) 'Retiro CA preexistente.'
    }
    Reset-Fakes
    Test-Case 'Diagnostico sin admin ni huella externa no cambia confianza' {
        $script:admin = $false
        $result = Invoke-HttpsClientSetup $testDirectory -ReadOnly
        Assert-True ($result.Mode -eq 'Diagnostico' -and -not $result.RootInstalled -and $script:addCalls -eq 0 -and $script:removeCalls -eq 0 -and $script:healthCalls -eq 0) 'Diagnostico modifico confianza.'
    }
    Reset-Fakes
    Test-Case 'Diagnostico de CA existente comprueba salud sin mutaciones' {
        $script:installed = $true
        $result = Invoke-HttpsClientSetup $testDirectory -ReadOnly
        Assert-True ($result.RootInstalled -and $script:healthCalls -eq 1 -and $script:addCalls -eq 0 -and $script:removeCalls -eq 0) 'Diagnostico inesperado.'
    }
    Write-Host "RESULTADO: $script:passed pruebas aprobadas; ningun certificado instalado o retirado del sistema."
} finally {
    $script:root.Dispose()
    $resolvedTest = [IO.Path]::GetFullPath($testDirectory)
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolvedTest.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolvedTest) -notmatch '^ldsm-https-client-test-[a-f0-9]{32}$') { throw 'No se pudo verificar la ruta temporal para su limpieza.' }
    Remove-Item -LiteralPath $resolvedTest -Recurse -Force
}
