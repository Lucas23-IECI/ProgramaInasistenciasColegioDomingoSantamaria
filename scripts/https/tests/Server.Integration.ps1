#requires -Version 5.1
<#
.SYNOPSIS Real, isolated Docker/TLS verification. Never installs certificate trust.
.DESCRIPTION Uses currently running frontend/backend images by immutable ID.
Creates its OWN random Compose project and loopback high ports. The backend is
a stateless fixture, not the school app/database. No production containers are
recreated, no real users logged in, no volumes/databases or trust stores touched.
Evidence survives under output/https; temporary keys and containers are removed.
#>
[CmdletBinding()]
param([switch]$AplicacionQa)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$httpsRoot = Split-Path -Parent $PSScriptRoot
$projectRoot = Split-Path -Parent (Split-Path -Parent $httpsRoot)
Import-Module (Join-Path $httpsRoot 'Certificates.psm1') -Force
Import-Module (Join-Path $httpsRoot 'Server.psm1') -Force
# This file guards its entry point when dot-sourced; only helper definitions
# are loaded, so no trusted-root installation occurs.
. (Join-Path $httpsRoot 'Confiar-Equipo.ps1')
Initialize-HttpsClientProbe
$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
$composeProject = 'ldsm_https_probe_' + $runId
$evidence = Join-Path $projectRoot ('output/https/integration-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $runId)
$workspace = Join-Path $evidence 'workspace'
$release = Join-Path $workspace 'release'
$checks = New-Object 'System.Collections.Generic.List[object]'
$failure = $null
$cleanupFailure = $null
$memoryItems = New-Object 'System.Collections.Generic.List[object]'
$httpListener = $null
$httpsListener = $null
$frontendBefore = $null
$backendBefore = $null
$httpPort = $null
$httpsPort = $null
$started = Get-Date
$dockerStarted = $false
$applicationChecks = $null

function Assert-Integration([bool]$Condition, [string]$Name, $Detail = $null) {
    $checks.Add([pscustomobject]@{ name = $Name; passed = $Condition; detail = $Detail })
    if (-not $Condition) { throw $Name }
    Write-Host "PASS $Name"
}
function Invoke-TestDocker([string[]]$DockerArguments) {
    $previousPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5.1 represents normal native stderr progress as
        # ErrorRecords. Capture it, but decide success ONLY from the exit code.
        $ErrorActionPreference = 'Continue'
        $lines = @(& docker @DockerArguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previousPreference }
    if ($exitCode -ne 0) { throw ('Docker integration command failed: ' + ($lines -join "`n")) }
    return ($lines -join "`n")
}
function Write-TestJson([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, (ConvertTo-Json -InputObject $Value -Depth 60), [Text.UTF8Encoding]::new($false))
}
function Get-TestPem([byte[]]$Bytes) {
    return "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($Bytes, [Base64FormattingOptions]::InsertLineBreaks).Replace("`r`n", "`n") + "`n-----END CERTIFICATE-----`n"
}
function New-TestRsa {
    $rsa = New-Object Security.Cryptography.RSACryptoServiceProvider(3072)
    $rsa.PersistKeyInCsp = $false
    $memoryItems.Add($rsa)
    return $rsa
}
function New-TestRoot([string]$Name) {
    $rsa = New-TestRsa
    $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
        "CN=$Name", $rsa, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true, $true, 0, $true))
    $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign, $true))
    $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509SubjectKeyIdentifierExtension]::new($request.PublicKey, $false))
    $certificate = $request.CreateSelfSigned([DateTimeOffset]::Now.AddMinutes(-5), [DateTimeOffset]::Now.AddDays(3))
    $memoryItems.Add($certificate)
    return $certificate
}
function Invoke-TestCurl([string]$Name, [string]$Url, [string[]]$Extra = @(), [string]$CaFile = $script:rootPem) {
    $headersPath = Join-Path $evidence ($Name + '.headers.txt')
    $bodyPath = Join-Path $evidence ($Name + '.body.txt')
    $errorPath = Join-Path $evidence ($Name + '.stderr.txt')
    # Internal CA has no online CRL service. Schannel may check revocation when
    # available, while missing/offline CRL is not a TLS-identity bypass. Keep
    # explicit CA and hostname validation; wrong-CA/name tests below prove it.
    $curlArguments = @('--silent', '--show-error', '--noproxy', '*', '--connect-timeout', '5', '--max-time', '15', '--ssl-revoke-best-effort', '--cacert', $CaFile,
        '--dump-header', $headersPath, '--output', $bodyPath, '--write-out', '%{http_code}') + $Extra + @($Url)
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $status = & curl.exe @curlArguments 2>$errorPath
        $exitCode = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previousPreference }
    return [pscustomobject]@{
        ExitCode = $exitCode; Status = [string]$status
        Headers = if (Test-Path -LiteralPath $headersPath) { [IO.File]::ReadAllText($headersPath) } else { '' }
        Body = if (Test-Path -LiteralPath $bodyPath) { [IO.File]::ReadAllText($bodyPath) } else { '' }
        Error = if (Test-Path -LiteralPath $errorPath) { [IO.File]::ReadAllText($errorPath) } else { '' }
    }
}

try {
    foreach ($command in @('docker', 'curl.exe', 'node')) { Get-Command $command -ErrorAction Stop | Out-Null }
    Protect-LdsmHttpsDirectory -Path $evidence
    Protect-LdsmHttpsDirectory -Path $workspace
    Protect-LdsmHttpsDirectory -Path $release
    $frontendBefore = (Invoke-TestDocker @('inspect', '--format', '{{.Id}}', 'ldsm_frontend')).Trim()
    $backendBefore = (Invoke-TestDocker @('inspect', '--format', '{{.Id}}', 'ldsm_backend')).Trim()
    $frontendImage = (Invoke-TestDocker @('inspect', '--format', '{{.Image}}', 'ldsm_frontend')).Trim()
    $backendImage = (Invoke-TestDocker @('inspect', '--format', '{{.Image}}', 'ldsm_backend')).Trim()
    Assert-Integration ($frontendImage -match '^sha256:[a-f0-9]{64}$' -and $backendImage -match '^sha256:[a-f0-9]{64}$') 'Use exact existing Docker images, no build/pull or production deployment'
    $root = New-TestRoot ('LDSM ephemeral HTTPS test ' + $runId)
    $wrongRoot = New-TestRoot ('LDSM wrong ephemeral HTTPS test ' + $runId)
    $leafKey = New-TestRsa
    $leafRequest = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
        'CN=192.168.50.28', $leafKey, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $leafRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
    $leafRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
        ([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment), $true))
    $oids = [Security.Cryptography.OidCollection]::new()
    [void]$oids.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
    $leafRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids, $false))
    $san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $san.AddDnsName('localhost')
    $san.AddIpAddress([Net.IPAddress]::Parse('127.0.0.1'))
    $san.AddIpAddress([Net.IPAddress]::Parse('192.168.50.28'))
    $leafRequest.CertificateExtensions.Add($san.Build())
    $serial = New-Object byte[] 16
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($serial); $serial[0] = $serial[0] -band 127 }
    finally { $random.Dispose() }
    $leaf = $leafRequest.Create($root, [DateTimeOffset]::Now.AddMinutes(-5), [DateTimeOffset]::Now.AddDays(1), $serial)
    $memoryItems.Add($leaf)
    $script:rootPem = Join-Path $evidence 'root-public.pem'
    $wrongPem = Join-Path $evidence 'wrong-root-public.pem'
    [IO.File]::WriteAllText($rootPem, (Get-TestPem $root.RawData), [Text.Encoding]::ASCII)
    [IO.File]::WriteAllText($wrongPem, (Get-TestPem $wrongRoot.RawData), [Text.Encoding]::ASCII)
    [IO.File]::WriteAllText((Join-Path $release 'ldsm-lan.pem'), (Get-TestPem $leaf.RawData), [Text.Encoding]::ASCII)
    [IO.File]::WriteAllText((Join-Path $release 'ldsm-lan-key.pem'), (ConvertTo-LdsmRsaPrivateKeyPem $leafKey), [Text.Encoding]::ASCII)
    [IO.File]::WriteAllText((Join-Path $release 'nginx.conf'), (Get-LdsmHttpsNginx -LanIp '192.168.50.28' -TemplatePath (Join-Path $projectRoot 'frontend/frontend.https.conf')), [Text.UTF8Encoding]::new($false))
    $httpListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $httpListener.Start()
    $httpPort = ([Net.IPEndPoint]$httpListener.LocalEndpoint).Port
    $httpsListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $httpsListener.Start()
    $httpsPort = ([Net.IPEndPoint]$httpsListener.LocalEndpoint).Port
    Assert-Integration ($httpPort -gt 20000 -and $httpsPort -gt 20000 -and $httpPort -ne $httpsPort) 'Isolated high ports reserved on 127.0.0.1; never ports80/443' @{ http = $httpPort; https = $httpsPort }
    $backendFixture = (Join-Path $PSScriptRoot 'fixtures/backend.cjs').Replace('\', '/')
    $base = [ordered]@{
        services = [ordered]@{
            backend = [ordered]@{
                image = $backendImage; entrypoint = @('node', '/fixture/backend.cjs'); restart = 'no'
                volumes = @(@{ type = 'bind'; source = $backendFixture; target = '/fixture/backend.cjs'; read_only = $true })
                healthcheck = @{ test = @('CMD', 'node', '-e', "fetch('http://127.0.0.1:5000/api/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"); interval = '1s'; timeout = '3s'; retries = 20 }
            }
            frontend = [ordered]@{
                image = $frontendImage; restart = 'no'; ports = @("127.0.0.1:${httpPort}:80")
                depends_on = @{ backend = @{ condition = 'service_healthy' } }
            }
        }
    }
    $override = New-LdsmHttpsOverride -LanIp '192.168.50.28' -ReleasePath $release
    Assert-Integration (@($override.services.frontend.ports | Where-Object { $_.target -eq 443 -and [int]$_.published -eq 443 -and $_.host_ip -eq '192.168.50.28' }).Count -eq 1) 'Managed override declares persistent LAN HTTPS listener before isolated-port adaptation'
    $override.services.frontend.ports = @("127.0.0.1:${httpsPort}:443")
    $override.services.frontend.healthcheck.interval = '1s'
    $override.services.frontend.healthcheck.timeout = '3s'
    $override.services.frontend.healthcheck.retries = 20
    Write-TestJson (Join-Path $workspace 'docker-compose.yml') $base
    Write-TestJson (Join-Path $workspace 'docker-compose.override.yml') $override
    $composeArguments = @('compose', '--project-directory', $workspace, '--project-name', $composeProject)
    $renderedText = Invoke-TestDocker ($composeArguments + @('config', '--format', 'json'))
    [IO.File]::WriteAllText((Join-Path $evidence 'compose-rendered.json'), $renderedText, [Text.UTF8Encoding]::new($false))
    $rendered = $renderedText | ConvertFrom-Json
    Assert-Integration (@($rendered.services.frontend.ports | Where-Object { $_.target -eq 443 -and [int]$_.published -eq $httpsPort -and $_.host_ip -eq '127.0.0.1' }).Count -eq 1) 'Plain Compose automatically merges managed HTTPS override'
    Assert-Integration (@($rendered.services.frontend.volumes | Where-Object { $_.target -eq '/etc/nginx/certs/ldsm-lan-key.pem' -and $_.read_only }).Count -eq 1) 'Certificate mount persists and private key is mounted read-only'
    Assert-Integration ($rendered.services.backend.environment.COOKIE_SECURE -eq 'true' -and $rendered.services.backend.environment.CORS_ORIGIN -eq 'https://192.168.50.28') 'Secure-cookie and exact HTTPS CORS settings survive automatic merge'
    $httpListener.Stop(); $httpListener = $null
    $httpsListener.Stop(); $httpsListener = $null
    $dockerStarted = $true
    $startup = Invoke-TestDocker ($composeArguments + @('up', '-d', '--pull', 'never', '--wait', '--wait-timeout', '60'))
    [IO.File]::WriteAllText((Join-Path $evidence 'docker-startup.log'), $startup, [Text.UTF8Encoding]::new($false))
    $frontId = (Invoke-TestDocker ($composeArguments + @('ps', '-q', 'frontend'))).Trim()
    $container = (Invoke-TestDocker @('inspect', $frontId) | ConvertFrom-Json)[0]
    foreach ($bindingName in @('80/tcp', '443/tcp')) {
        foreach ($binding in $container.NetworkSettings.Ports.$bindingName) { Assert-Integration ($binding.HostIp -eq '127.0.0.1' -and [int]$binding.HostPort -gt 20000) ("Actual container binding isolated: $bindingName") }
    }
    [PuroCole.HttpsClientProbe]::Verify('127.0.0.1', $httpsPort, $root.RawData)
    Assert-Integration $true 'Actual Windows installer TLS probe validates untrusted-but-pinned private CA without installing trust'
    $probeRejectedWrongCa = $false
    try { [PuroCole.HttpsClientProbe]::Verify('127.0.0.1', $httpsPort, $wrongRoot.RawData) }
    catch { $probeRejectedWrongCa = $true }
    Assert-Integration $probeRejectedWrongCa 'Actual Windows installer TLS probe rejects a different root against real Nginx'
    $health = Invoke-TestCurl 'https-health' "https://127.0.0.1:$httpsPort/healthz"
    Assert-Integration ($health.ExitCode -eq 0 -and $health.Status -eq '200' -and $health.Body.Trim() -eq 'ok') 'Correct private CA validates real Nginx HTTPS without --insecure' $health.Error
    $ready = Invoke-TestCurl 'https-backend-ready' "https://127.0.0.1:$httpsPort/api/health/ready"
    Assert-Integration ($ready.ExitCode -eq 0 -and $ready.Status -eq '200' -and ($ready.Body | ConvertFrom-Json).fixture) 'HTTPS reverse proxy reaches isolated backend fixture'
    $loginPage = Invoke-TestCurl 'https-login-page' "https://127.0.0.1:$httpsPort/login"
    Assert-Integration ($loginPage.ExitCode -eq 0 -and $loginPage.Status -eq '200' -and $loginPage.Body -match '<html') 'Actual deployed frontend login HTML served through verified HTTPS'
    $login = Invoke-TestCurl 'https-cookie' "https://127.0.0.1:$httpsPort/api/auth/login" @('--request', 'POST')
    $loginPayload = $login.Body | ConvertFrom-Json
    Assert-Integration ($login.ExitCode -eq 0 -and $login.Status -eq '200' -and $login.Headers -match '(?im)^Set-Cookie:.*; Secure' -and $loginPayload.secure -and $loginPayload.forwardedProto -eq 'https') 'Proxy forwards HTTPS protocol and fixture emits Secure HttpOnly cookie'
    $http = Invoke-TestCurl 'http-redirect' "http://127.0.0.1:$httpPort/login?test=1"
    Assert-Integration ($http.ExitCode -eq 0 -and $http.Status -eq '308' -and $http.Headers -match '(?im)^Location: https://192\.168\.50\.28/login\?test=1\r?$') 'HTTP redirects to configured LAN IP and preserves path/query'
    $hostAttack = Invoke-TestCurl 'http-host-header' "http://127.0.0.1:$httpPort/login" @('--header', 'Host: attacker.invalid')
    Assert-Integration ($hostAttack.Status -eq '308' -and $hostAttack.Headers -match '(?im)^Location: https://192\.168\.50\.28/login\r?$' -and $hostAttack.Headers -notmatch '(?im)^Location:.*attacker') 'Host header cannot redirect school users to an attacker domain'
    $wrongCa = Invoke-TestCurl 'https-wrong-ca' "https://127.0.0.1:$httpsPort/healthz" @() $wrongPem
    Assert-Integration ($wrongCa.ExitCode -ne 0 -and $wrongCa.Status -eq '000') 'TLS rejects certificate issued by another root' @{ exitCode = $wrongCa.ExitCode; error = $wrongCa.Error }
    $wrongName = Invoke-TestCurl 'https-wrong-name' "https://wrong-name.invalid:$httpsPort/healthz" @('--resolve', "wrong-name.invalid:${httpsPort}:127.0.0.1")
    Assert-Integration ($wrongName.ExitCode -ne 0 -and $wrongName.Status -eq '000') 'TLS rejects wrong server name even with correct root' @{ exitCode = $wrongName.ExitCode; error = $wrongName.Error }
    $streamOutput = & node (Join-Path $PSScriptRoot 'fixtures/probe-stream.cjs') $httpsPort $rootPem
    $streamExit = $LASTEXITCODE
    $stream = $streamOutput | ConvertFrom-Json
    Write-TestJson (Join-Path $evidence 'sse-stream.json') $stream
    Assert-Integration ($streamExit -eq 0 -and $stream.authorized -and $stream.protocol -match '^TLSv1\.[23]$') 'SSE streams progressively through trusted TLS, not buffered until close' $stream
    $beforeId = $frontId
    Invoke-TestDocker ($composeArguments + @('up', '-d', '--pull', 'never', '--wait', '--wait-timeout', '60')) | Out-Null
    $afterId = (Invoke-TestDocker ($composeArguments + @('ps', '-q', 'frontend'))).Trim()
    $again = Invoke-TestCurl 'https-after-ordinary-up' "https://127.0.0.1:$httpsPort/healthz"
    Assert-Integration ($beforeId -eq $afterId -and $again.Status -eq '200' -and $again.ExitCode -eq 0) 'Ordinary subsequent compose up preserves HTTPS and does not recreate unchanged frontend'
    if ($AplicacionQa) {
        # Explicit opt-in: login/logout add audit records ONLY in disposable QA.
        $qa = (Invoke-TestDocker @('inspect', 'ldsm_backend_codex_manual') | ConvertFrom-Json)[0]
        $qaEnv = @{}
        foreach ($line in $qa.Config.Env) { $pair = $line -split '=',2; if ($pair.Count -eq 2) { $qaEnv[$pair[0]] = $pair[1] } }
        if ($qaEnv.DB_NAME -ne 'ldsm_codex_manual_019ffb95' -or -not $qaEnv.DEFAULT_USER_PASSWORD) { throw 'Refusing to test login against an unknown/non-QA database.' }
        if (-not $qa.NetworkSettings.Networks.PSObject.Properties['ldsm_codex_manual_net']) { throw 'QA network identity mismatch.' }
        $qaVolumes = @($qa.Mounts | Where-Object { $_.Type -eq 'volume' -and $_.Name -eq 'ldsm_codex_manual_uploads' -and $_.Destination -eq '/app/uploads' })
        if ($qaVolumes.Count -ne 1) { throw 'Refusing unknown QA document volume.' }
        $qaEnv.COOKIE_SECURE = 'true'
        $qaEnv.CORS_ORIGIN = "https://127.0.0.1:$httpsPort"
        $base.services.backend = [ordered]@{
            image=$qa.Image; restart='no'; environment=$qaEnv; networks=@('default','qa')
            volumes=@(@{type='volume';source='qa_uploads';target='/app/uploads';read_only=$true})
            healthcheck=@{ test=@('CMD','node','-e',"fetch('http://127.0.0.1:5000/api/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))");interval='2s';timeout='3s';retries=30 }
        }
        $base.networks=@{default=@{};qa=@{external=$true;name='ldsm_codex_manual_net'}}
        $base.volumes=@{qa_uploads=@{external=$true;name='ldsm_codex_manual_uploads'}}
        $override.services.backend.environment.CORS_ORIGIN=$qaEnv.CORS_ORIGIN
        # Private workspace only, escaped once. Never save rendered secrets in evidence.
        Write-LdsmPrivateJson (Join-Path $workspace 'docker-compose.yml') $base -Compose
        Write-LdsmPrivateJson (Join-Path $workspace 'docker-compose.override.yml') $override -Compose
        Invoke-TestDocker ($composeArguments + @('up','-d','--pull','never','--wait','--wait-timeout','90')) | Out-Null
        # Nginx resolves backend at startup; explicitly reload after backend replacement.
        Invoke-TestDocker ($composeArguments + @('exec','-T','frontend','nginx','-s','reload')) | Out-Null
        $previousPassword=$env:LDSM_HTTPS_QA_PASSWORD
        try {
            $env:LDSM_HTTPS_QA_PASSWORD=$qaEnv.DEFAULT_USER_PASSWORD
            $applicationOutput = & node (Join-Path $PSScriptRoot 'fixtures/probe-application.cjs') $httpsPort $rootPem
            $applicationExit=$LASTEXITCODE
        } finally { $env:LDSM_HTTPS_QA_PASSWORD=$previousPassword }
        $applicationChecks=$applicationOutput | ConvertFrom-Json
        Write-TestJson (Join-Path $evidence 'application-qa.json') $applicationChecks
        Assert-Integration ($applicationExit -eq 0 -and $applicationChecks.passed) 'Real QA backend: login, Secure cookies, session, chat, CORS and logout' $applicationChecks
    }
}
catch { $failure = $_; Write-Warning $_.Exception.Message }
finally {
    if ($httpListener) { $httpListener.Stop() }
    if ($httpsListener) { $httpsListener.Stop() }
    if ($dockerStarted) {
        try {
            if ($composeProject -notmatch '^ldsm_https_probe_[a-f0-9]{12}$' -or [IO.Path]::GetFullPath($workspace) -ne [IO.Path]::GetFullPath((Join-Path $evidence 'workspace'))) { throw 'Unsafe test cleanup target.' }
            $cleanup = Invoke-TestDocker @('compose', '--project-directory', $workspace, '--project-name', $composeProject, 'down', '--remove-orphans', '--timeout', '5')
            [IO.File]::WriteAllText((Join-Path $evidence 'docker-cleanup.log'), $cleanup, [Text.UTF8Encoding]::new($false))
            $remaining = Invoke-TestDocker @('ps', '-aq', '--filter', "label=com.docker.compose.project=$composeProject")
            Assert-Integration ([string]::IsNullOrWhiteSpace($remaining)) 'All integration-only containers removed'
        }
        catch { $cleanupFailure = $_; Write-Warning ('Cleanup failed: ' + $_.Exception.Message) }
    }
    foreach ($item in $memoryItems) { $item.Dispose() }
    if (Test-Path -LiteralPath $workspace) {
        $resolvedWorkspace = [IO.Path]::GetFullPath($workspace)
        $resolvedEvidence = [IO.Path]::GetFullPath($evidence).TrimEnd('\') + '\'
        if ($resolvedWorkspace.StartsWith($resolvedEvidence, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedWorkspace) -eq 'workspace' -and -not $cleanupFailure) {
            Remove-Item -LiteralPath $resolvedWorkspace -Recurse -Force
        }
    }
    if ($frontendBefore -and $backendBefore) {
        try {
            $frontendAfter = (Invoke-TestDocker @('inspect', '--format', '{{.Id}}', 'ldsm_frontend')).Trim()
            $backendAfter = (Invoke-TestDocker @('inspect', '--format', '{{.Id}}', 'ldsm_backend')).Trim()
            Assert-Integration ($frontendBefore -eq $frontendAfter -and $backendBefore -eq $backendAfter) 'Existing main application containers were not modified or recreated'
        }
        catch { if (-not $failure) { $failure = $_ } }
    }
    if (Test-Path -LiteralPath $evidence) {
        Write-TestJson (Join-Path $evidence 'results.json') ([ordered]@{
            startedAt = $started.ToString('o'); completedAt = (Get-Date).ToString('o'); powerShell = $PSVersionTable.PSVersion.ToString()
            passed = ($null -eq $failure -and $null -eq $cleanupFailure); checks = $checks.ToArray()
            failure = if ($failure) { $failure.Exception.Message } else { $null }
            cleanupFailure = if ($cleanupFailure) { $cleanupFailure.Exception.Message } else { $null }
            scope = if ($AplicacionQa) { 'Actual frontend + stateless TLS fixture + real QA backend using disposable QA database. Login/logout audit records only. No main database/container mutation or Windows trust-store installation.' } else { 'Actual frontend image + Nginx config/Compose generators + stateless backend fixture. No school backend/database/session mutation; no Windows trust-store installation.' }
            project = $composeProject; httpPort = $httpPort; httpsPort = $httpsPort
        })
    }
}
Write-Host "Evidence: $evidence"
if ($failure) { throw $failure }
if ($cleanupFailure) { throw $cleanupFailure }
Write-Host "$($checks.Count) real Docker/TLS integration checks passed."
