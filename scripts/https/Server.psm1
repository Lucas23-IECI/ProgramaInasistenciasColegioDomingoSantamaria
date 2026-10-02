#requires -Version 5.1
Set-StrictMode -Version 2.0

function Test-LdsmPrivateIp {
    param([string]$Address)
    if ($Address -notmatch '^(\d{1,3}\.){3}\d{1,3}$') { return $false }
    $parts = @($Address.Split('.') | ForEach-Object { [int]$_ })
    if (@($parts | Where-Object { $_ -gt 255 }).Count) { return $false }
    if (($parts -join '.') -ne $Address) { return $false }
    return ($parts[0] -eq 10 -or ($parts[0] -eq 172 -and $parts[1] -ge 16 -and $parts[1] -le 31) -or ($parts[0] -eq 192 -and $parts[1] -eq 168))
}

function Protect-LdsmHttpsDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)
    if ((Test-Path -LiteralPath $Path) -and ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'La carpeta privada HTTPS no puede ser un enlace a otro directorio.' }
    [IO.Directory]::CreateDirectory($Path) | Out-Null
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544', $identity.Value) | Select-Object -Unique) {
        $principal = New-Object Security.Principal.SecurityIdentifier($sid)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($principal, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Assert-LdsmNoReparsePoint {
    param([string]$Path, [string]$PrivateRoot)
    $current = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetFullPath($PrivateRoot).TrimEnd('\','/')
    if ($current -ne $root -and -not $current.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'La ruta HTTPS salio de su carpeta privada.' }
    while ($current.Length -ge $root.Length) {
        if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'La carpeta privada HTTPS contiene un enlace no permitido.' }
        if ($current -eq $root) { break }
        $current = [IO.Path]::GetDirectoryName($current)
    }
}

function Write-LdsmPrivateJson {
    param([string]$Path, $Value, [switch]$Compose)
    $text = ConvertTo-Json -InputObject $Value -Depth 70
    if ($Compose) { $text = $text.Replace('$', '$$') }
    # Same-volume atomic replacement: a power loss must not leave a truncated journal.
    $temp = "$Path.next"
    [IO.File]::WriteAllText($temp, $text, (New-Object Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temp, $Path, [NullString]::Value) }
    else { [IO.File]::Move($temp, $Path) }
}

function Invoke-LdsmDocker {
    param([string[]]$Arguments)
    # Capture errors without printing rendered configuration (it contains secrets).
    # Windows PowerShell treats ordinary Compose progress on stderr as an error
    # with Stop. The native EXIT CODE is authoritative, not the stream used.
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $result = & docker @Arguments 2>&1
        $nativeCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    if ($nativeCode -ne 0) { throw "Docker no pudo completar '$($Arguments[0])'. Revisa Docker Desktop y el diagnostico; no se mostraron credenciales." }
    return ($result -join "`n")
}

function New-LdsmHttpsOverride {
    param([string]$LanIp, [string]$ReleasePath, [ValidateRange(1,65535)][int]$HttpsPort = 443)
    if (-not (Test-LdsmPrivateIp $LanIp)) { throw 'La direccion debe ser una IPv4 privada de la red del colegio.' }
    $mountPath = $ReleasePath.Replace('\', '/')
    $httpsOrigin = Get-LdsmHttpsOrigin $LanIp $HttpsPort
    return [ordered]@{
        'x-ldsm-https-managed' = 1
        services = [ordered]@{
            backend = [ordered]@{ environment = [ordered]@{ COOKIE_SECURE = 'true'; CORS_ORIGIN = $httpsOrigin } }
            frontend = [ordered]@{
                ports = @(@{ target=443; published=[string]$HttpsPort; protocol='tcp'; host_ip=$LanIp })
                volumes = @(
                    @{ type = 'bind'; source = "$mountPath/nginx.conf"; target = '/etc/nginx/conf.d/default.conf'; read_only = $true },
                    @{ type = 'bind'; source = "$mountPath/ldsm-lan.pem"; target = '/etc/nginx/certs/ldsm-lan.pem'; read_only = $true },
                    @{ type = 'bind'; source = "$mountPath/ldsm-lan-key.pem"; target = '/etc/nginx/certs/ldsm-lan-key.pem'; read_only = $true }
                )
                healthcheck = @{ test = @('CMD-SHELL', 'wget -q -O - http://127.0.0.1/healthz | grep -q ok') }
            }
        }
    }
}

function Get-LdsmHttpsOrigin {
    param([string]$LanIp, [ValidateRange(1,65535)][int]$HttpsPort = 443)
    if (-not (Test-LdsmPrivateIp $LanIp)) { throw 'IP privada invalida.' }
    if ($HttpsPort -eq 443) { return "https://$LanIp" }
    return "https://${LanIp}:$HttpsPort"
}

function Get-LdsmHttpsNginx {
    param([string]$LanIp, [string]$TemplatePath, [ValidateRange(1,65535)][int]$HttpsPort = 443)
    if (-not (Test-LdsmPrivateIp $LanIp)) { throw 'IP privada invalida.' }
    $content = [IO.File]::ReadAllText($TemplatePath)
    $httpsOrigin = Get-LdsmHttpsOrigin $LanIp $HttpsPort
    # A hostile Host header must never control the redirect destination.
    $content = $content.Replace('return 308 https://$host$request_uri;', "location = /healthz { access_log off; return 200 `"ok`"; }`n    location / { return 308 $httpsOrigin`$request_uri; }")
    $content = $content.Replace('proxy_read_timeout 60s;', "proxy_read_timeout 90s;`n        proxy_buffering off;`n        proxy_cache off;")
    if ($content.Contains('https://$host') -or -not $content.Contains("https://$LanIp")) { throw 'La plantilla HTTPS no tiene el formato esperado; no se instalara una configuracion desconocida.' }
    return $content
}

function Assert-LdsmRunningEnvironment {
    param($Expected, $Container)
    $actual = @{}
    foreach ($line in $Container.Config.Env) {
        $pair = $line -split '=', 2
        if ($pair.Count -eq 2) { $actual[$pair[0]] = $pair[1] }
    }
    foreach ($property in $Expected.PSObject.Properties) {
        # `docker compose config` escapes literals for safe reuse as a Compose file.
        $expectedValue = ([string]$property.Value).Replace('$$', '$')
        if (-not $actual.ContainsKey($property.Name) -or $actual[$property.Name] -cne $expectedValue) {
            throw 'Hay cambios de configuracion pendientes respecto del servidor en ejecucion. Aplicalos o revisalos antes de instalar HTTPS; no se mezclaran ambas operaciones.'
        }
    }
}

function Test-LdsmManagedOverride {
    param([string]$Path, $State)
    if (-not (Test-Path -LiteralPath $Path)) { return ($null -eq $State) }
    if ($null -eq $State) { return $false }
    return ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -eq $State.override_sha256)
}

function Test-LdsmServerHttps {
    param([string]$LanIp, [string]$RootCer, [string]$RootPem, [ValidateRange(1,65535)][int]$HttpsPort = 443, [ValidateRange(1,65535)][int]$HttpPort = 80)
    $httpsOrigin = Get-LdsmHttpsOrigin $LanIp $HttpsPort
    $httpOrigin = if ($HttpPort -eq 80) { "http://$LanIp" } else { "http://${LanIp}:$HttpPort" }
    [PuroCole.HttpsClientProbe]::Verify($LanIp, $HttpsPort, [IO.File]::ReadAllBytes($RootCer))
    # curl performs its own chain + IP name validation with the explicit CA.
    # No -k/--insecure and no process-global TLS callback.
    foreach ($path in @('/healthz', '/api/health/ready', '/login')) {
        $status = & curl.exe --silent --show-error --ssl-revoke-best-effort --noproxy '*' --cacert $RootPem --connect-timeout 5 --max-time 20 --output NUL --write-out '%{http_code}' "$httpsOrigin$path" 2>$null
        if ($LASTEXITCODE -ne 0 -or $status -ne '200') { throw "No se pudo validar HTTPS y la respuesta de $path. Se recuperara la configuracion anterior." }
    }
    $redirect = & curl.exe --silent --noproxy '*' --max-time 10 --output NUL --write-out '%{http_code} %{redirect_url}' "$httpOrigin/login" 2>$null
    if ($LASTEXITCODE -ne 0 -or $redirect -ne "308 $httpsOrigin/login") { throw 'La redireccion de HTTP a HTTPS no coincide con la direccion del colegio.' }
}

Export-ModuleMember -Function Test-LdsmPrivateIp, Protect-LdsmHttpsDirectory, Write-LdsmPrivateJson, Invoke-LdsmDocker, New-LdsmHttpsOverride, Get-LdsmHttpsNginx, Get-LdsmHttpsOrigin, Assert-LdsmRunningEnvironment, Test-LdsmManagedOverride, Test-LdsmServerHttps, Assert-LdsmNoReparsePoint
