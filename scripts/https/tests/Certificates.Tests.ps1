# No Pester dependency; NEVER creates/removes certificates in Windows stores.
# Run on Windows PowerShell 5.1 and PowerShell 7.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$module = Import-Module (Join-Path (Split-Path -Parent $PSScriptRoot) 'Certificates.psm1') -Force -PassThru
$passed = 0
$testDirectory = Join-Path ([IO.Path]::GetTempPath()) ('ldsm-https-cert-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDirectory | Out-Null

function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Test-Case([string]$Name, [scriptblock]$Body) {
    & $Body
    $script:passed++
    Write-Host "PASS $Name"
}
function Assert-Throws([scriptblock]$Body, [string]$Pattern) {
    $caught = $null
    try { & $Body | Out-Null } catch { $caught = $_ }
    Assert-True ($null -ne $caught) 'Expected a failure.'
    Assert-True ($caught.Exception.Message -match $Pattern) ("Unexpected failure: " + $caught.Exception.Message)
    return $caught
}
function New-MemoryCertificate([bool]$IsCa = $true, [int]$Years = 5) {
    $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider(2048)
    $rsa.PersistKeyInCsp = $false
    $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
        'CN=LDSM isolated memory fixture', $rsa,
        [System.Security.Cryptography.HashAlgorithmName]::SHA256,
        [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($IsCa, $IsCa, 0, $true))
    $usage = if ($IsCa) { [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign } else { [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature }
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new($usage, $true))
    $certificate = $request.CreateSelfSigned([DateTimeOffset]::Now.AddMinutes(-5), [DateTimeOffset]::Now.AddYears($Years))
    return [pscustomobject]@{ Certificate = $certificate; Rsa = $rsa }
}

# An independent small DER reader to verify PKCS#1 serialization and import it
# into the .NET Framework provider. No production DER helper is reused here.
function Read-TestLength([byte[]]$Data, [ref]$Offset) {
    $first = [int]$Data[$Offset.Value]; $Offset.Value++
    if ($first -lt 128) { return $first }
    $count = $first -band 127
    Assert-True ($count -ge 1 -and $count -le 4) 'Invalid DER length.'
    $length = 0
    for ($i = 0; $i -lt $count; $i++) { $length = ($length -shl 8) -bor [int]$Data[$Offset.Value]; $Offset.Value++ }
    return $length
}
function ConvertFrom-TestPkcs1([string]$Pem) {
    Assert-True ($Pem.StartsWith('-----BEGIN RSA PRIVATE KEY-----')) 'Wrong PEM label.'
    $base64 = ($Pem -split '\r?\n' | Where-Object { $_ -and $_ -notmatch '^-----' }) -join ''
    $bytes = [Convert]::FromBase64String($base64)
    $offset = 0
    Assert-True ($bytes[$offset] -eq 48) 'Missing DER sequence.'; $offset++
    $length = Read-TestLength $bytes ([ref]$offset)
    Assert-True ($offset + $length -eq $bytes.Length) 'Wrong DER sequence length.'
    $values = @{}
    foreach ($name in @('Version', 'Modulus', 'Exponent', 'D', 'P', 'Q', 'DP', 'DQ', 'InverseQ')) {
        Assert-True ($bytes[$offset] -eq 2) 'Missing DER integer.'; $offset++
        $size = Read-TestLength $bytes ([ref]$offset)
        Assert-True ($size -gt 0 -and $offset + $size -le $bytes.Length) 'Invalid integer size.'
        Assert-True (($bytes[$offset] -band 128) -eq 0) 'Negative RSA integer.'
        $integer = New-Object byte[] $size
        [Array]::Copy($bytes, $offset, $integer, 0, $size)
        $offset += $size
        if ($integer.Length -gt 1 -and $integer[0] -eq 0) { $integer = [byte[]]$integer[1..($integer.Length - 1)] }
        $values[$name] = $integer
    }
    Assert-True ($offset -eq $bytes.Length) 'Unexpected trailing DER data.'
    Assert-True ($values.Version.Length -eq 1 -and $values.Version[0] -eq 0) 'Invalid PKCS1 version.'
    $parameters = New-Object System.Security.Cryptography.RSAParameters
    foreach ($name in @('Modulus', 'Exponent', 'D', 'P', 'Q', 'DP', 'DQ', 'InverseQ')) { $parameters.$name = $values[$name] }
    return $parameters
}

$memoryRoot = $null
$memoryLeaf = $null
try {
    Test-Case 'DER lengths include long-form boundaries' {
        foreach ($sample in @(@(0, '00'), @(127, '7F'), @(128, '8180'), @(255, '81FF'), @(256, '820100'), @(65536, '83010000'))) {
            $bytes = & $module { param($Size) ConvertTo-LdsmDerLength $Size } $sample[0]
            Assert-True (([BitConverter]::ToString($bytes)).Replace('-', '') -eq $sample[1]) ('DER length ' + $sample[0])
        }
    }
    Test-Case 'DER integers normalize leading zero and preserve unsigned high bits' {
        $examples = @(@([byte[]]@(0), '020100'), @([byte[]]@(0, 1), '020101'), @([byte[]]@(128), '02020080'), @([byte[]]@(0, 128), '02020080'))
        foreach ($sample in $examples) {
            $encoded = & $module { param($Bytes) ConvertTo-LdsmDerInteger $Bytes } $sample[0]
            Assert-True (([BitConverter]::ToString($encoded)).Replace('-', '') -eq $sample[1]) 'DER unsigned encoding mismatch.'
        }
    }
    Test-Case 'PKCS1 PEM roundtrip real RSA CSP 2048 and 3072 keys' {
        foreach ($size in @(2048, 3072)) {
            $source = New-Object System.Security.Cryptography.RSACryptoServiceProvider($size)
            $source.PersistKeyInCsp = $false
            $target = New-Object System.Security.Cryptography.RSACryptoServiceProvider($size)
            $target.PersistKeyInCsp = $false
            try {
                $pem = ConvertTo-LdsmRsaPrivateKeyPem $source
                foreach ($line in ($pem -split '\n' | Where-Object { $_ -and $_ -notmatch '^-----' })) { Assert-True ($line.Length -le 64) 'PEM line exceeds 64.' }
                $target.ImportParameters((ConvertFrom-TestPkcs1 $pem))
                $message = [Text.Encoding]::UTF8.GetBytes('real independent cryptographic verification')
                $signature = $source.SignData($message, 'SHA256')
                Assert-True ($target.VerifyData($message, 'SHA256', $signature)) 'Imported key cannot verify original signature.'
                $signature2 = $target.SignData($message, 'SHA256')
                Assert-True ($source.VerifyData($message, 'SHA256', $signature2)) 'Imported key cannot sign.'
                if (Get-Command node -ErrorAction SilentlyContinue) {
                    $fixture = Join-Path $testDirectory ('rsa-' + $size + '.pem')
                    [IO.File]::WriteAllText($fixture, $pem, [Text.Encoding]::ASCII)
                    & node -e "const fs=require('node:fs'),c=require('node:crypto');const k=c.createPrivateKey(fs.readFileSync(process.argv[1]));if(k.asymmetricKeyDetails.modulusLength!==Number(process.argv[2]))process.exit(2);const m=Buffer.from('test'),s=c.sign('sha256',m,k);if(!c.verify('sha256',m,c.createPublicKey(k),s))process.exit(3)" $fixture $size
                    Assert-True ($LASTEXITCODE -eq 0) 'Node/OpenSSL rejected exported PKCS1.'
                }
            }
            finally { $source.Dispose(); $target.Dispose() }
        }
    }
    Test-Case 'Weak RSA keys rejected before private export' {
        $weak = New-Object System.Security.Cryptography.RSACryptoServiceProvider(1024)
        $weak.PersistKeyInCsp = $false
        try { Assert-Throws { ConvertTo-LdsmRsaPrivateKeyPem $weak } '2048' | Out-Null }
        finally { $weak.Dispose() }
    }
    $memoryRoot = New-MemoryCertificate
    $memoryLeaf = New-MemoryCertificate -IsCa $false -Years 1
    Test-Case 'Fingerprint is SHA256 DER, not PEM file bytes' {
        $actual = Get-LdsmCertificateFingerprint $memoryRoot.Certificate
        $sha = [Security.Cryptography.SHA256]::Create()
        try {
            $expected = ([BitConverter]::ToString($sha.ComputeHash($memoryRoot.Certificate.RawData))).Replace('-', '')
            Assert-True ($actual -eq $expected -and $actual.Length -eq 64) 'Certificate DER fingerprint mismatch.'
        }
        finally { $sha.Dispose() }
    }
    Test-Case 'Root validation accepts real in-memory root and rejects leaf and public-only root' {
        & $module { param($Cert) Assert-LdsmRootCertificate -Certificate $Cert -LeafNotAfter (Get-Date).AddYears(1) } $memoryRoot.Certificate
        Assert-Throws { & $module { param($Cert) Assert-LdsmRootCertificate -Certificate $Cert -LeafNotAfter (Get-Date).AddMonths(1) } $memoryLeaf.Certificate } 'autoridad' | Out-Null
        $publicOnly = [Security.Cryptography.X509Certificates.X509Certificate2]::new($memoryRoot.Certificate.RawData)
        try { Assert-Throws { & $module { param($Cert) Assert-LdsmRootCertificate -Certificate $Cert -LeafNotAfter (Get-Date).AddMonths(1) } $publicOnly } 'clave privada' | Out-Null }
        finally { $publicOnly.Dispose() }
    }
    Test-Case 'Root cannot outlive its allowed signing interval' {
        Assert-Throws { & $module { param($Cert) Assert-LdsmRootCertificate -Certificate $Cert -LeafNotAfter (Get-Date).AddYears(6) } $memoryRoot.Certificate } 'proximo ano' | Out-Null
    }

    # Replace every entry point that could touch the certificate store. The
    # real crypto objects above are ephemeral and never enter any store.
    & $module {
        param($Root, $Leaf)
        $script:testRoot = $Root
        $script:testLeaf = $Leaf
        $script:testCalls = New-Object 'System.Collections.Generic.List[object]'
        $script:failLeaf = $false
        $script:failExport = $false
        $script:failCleanup = $false
        $script:writeOriginal = (Get-Command Write-LdsmNewFile).ScriptBlock
        function script:Write-LdsmNewFile {
            param($Path, $Bytes)
            if ($script:failExport -and (Split-Path -Leaf $Path) -eq 'ldsm-lan.pem') { throw 'Simulated export failure.' }
            & $script:writeOriginal -Path $Path -Bytes $Bytes
        }
        function script:New-SelfSignedCertificate {
            [CmdletBinding()]
            param($Type, $Subject, $FriendlyName, $Provider, $KeyAlgorithm, $KeyLength, $KeyExportPolicy, $KeyUsage, $KeyUsageProperty, $HashAlgorithm, $CertStoreLocation, $NotBefore, $NotAfter, $TextExtension, $Signer)
            $script:testCalls.Add([pscustomobject]@{ Kind = 'New'; Parameters = @{} + $PSBoundParameters })
            if ($Signer) {
                if ($script:failLeaf) { throw 'Simulated signing failure.' }
                return $script:testLeaf
            }
            return $script:testRoot
        }
        function script:Get-Item {
            [CmdletBinding()]
            param($LiteralPath, [switch]$Force)
            if ($LiteralPath -like 'Cert:*') {
                $script:testCalls.Add([pscustomobject]@{ Kind = 'Get'; Path = $LiteralPath })
                if ($LiteralPath -ne ('Cert:\LocalMachine\My\' + $script:testRoot.Thumbprint)) { throw 'Missing persisted root.' }
                return $script:testRoot
            }
            return Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath -Force:$Force
        }
        function script:Remove-Item {
            [CmdletBinding()]
            param($LiteralPath, [switch]$DeleteKey, [switch]$Force)
            if ($LiteralPath -ne ('Cert:\LocalMachine\My\' + $script:testLeaf.Thumbprint) -or -not $DeleteKey) { throw 'Attempt to remove root or unrelated certificate.' }
            $script:testCalls.Add([pscustomobject]@{ Kind = 'Remove'; Path = $LiteralPath })
            if ($script:failCleanup) { throw 'Simulated cleanup failure.' }
        }
    } $memoryRoot.Certificate $memoryLeaf.Certificate

    Test-Case 'New material exports only leaf private key and root public files; never trusts CA' {
        $result = New-LdsmHttpsCertificateMaterial -LanIp '192.168.50.28' -OutputDirectory (Join-Path $testDirectory 'first')
        $calls = & $module { $script:testCalls.ToArray() }
        $newCalls = @($calls | Where-Object Kind -eq 'New')
        Assert-True ($newCalls.Count -eq 2) 'Expected one root and one leaf.'
        $rootParams = $newCalls[0].Parameters
        $leafParams = $newCalls[1].Parameters
        Assert-True ($rootParams.KeyExportPolicy -eq 'NonExportable' -and $rootParams.KeyLength -ge 2048) 'Root private key not protected.'
        Assert-True ($rootParams.CertStoreLocation -eq 'Cert:\LocalMachine\My') 'Root was put in a trusted store.'
        Assert-True ($rootParams.TextExtension -contains '2.5.29.19={critical}{text}ca=1&pathlength=0') 'Missing CA restrictions.'
        Assert-True ($leafParams.TextExtension -contains '2.5.29.37={text}1.3.6.1.5.5.7.3.1') 'Missing TLS server EKU.'
        Assert-True ($leafParams.TextExtension -contains '2.5.29.17={text}DNS=localhost&IPAddress=127.0.0.1&IPAddress=192.168.50.28') 'SAN does not include all required addresses.'
        Assert-True (($rootParams.NotAfter - $rootParams.NotBefore).TotalDays -gt 1825) 'Root is not valid for five years.'
        Assert-True (($leafParams.NotAfter - $leafParams.NotBefore).TotalDays -le 367) 'Leaf validity exceeds a year.'
        Assert-True (@($calls | Where-Object Kind -eq 'Remove').Count -eq 1) 'Temporary leaf not removed.'
        $exportedRoot = [Security.Cryptography.X509Certificates.X509Certificate2]::new($result.RootCerPath)
        try { Assert-True (-not $exportedRoot.HasPrivateKey) 'Exported root contains a private key.' }
        finally { $exportedRoot.Dispose() }
        Assert-True ((Get-Content -LiteralPath $result.PrivateKeyPath -Raw).StartsWith('-----BEGIN RSA PRIVATE KEY-----')) 'Leaf key missing.'
        $recovery = Get-Content -LiteralPath $result.RecoveryPath -Raw | ConvertFrom-Json
        Assert-True ($recovery.RootThumbprint -eq $result.RootThumbprint -and $recovery.RootSha256 -eq $result.RootSha256) 'CA recovery identity missing.'
        $acl = Get-Acl -LiteralPath (Split-Path -Parent $result.PrivateKeyPath)
        Assert-True $acl.AreAccessRulesProtected 'Staging inherited unsafe directory ACL.'
        $allowed = @('S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
        foreach ($rule in $acl.Access) { Assert-True ($allowed -contains $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value) 'Unexpected principal can read private keys.' }
    }
    Test-Case 'Persisted root reused by exact thumbprint; no subject-based lookup or rotation' {
        & $module { $script:testCalls.Clear() }
        $result = New-LdsmHttpsCertificateMaterial -LanIp '10.0.0.7' -OutputDirectory (Join-Path $testDirectory 'reused') -RootThumbprint $memoryRoot.Certificate.Thumbprint
        $calls = & $module { $script:testCalls.ToArray() }
        Assert-True (@($calls | Where-Object Kind -eq 'New').Count -eq 1) 'Reused CA generated an additional root.'
        Assert-True ($result.RootThumbprint -eq $memoryRoot.Certificate.Thumbprint) 'CA identity changed.'
    }
    Test-Case 'Missing root is an actionable failure, never silently replaced' {
        & $module { $script:testCalls.Clear() }
        Assert-Throws { New-LdsmHttpsCertificateMaterial -LanIp '10.0.0.7' -OutputDirectory (Join-Path $testDirectory 'missing') -RootThumbprint ('A' * 40) } 'Missing persisted root' | Out-Null
        $calls = & $module { $script:testCalls.ToArray() }
        Assert-True (@($calls | Where-Object Kind -eq 'New').Count -eq 0) 'Missing root was silently replaced.'
    }
    Test-Case 'Failure after root creation preserves recoverable CA identity without deleting it' {
        & $module { $script:testCalls.Clear(); $script:failLeaf = $true }
        $directory = Join-Path $testDirectory 'failed-leaf'
        $failure = Assert-Throws { New-LdsmHttpsCertificateMaterial -LanIp '172.16.0.5' -OutputDirectory $directory } 'Simulated signing failure'
        Assert-True ($failure.Exception.Data['RootThumbprint'] -eq $memoryRoot.Certificate.Thumbprint) 'Failure lost root identity.'
        Assert-True ($failure.Exception.Data['RootSha256'] -eq (Get-LdsmCertificateFingerprint $memoryRoot.Certificate)) 'Failure lost root fingerprint.'
        Assert-True (Test-Path -LiteralPath (Join-Path $directory 'ca-recovery.json')) 'Failure lost durable recovery file.'
        $calls = & $module { $script:testCalls.ToArray() }
        Assert-True (@($calls | Where-Object Kind -eq 'Remove').Count -eq 0) 'Failure removed CA.'
        & $module { $script:failLeaf = $false }
    }
    Test-Case 'Invalid IP, injected SAN, public IP and invalid thumbprint fail before certificate creation' {
        & $module { $script:testCalls.Clear() }
        foreach ($bad in @('not-an-ip', '192.168.50.28&DNS=attacker', '127.1', '8.8.8.8', '0.0.0.0', '169.254.0.2', '::1')) {
            Assert-Throws { New-LdsmHttpsCertificateMaterial -LanIp $bad -OutputDirectory (Join-Path $testDirectory 'invalid') } 'IPv4|IP privada' | Out-Null
        }
        Assert-Throws { New-LdsmHttpsCertificateMaterial -LanIp '192.168.1.2' -OutputDirectory (Join-Path $testDirectory 'invalid') -RootThumbprint '..\Root' } 'huella' | Out-Null
        $calls = @(& $module { $script:testCalls.ToArray() })
        Assert-True ($calls.Count -eq 0) 'Invalid request touched certificate store.'
    }
    Test-Case 'Failed leaf export removes only temporary leaf and preserves root recovery' {
        & $module { $script:testCalls.Clear(); $script:failExport = $true }
        try {
            $failure = Assert-Throws { New-LdsmHttpsCertificateMaterial -LanIp '192.168.1.2' -OutputDirectory (Join-Path $testDirectory 'export-failure') } 'Simulated export failure'
            $calls = @(& $module { $script:testCalls.ToArray() })
            Assert-True (@($calls | Where-Object Kind -eq 'Remove').Count -eq 1) 'Failed export left temporary private key in store.'
            Assert-True ($failure.Exception.Data['RootThumbprint'] -eq $memoryRoot.Certificate.Thumbprint) 'Failed export lost CA identity.'
        }
        finally { & $module { $script:failExport = $false } }
    }
    Test-Case 'Cleanup failure is reported with exact leaf and root identities' {
        & $module { $script:testCalls.Clear(); $script:failCleanup = $true }
        try {
            $failure = Assert-Throws { New-LdsmHttpsCertificateMaterial -LanIp '192.168.1.2' -OutputDirectory (Join-Path $testDirectory 'cleanup-failure') } 'Simulated cleanup failure'
            Assert-True ($failure.Exception.Data['RootThumbprint'] -eq $memoryRoot.Certificate.Thumbprint) 'Cleanup failure lost CA identity.'
            Assert-True ($failure.Exception.Data['TemporaryLeafThumbprint'] -eq $memoryLeaf.Certificate.Thumbprint) 'Cleanup failure lost temporary leaf identity.'
        }
        finally { & $module { $script:failCleanup = $false } }
    }
    Test-Case 'Existing output cannot overwrite a deployed private key' {
        Assert-Throws { New-LdsmHttpsCertificateMaterial -LanIp '192.168.1.2' -OutputDirectory (Join-Path $testDirectory 'first') } 'No se sobrescribiran' | Out-Null
    }
    Write-Host "$passed certificate tests passed on PowerShell $($PSVersionTable.PSVersion). No Windows certificate store was modified."
}
finally {
    if ($memoryRoot) { $memoryRoot.Certificate.Dispose(); $memoryRoot.Rsa.Dispose() }
    if ($memoryLeaf) { $memoryLeaf.Certificate.Dispose(); $memoryLeaf.Rsa.Dispose() }
    Remove-Module $module -Force
    # Delete only this test-created, fully resolved temporary directory.
    $resolved = [IO.Path]::GetFullPath($testDirectory)
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolved) -like 'ldsm-https-cert-tests-*') {
        Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
    }
}
