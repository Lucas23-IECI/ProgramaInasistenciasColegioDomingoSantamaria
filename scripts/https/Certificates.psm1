# Compatible with Windows PowerShell 5.1 / .NET Framework 4.8.
# Importing this module does not create certificates or change Windows trust.
Set-StrictMode -Version 2.0

function Get-LdsmCertificateFingerprint {
    <# .SYNOPSIS SHA-256 of the certificate DER, NOT of its PEM file. #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Certificate.RawData))).Replace('-', '') }
    finally { $sha.Dispose() }
}

function ConvertTo-LdsmPem {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes, [Parameter(Mandatory = $true)][string]$Label)
    $base64 = [Convert]::ToBase64String($Bytes)
    $lines = New-Object 'System.Collections.Generic.List[string]'
    $lines.Add("-----BEGIN $Label-----")
    for ($offset = 0; $offset -lt $base64.Length; $offset += 64) {
        $lines.Add($base64.Substring($offset, [Math]::Min(64, $base64.Length - $offset)))
    }
    $lines.Add("-----END $Label-----")
    return ($lines -join "`n") + "`n"
}

function ConvertTo-LdsmDerLength {
    param([Parameter(Mandatory = $true)][ValidateRange(0, 2147483647)][int]$Length)
    if ($Length -lt 128) { return ,([byte[]]@([byte]$Length)) }
    $parts = New-Object 'System.Collections.Generic.List[byte]'
    while ($Length -gt 0) {
        $parts.Insert(0, [byte]($Length -band 255))
        $Length = $Length -shr 8
    }
    $parts.Insert(0, [byte](128 -bor $parts.Count))
    return ,$parts.ToArray()
}

function ConvertTo-LdsmDerInteger {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)
    if ($Bytes.Length -eq 0) { throw 'Un componente RSA esta vacio.' }
    $offset = 0
    while ($offset -lt ($Bytes.Length - 1) -and $Bytes[$offset] -eq 0) { $offset++ }
    $prefix = ($Bytes[$offset] -band 128) -ne 0
    $length = $Bytes.Length - $offset
    if ($prefix) { $length++ }
    $stream = New-Object System.IO.MemoryStream
    try {
        $stream.WriteByte(2)
        $encodedLength = ConvertTo-LdsmDerLength $length
        $stream.Write($encodedLength, 0, $encodedLength.Length)
        if ($prefix) { $stream.WriteByte(0) }
        $stream.Write($Bytes, $offset, $Bytes.Length - $offset)
        return ,$stream.ToArray()
    }
    finally { $stream.Dispose() }
}

function ConvertTo-LdsmRsaPrivateKeyPem {
    <#
    .SYNOPSIS Exports an RSA SERVER key as PKCS#1 PEM on .NET Framework 4.8.
    .DESCRIPTION This function must never be called with the CA key. It uses
    ExportParameters because ExportRSAPrivateKey is unavailable on .NET 4.8.
    It accepts RSA providers with a minimum 2048-bit key. Caller owns the RSA.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][System.Security.Cryptography.RSA]$Rsa)
    if ($Rsa.KeySize -lt 2048) { throw 'La clave RSA del servidor debe tener al menos 2048 bits.' }
    $parameters = $null
    $sequence = $null
    $der = $null
    $body = New-Object System.IO.MemoryStream
    $output = New-Object System.IO.MemoryStream
    try {
        $parameters = $Rsa.ExportParameters($true)
        $zero = ConvertTo-LdsmDerInteger ([byte[]]@(0))
        $body.Write($zero, 0, $zero.Length)
        foreach ($name in @('Modulus', 'Exponent', 'D', 'P', 'Q', 'DP', 'DQ', 'InverseQ')) {
            $bytes = $parameters.$name
            if (-not $bytes -or $bytes.Length -eq 0) { throw "Falta el componente privado RSA $name." }
            $integer = ConvertTo-LdsmDerInteger $bytes
            $body.Write($integer, 0, $integer.Length)
            [Array]::Clear($integer, 0, $integer.Length)
        }
        $sequence = $body.ToArray()
        $output.WriteByte(48)
        $encodedLength = ConvertTo-LdsmDerLength $sequence.Length
        $output.Write($encodedLength, 0, $encodedLength.Length)
        $output.Write($sequence, 0, $sequence.Length)
        $der = $output.ToArray()
        return ConvertTo-LdsmPem -Bytes $der -Label 'RSA PRIVATE KEY'
    }
    finally {
        if ($null -ne $parameters) {
            foreach ($name in @('D', 'P', 'Q', 'DP', 'DQ', 'InverseQ')) {
                $bytes = $parameters.$name
                if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
            }
        }
        if ($sequence) { [Array]::Clear($sequence, 0, $sequence.Length) }
        if ($der) { [Array]::Clear($der, 0, $der.Length) }
        [Array]::Clear($body.GetBuffer(), 0, [int]$body.Length)
        [Array]::Clear($output.GetBuffer(), 0, [int]$output.Length)
        $body.Dispose()
        $output.Dispose()
    }
}

function Assert-LdsmRootCertificate {
    param(
        [Parameter(Mandatory = $true)][System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate,
        [Parameter(Mandatory = $true)][datetime]$LeafNotAfter
    )
    $now = Get-Date
    if (-not $Certificate.HasPrivateKey) { throw 'La autoridad guardada no tiene su clave privada en este equipo. No se creara otra automaticamente.' }
    if ($Certificate.NotBefore -gt $now -or $Certificate.NotAfter -le $LeafNotAfter) {
        throw 'La autoridad guardada no es valida durante todo el proximo ano. Se requiere renovar la confianza de forma planificada.'
    }
    if ([Convert]::ToBase64String($Certificate.SubjectName.RawData) -ne [Convert]::ToBase64String($Certificate.IssuerName.RawData)) {
        throw 'El certificado guardado no es una autoridad raiz autofirmada.'
    }
    $constraints = @($Certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.19' })
    if ($constraints.Count -ne 1) { throw 'La autoridad guardada no tiene una restriccion CA valida.' }
    $basic = New-Object System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension
    $basic.CopyFrom($constraints[0])
    if (-not $basic.CertificateAuthority -or -not $basic.Critical -or -not $basic.HasPathLengthConstraint -or $basic.PathLengthConstraint -ne 0) {
        throw 'La autoridad guardada debe permitir certificados de servidor, no autoridades intermedias.'
    }
    $usages = @($Certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.15' })
    if ($usages.Count -ne 1) { throw 'La autoridad guardada no tiene permiso de firma de certificados.' }
    $usage = New-Object System.Security.Cryptography.X509Certificates.X509KeyUsageExtension
    $usage.CopyFrom($usages[0])
    $certSign = [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign
    if (($usage.KeyUsages -band $certSign) -eq 0) { throw 'La autoridad guardada no tiene permiso de firma de certificados.' }
    $rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($Certificate)
    $public = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($Certificate)
    try {
        if (-not $rsa -or $rsa.KeySize -lt 2048) { throw 'La autoridad guardada no tiene una clave RSA segura.' }
        # Checks actual access to the key WITHOUT exporting its private material.
        $challenge = [Text.Encoding]::UTF8.GetBytes('LDSM-CA-access-check-' + [guid]::NewGuid().ToString('N'))
        $signature = $rsa.SignData($challenge, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
        if (-not $public.VerifyData($challenge, $signature, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)) {
            throw 'No se pudo comprobar la clave de la autoridad guardada.'
        }
    }
    finally {
        if ($rsa) { $rsa.Dispose() }
        if ($public) { $public.Dispose() }
    }
}

function Set-LdsmPrivateDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { New-Item -ItemType Directory -Path $Path -ErrorAction Stop | Out-Null }
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'La carpeta de certificados debe ser un directorio real, no un enlace.'
    }
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $sids = @($identity.User.Value, 'S-1-5-18', 'S-1-5-32-544') | Select-Object -Unique
        foreach ($sid in $sids) {
            $principal = New-Object System.Security.Principal.SecurityIdentifier($sid)
            $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($principal, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
            $acl.AddAccessRule($rule)
        }
        Set-Acl -LiteralPath $Path -AclObject $acl -ErrorAction Stop
    }
    finally { $identity.Dispose() }
}

function Write-LdsmNewFile {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][byte[]]$Bytes)
    # Do not overwrite deployed keys or an existing recovery record.
    $stream = New-Object System.IO.FileStream($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($Bytes, 0, $Bytes.Length); $stream.Flush($true) }
    finally { $stream.Dispose() }
}

function New-LdsmHttpsCertificateMaterial {
    <#
    .SYNOPSIS Creates HTTPS material in a NEW private staging directory.
    .DESCRIPTION Requires an elevated Windows session. Never installs trust.
    The root is created in Cert:\LocalMachine\My, non-exportable, RSA3072,
    SHA256, CA path length zero, lifetime five years. It is reused ONLY when
    its previously persisted thumbprint is supplied. The server certificate
    lasts one year and covers the LAN IPv4, localhost and 127.0.0.1.
    On failure the CA is never removed: Exception.Data contains RootThumbprint
    and RootSha256 when available; ca-recovery.json is written immediately.
    The caller must preserve that identity on rollback to avoid silent CA
    rotation. Server keys are temporary in My and removed in finally (also
    on failed export), including their key container. No CA key is exported.
    .OUTPUTS Object: RootThumbprint, RootSha256, LeafThumbprint, LeafNotAfter,
    CertificatePath, PrivateKeyPath, RootPemPath, RootCerPath, RecoveryPath.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$LanIp,
        [Parameter(Mandatory = $true)][string]$OutputDirectory,
        [string]$RootThumbprint = ''
    )
    $ErrorActionPreference = 'Stop'
    $ip = $null
    if (-not [Net.IPAddress]::TryParse($LanIp, [ref]$ip) -or $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $ip.ToString() -ne $LanIp) {
        throw 'La IP debe ser una IPv4 escrita completa, por ejemplo 192.168.50.28.'
    }
    $octets = $ip.GetAddressBytes()
    $privateAddress = $octets[0] -eq 10 -or ($octets[0] -eq 172 -and $octets[1] -ge 16 -and $octets[1] -le 31) -or ($octets[0] -eq 192 -and $octets[1] -eq 168) -or $LanIp -eq '127.0.0.1'
    if (-not $privateAddress) { throw 'Selecciona una IP privada de la red interna del colegio.' }
    if ($RootThumbprint -and $RootThumbprint -notmatch '\A[0-9A-Fa-f]{40}\z') { throw 'La huella de la autoridad guardada no tiene el formato esperado.' }
    $directory = [IO.Path]::GetFullPath($OutputDirectory)
    $names = @('ldsm-lan.pem', 'ldsm-lan-key.pem', 'rootCA.pem', 'rootCA.cer', 'ca-recovery.json')
    foreach ($name in $names) {
        if (Test-Path -LiteralPath (Join-Path $directory $name)) { throw 'Usa una carpeta de preparacion nueva. No se sobrescribiran certificados existentes.' }
    }
    Set-LdsmPrivateDirectory -Path $directory
    $root = $null
    $leaf = $null
    $rootSha = $null
    $generationFailure = $null
    $now = Get-Date
    $leafNotAfter = $now.AddYears(1)
    try {
        if ($RootThumbprint) {
            $root = Get-Item -LiteralPath ("Cert:\LocalMachine\My\" + $RootThumbprint) -ErrorAction Stop
        }
        else {
            $rootParameters = @{
                Type = 'Custom'; Subject = ('CN=LDSM Autoridad HTTPS interna ' + [guid]::NewGuid().ToString('N'))
                FriendlyName = 'LDSM HTTPS - Autoridad privada (no exportar)'
                Provider = 'Microsoft Software Key Storage Provider'; KeyAlgorithm = 'RSA'; KeyLength = 3072
                KeyExportPolicy = 'NonExportable'; KeyUsage = @('CertSign', 'CRLSign'); KeyUsageProperty = 'Sign'
                HashAlgorithm = 'SHA256'; CertStoreLocation = 'Cert:\LocalMachine\My'
                NotBefore = $now.AddMinutes(-5); NotAfter = $now.AddYears(5)
                TextExtension = @('2.5.29.19={critical}{text}ca=1&pathlength=0')
            }
            $root = New-SelfSignedCertificate @rootParameters -ErrorAction Stop
        }
        $RootThumbprint = $root.Thumbprint
        $rootSha = Get-LdsmCertificateFingerprint $root
        $recoveryPath = Join-Path $directory 'ca-recovery.json'
        $recovery = [ordered]@{
            RootThumbprint = $RootThumbprint; RootSha256 = $rootSha
            RootNotAfter = $root.NotAfter.ToUniversalTime().ToString('o'); CertificateStore = 'LocalMachine\My'
            Instruction = 'Conservar esta huella en la configuracion; nunca copiar ni exportar la clave privada de la autoridad.'
        } | ConvertTo-Json
        Write-LdsmNewFile -Path $recoveryPath -Bytes ([Text.Encoding]::UTF8.GetBytes($recovery))
        Assert-LdsmRootCertificate -Certificate $root -LeafNotAfter $leafNotAfter
        $san = @('DNS=localhost', 'IPAddress=127.0.0.1')
        if ($LanIp -ne '127.0.0.1') { $san += "IPAddress=$LanIp" }
        $leafParameters = @{
            Type = 'Custom'; Subject = "CN=$LanIp"; FriendlyName = 'LDSM HTTPS - Servidor temporal para exportacion'
            Provider = 'Microsoft Software Key Storage Provider'; KeyAlgorithm = 'RSA'; KeyLength = 3072
            KeyExportPolicy = 'Exportable'; KeyUsage = @('DigitalSignature', 'KeyEncipherment')
            HashAlgorithm = 'SHA256'; CertStoreLocation = 'Cert:\LocalMachine\My'; Signer = $root
            NotBefore = $now.AddMinutes(-5); NotAfter = $leafNotAfter
            TextExtension = @('2.5.29.19={critical}{text}ca=0', '2.5.29.37={text}1.3.6.1.5.5.7.3.1', ('2.5.29.17={text}' + ($san -join '&')))
        }
        $leaf = New-SelfSignedCertificate @leafParameters -ErrorAction Stop
        $certificatePath = Join-Path $directory 'ldsm-lan.pem'
        $privateKeyPath = Join-Path $directory 'ldsm-lan-key.pem'
        $rootPemPath = Join-Path $directory 'rootCA.pem'
        $rootCerPath = Join-Path $directory 'rootCA.cer'
        $rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($leaf)
        $keyBytes = $null
        try {
            $keyBytes = [Text.Encoding]::ASCII.GetBytes((ConvertTo-LdsmRsaPrivateKeyPem $rsa))
            Write-LdsmNewFile -Path $privateKeyPath -Bytes $keyBytes
        }
        finally {
            if ($keyBytes) { [Array]::Clear($keyBytes, 0, $keyBytes.Length) }
            if ($rsa) { $rsa.Dispose() }
        }
        Write-LdsmNewFile -Path $certificatePath -Bytes ([Text.Encoding]::ASCII.GetBytes((ConvertTo-LdsmPem -Bytes $leaf.RawData -Label 'CERTIFICATE')))
        Write-LdsmNewFile -Path $rootPemPath -Bytes ([Text.Encoding]::ASCII.GetBytes((ConvertTo-LdsmPem -Bytes $root.RawData -Label 'CERTIFICATE')))
        Write-LdsmNewFile -Path $rootCerPath -Bytes $root.RawData
        $result = [pscustomobject]@{
            RootThumbprint = $RootThumbprint; RootSha256 = $rootSha; LeafThumbprint = $leaf.Thumbprint
            LeafNotAfter = $leaf.NotAfter; CertificatePath = $certificatePath; PrivateKeyPath = $privateKeyPath
            RootPemPath = $rootPemPath; RootCerPath = $rootCerPath; RecoveryPath = $recoveryPath
        }
        return $result
    }
    catch {
        $generationFailure = $_
        # Root identity is available even if disk output or leaf generation failed.
        if ($RootThumbprint) { $_.Exception.Data['RootThumbprint'] = $RootThumbprint }
        if ($rootSha) { $_.Exception.Data['RootSha256'] = $rootSha }
        if ($leaf) { $_.Exception.Data['TemporaryLeafThumbprint'] = $leaf.Thumbprint }
        throw
    }
    finally {
        if ($leaf) {
            try {
                Remove-Item -LiteralPath ("Cert:\LocalMachine\My\" + $leaf.Thumbprint) -DeleteKey -Force -ErrorAction Stop
            }
            catch {
                if ($generationFailure) {
                    $generationFailure.Exception.Data['LeafCleanupError'] = $_.Exception.Message
                    Write-Warning ("No se pudo retirar el certificado temporal del servidor: " + $leaf.Thumbprint + '. La autoridad no fue eliminada.')
                }
                else {
                    $_.Exception.Data['RootThumbprint'] = $RootThumbprint
                    $_.Exception.Data['RootSha256'] = $rootSha
                    $_.Exception.Data['TemporaryLeafThumbprint'] = $leaf.Thumbprint
                    throw
                }
            }
        }
    }
}

Export-ModuleMember -Function Get-LdsmCertificateFingerprint, ConvertTo-LdsmRsaPrivateKeyPem, New-LdsmHttpsCertificateMaterial
