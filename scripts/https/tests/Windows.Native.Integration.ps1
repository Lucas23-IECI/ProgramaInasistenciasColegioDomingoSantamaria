#requires -Version 5.1
<#
.SYNOPSIS Explicitly elevated, isolated Windows HTTPS acceptance test.
.DESCRIPTION Creates one NEW native LocalMachine CA, exercises the actual client
installer and a tightly restricted temporary firewall rule, then removes only
this run's certificates, key containers, rule and Compose project. Uses existing
image IDs with a stateless backend; never starts the school application/backend
or touches a database. Must run in Windows PowerShell 5.1 as administrator after
operator consent. Evidence and transcript remain in output/https/native-<RunId>.
No claim is made that a local request tests remote-LAN firewall traversal.
#>
[CmdletBinding()]
param(
    [string]$LanIp = '',
    [ValidatePattern('^[a-f0-9]{32}$')][string]$RunId = ([guid]::NewGuid().ToString('N'))
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
try { $administrator = (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }
finally { $identity.Dispose() }
if (-not $administrator) { throw 'Native acceptance requires an explicitly elevated Windows PowerShell. No changes made.' }
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5) { throw 'Run this native acceptance test with Windows PowerShell 5.1, not pwsh.' }

$httpsRoot = Split-Path -Parent $PSScriptRoot
$projectRoot = Split-Path -Parent (Split-Path -Parent $httpsRoot)
Import-Module (Join-Path $httpsRoot 'Certificates.psm1') -Force
Import-Module (Join-Path $httpsRoot 'Server.psm1') -Force
. (Join-Path $httpsRoot 'Confiar-Equipo.ps1')
Set-StrictMode -Version 2.0
$evidence = Join-Path $projectRoot ('output/https/native-' + $RunId)
$workspace = Join-Path $evidence 'workspace'
$release = Join-Path $workspace 'release'
$bundle = Join-Path $workspace 'bundle'
$control = Join-Path $workspace 'control'
$composeProject = 'ldsm_https_native_' + $RunId
$ruleName = 'LDSM-HTTPS-NATIVE-TEST-' + $RunId
$windowsPowerShell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$checks = New-Object 'System.Collections.Generic.List[object]'
$cleanupErrors = New-Object 'System.Collections.Generic.List[string]'
$started = Get-Date
$failure = $null
$transcriptStarted = $false
$evidenceCreated = $false
$dockerStarted = $false
$ruleIntent = $false
$httpListener = $null
$httpsListener = $null
$httpPort = $null
$httpsPort = $null
$material = $null
$ownRootThumbprint = ''
$ownRootSha256 = ''
$ownLeafThumbprints = New-Object 'System.Collections.Generic.List[string]'
$rootKeyFile = ''
$rootSubject = ''
$mainBefore = @{}
$beforeMy = @()
$beforeRoot = @()
$serverUrl = ''

function Assert-Native([bool]$Condition, [string]$Name, $Detail = $null) {
    $checks.Add([pscustomobject]@{ name=$Name; passed=$Condition; detail=$Detail })
    if (-not $Condition) { throw $Name }
    Write-Host "PASS $Name"
}
function Write-NativeJson([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, (ConvertTo-Json -InputObject $Value -Depth 40), (New-Object Text.UTF8Encoding($false)))
}
function Invoke-NativeDocker([string[]]$DockerArguments) {
    $previous = $ErrorActionPreference
    try { $ErrorActionPreference='Continue'; $output=@(& docker @DockerArguments 2>&1); $code=$LASTEXITCODE }
    finally { $ErrorActionPreference=$previous }
    if ($code -ne 0) { throw ('Isolated Docker command failed: ' + ($output -join "`n")) }
    return ($output -join "`n")
}
function Invoke-NativeChild([string[]]$ChildArguments, [string]$LogName) {
    $previous = $ErrorActionPreference
    try { $ErrorActionPreference='Continue'; $output=@(& $windowsPowerShell -NoProfile -NonInteractive -ExecutionPolicy Bypass @ChildArguments 2>&1); $code=$LASTEXITCODE }
    finally { $ErrorActionPreference=$previous }
    $text = $output -join "`r`n"
    [IO.File]::WriteAllText((Join-Path $evidence ($LogName + '.log')), $text, (New-Object Text.UTF8Encoding($false)))
    return [pscustomobject]@{ ExitCode=$code; Output=$text }
}
function Test-NativeFreshWindowsTrust([string]$LogName) {
    # Fresh process + fresh connections, no cached TLS session or custom CA file.
    # URL is generated from a canonical RFC1918 IPv4 and a reserved integer port.
    $code = @'
$ErrorActionPreference='Stop'
try {
  foreach($path in @('/healthz','/api/health/ready')) {
    $request=[Net.HttpWebRequest]::Create('__URL__' + $path)
    $request.Proxy=$null; $request.AllowAutoRedirect=$false
    $request.KeepAlive=$false; $request.Timeout=10000; $request.ReadWriteTimeout=10000
    $response=$null
    try { $response=$request.GetResponse(); if([int]$response.StatusCode -ne 200){throw 'Unexpected HTTP status'} }
    finally { if($response){$response.Dispose()} }
  }
  Write-Output 'WINDOWS_TRUST_OK'; exit 0
} catch {
  $errorObject=$_.Exception
  while($errorObject.InnerException){$errorObject=$errorObject.InnerException}
  Write-Output ('WINDOWS_TRUST_REJECTED: ' + $errorObject.GetType().FullName + ': ' + $errorObject.Message)
  exit 17
}
'@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code.Replace('__URL__', $serverUrl)))
    return Invoke-NativeChild @('-EncodedCommand', $encoded) $LogName
}
function Invoke-NativeClient([string]$LogName, [string]$Fingerprint) {
    return Invoke-NativeChild @('-File', (Join-Path $bundle 'Confiar-Equipo.ps1'), '-BundlePath', $bundle, '-ExpectedRootSha256', $Fingerprint) $LogName
}
function Get-NativePublicRoot {
    if (-not $material) { throw 'No completed native certificate material.' }
    return New-Object Security.Cryptography.X509Certificates.X509Certificate2($material.RootCerPath)
}
function Assert-NativeOwnRoot([Security.Cryptography.X509Certificates.X509Certificate2]$Certificate) {
    if (-not $ownRootThumbprint -or -not $ownRootSha256 -or $beforeMy -contains $ownRootThumbprint -or $beforeRoot -contains $ownRootThumbprint -or
        $Certificate.Thumbprint -ne $ownRootThumbprint -or (Get-LdsmCertificateFingerprint $Certificate) -ne $ownRootSha256 -or
        $Certificate.Subject -notmatch '^CN=LDSM Autoridad HTTPS interna [a-f0-9]{32}$') { throw 'Refusing cleanup of an unproven or preexisting certificate.' }
}
function Remove-NativeOwnTrust {
    if (-not $ownRootThumbprint) { return }
    $path = 'Cert:\LocalMachine\Root\' + $ownRootThumbprint
    if (Test-Path -LiteralPath $path) {
        $certificate = Get-Item -LiteralPath $path
        try { Assert-NativeOwnRoot $certificate; Remove-HttpsAddedRoot $certificate }
        finally { $certificate.Dispose() }
    }
    Assert-Native (-not (Test-Path -LiteralPath $path)) 'Only the test root is absent from LocalMachine Root after cleanup'
}

try {
    foreach ($command in @('docker','New-SelfSignedCertificate','New-NetFirewallRule','Get-NetFirewallRule','Remove-NetFirewallRule')) { Get-Command $command -ErrorAction Stop | Out-Null }
    if (Test-Path -LiteralPath $evidence) { throw 'Evidence directory already exists. Use a fresh RunId; no existing run will be reused.' }
    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { (Test-LdsmPrivateIp $_.IPAddress) -and $_.AddressState -eq 'Preferred' })
    if (-not $LanIp) {
        $candidates = @($addresses | Where-Object { $_.InterfaceAlias -notmatch 'vEthernet|WSL|Virtual|Tailscale|Docker|VPN|Loopback' })
        $candidates = @($candidates | Where-Object { @(Get-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -in @('Private','DomainAuthenticated') }).Count -eq 1 })
        if ($candidates.Count -ne 1) { throw 'Select one real private LAN adapter explicitly using -LanIp.' }
        $LanIp = $candidates[0].IPAddress
    }
    if (-not (Test-LdsmPrivateIp $LanIp)) { throw 'Native client test requires a canonical RFC1918 IPv4, never loopback or public IP.' }
    $adapter = @($addresses | Where-Object { $_.IPAddress -eq $LanIp })
    if ($adapter.Count -ne 1) { throw 'Selected LAN address is not a unique active local interface.' }
    $profile = Get-NetConnectionProfile -InterfaceIndex $adapter[0].InterfaceIndex -ErrorAction Stop
    if ($profile.NetworkCategory -notin @('Private','DomainAuthenticated')) { throw 'Test will not modify the Windows network category.' }
    if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) { throw 'Run-specific firewall rule already exists; refusing reuse.' }
    $beforeMy = @(Get-ChildItem Cert:\LocalMachine\My | ForEach-Object { $_.Thumbprint })
    $beforeRoot = @(Get-ChildItem Cert:\LocalMachine\Root | ForEach-Object { $_.Thumbprint })
    foreach ($name in @('ldsm_frontend','ldsm_backend','ldsm_db','ldsm_backup')) {
        $container = (Invoke-NativeDocker @('inspect', $name) | ConvertFrom-Json)[0]
        $mainBefore[$name] = [pscustomobject]@{ id=$container.Id; image=$container.Image; startedAt=$container.State.StartedAt }
    }
    $frontendImage = $mainBefore.ldsm_frontend.image
    $backendImage = $mainBefore.ldsm_backend.image
    if ($frontendImage -notmatch '^sha256:[a-f0-9]{64}$' -or $backendImage -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Expected immutable existing images.' }
    Assert-LdsmNoReparsePoint $evidence (Join-Path $projectRoot 'output')
    Protect-LdsmHttpsDirectory $evidence
    $evidenceCreated = $true
    foreach ($directory in @($workspace,$release,$bundle,$control)) { Protect-LdsmHttpsDirectory $directory }
    Start-Transcript -LiteralPath (Join-Path $evidence 'transcript.txt') -Force | Out-Null
    $transcriptStarted = $true
    Write-NativeJson (Join-Path $evidence 'scope.json') @{ runId=$RunId; project=$composeProject; firewallRule=$ruleName; lanIp=$LanIp; adapter=$adapter[0].InterfaceAlias; scope='One new native CA, own Root trust and own restricted firewall rule; stateless isolated Docker fixtures. No database access.' }
    Write-NativeJson (Join-Path $evidence 'main-before.json') $mainBefore
    Assert-Native $true 'Explicit administrator token and Windows PowerShell 5.1 verified'
    $httpListener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Parse($LanIp), 0)
    $httpListener.Start()
    $httpPort = ([Net.IPEndPoint]$httpListener.LocalEndpoint).Port
    $httpsListener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Parse($LanIp), 0)
    $httpsListener.Start()
    $httpsPort = ([Net.IPEndPoint]$httpsListener.LocalEndpoint).Port
    Assert-Native ($httpPort -gt 20000 -and $httpsPort -gt 20000 -and $httpPort -ne $httpsPort) 'Fresh high ports reserved on selected private LAN IP, not ports 80/443' @{ http=$httpPort; https=$httpsPort }
    $serverUrl = 'https://' + $LanIp + ':' + $httpsPort
    try { $material = New-LdsmHttpsCertificateMaterial -LanIp $LanIp -OutputDirectory $release }
    catch {
        if ($_.Exception.Data['RootThumbprint']) { $ownRootThumbprint=[string]$_.Exception.Data['RootThumbprint'] }
        if ($_.Exception.Data['RootSha256']) { $ownRootSha256=[string]$_.Exception.Data['RootSha256'] }
        if ($_.Exception.Data['TemporaryLeafThumbprint']) { $ownLeafThumbprints.Add([string]$_.Exception.Data['TemporaryLeafThumbprint']) }
        throw
    }
    $ownRootThumbprint = $material.RootThumbprint
    $ownRootSha256 = $material.RootSha256
    $ownLeafThumbprints.Add($material.LeafThumbprint)
    Copy-Item -LiteralPath $material.RecoveryPath -Destination (Join-Path $evidence 'owned-root.json')
    $root = Get-Item -LiteralPath ('Cert:\LocalMachine\My\' + $ownRootThumbprint)
    try {
        Assert-NativeOwnRoot $root
        $rootSubject = $root.Subject
        $rsa = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($root)
        try {
            Assert-Native ($rsa -is [Security.Cryptography.RSACng] -and $rsa.KeySize -eq 3072 -and $rsa.Key.IsMachineKey -and [int]$rsa.Key.ExportPolicy -eq 0) 'Native RSA3072 machine CA is CNG and non-exportable (policy inspected, private CA never exported)'
            $uniqueName = $rsa.Key.UniqueName
            if ($uniqueName -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Unexpected native key-container identifier.' }
            $rootKeyFile = Join-Path (Join-Path $env:ProgramData 'Microsoft/Crypto/Keys') $uniqueName
            Assert-Native (Test-Path -LiteralPath $rootKeyFile -PathType Leaf) 'Native machine key container exists before exact DeleteKey cleanup'
        } finally { if ($rsa) { $rsa.Dispose() } }
    } finally { $root.Dispose() }
    Assert-Native (-not (Test-Path -LiteralPath ('Cert:\LocalMachine\My\' + $material.LeafThumbprint))) 'Native temporary server certificate and key removed by generator'
    $publicRoot = Get-NativePublicRoot
    try { Assert-Native (-not $publicRoot.HasPrivateKey -and -not (Test-HttpsRootInstalled $publicRoot)) 'Public root export contains no private key and has not installed trust' }
    finally { $publicRoot.Dispose() }
    try { $renewal = New-LdsmHttpsCertificateMaterial -LanIp $LanIp -OutputDirectory (Join-Path $workspace 'renewal') -RootThumbprint $ownRootThumbprint }
    catch {
        if ($_.Exception.Data['TemporaryLeafThumbprint']) { $ownLeafThumbprints.Add([string]$_.Exception.Data['TemporaryLeafThumbprint']) }
        throw
    }
    $ownLeafThumbprints.Add($renewal.LeafThumbprint)
    Assert-Native ($renewal.RootThumbprint -eq $ownRootThumbprint -and $renewal.RootSha256 -eq $ownRootSha256 -and $renewal.LeafThumbprint -ne $material.LeafThumbprint -and -not (Test-Path -LiteralPath ('Cert:\LocalMachine\My\' + $renewal.LeafThumbprint))) 'Native renewal reuses the exact non-exportable CA and cleans its temporary leaf'
    $nginx = Get-LdsmHttpsNginx -LanIp $LanIp -TemplatePath (Join-Path $projectRoot 'frontend/frontend.https.conf')
    [IO.File]::WriteAllText((Join-Path $release 'nginx.conf'), $nginx, (New-Object Text.UTF8Encoding($false)))
    Copy-Item -LiteralPath $material.RootCerPath -Destination (Join-Path $bundle 'rootCA.cer')
    Copy-Item -LiteralPath (Join-Path $httpsRoot 'Confiar-Equipo.ps1') -Destination (Join-Path $bundle 'Confiar-Equipo.ps1')
    $publicRoot = Get-NativePublicRoot
    try { Write-NativeJson (Join-Path $bundle 'conexion.json') @{ schema_version=1; server_url=($serverUrl+'/'); root_sha256=$ownRootSha256; root_thumbprint=$ownRootThumbprint; root_not_after=$publicRoot.NotAfter.ToUniversalTime().ToString('o') } }
    finally { $publicRoot.Dispose() }
    Assert-Native (@(Get-ChildItem -LiteralPath $bundle -File).Count -eq 3) 'Client bundle contains only public root, manifest and actual client script'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'fixtures/native-backend.cjs') -Destination (Join-Path $workspace 'backend.cjs')
    $base = [ordered]@{ services=[ordered]@{
        backend=[ordered]@{ image=$backendImage; entrypoint=@('node','/fixture/backend.cjs'); restart='no'; volumes=@(
            @{type='bind';source=(Join-Path $workspace 'backend.cjs');target='/fixture/backend.cjs';read_only=$true},
            @{type='bind';source=$control;target='/fixture/control';read_only=$true});
            healthcheck=@{test=@('CMD','node','-e',"fetch('http://127.0.0.1:5000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))");interval='1s';timeout='3s';retries=20} }
        frontend=[ordered]@{ image=$frontendImage;restart='no';ports=@(($LanIp+':'+$httpPort+':80'));depends_on=@{backend=@{condition='service_healthy'}} }
    } }
    $override = New-LdsmHttpsOverride -LanIp $LanIp -ReleasePath $release
    $override.services.frontend.ports = @(($LanIp+':'+$httpsPort+':443'))
    $override.services.frontend.healthcheck.interval='1s'
    $override.services.frontend.healthcheck.timeout='3s'
    $override.services.frontend.healthcheck.retries=20
    Write-NativeJson (Join-Path $workspace 'docker-compose.yml') $base
    Write-NativeJson (Join-Path $workspace 'docker-compose.override.yml') $override
    $composeArguments=@('compose','--project-directory',$workspace,'--project-name',$composeProject)
    $rendered = Invoke-NativeDocker ($composeArguments + @('config','--format','json'))
    [IO.File]::WriteAllText((Join-Path $evidence 'compose-rendered.json'), $rendered, (New-Object Text.UTF8Encoding($false)))
    $ruleIntent=$true
    New-NetFirewallRule -Name $ruleName -DisplayName ('Temporary HTTPS native acceptance ' + $RunId) -Direction Inbound -Action Allow -Protocol TCP -LocalPort $httpPort,$httpsPort -LocalAddress $LanIp -RemoteAddress $LanIp -InterfaceAlias $adapter[0].InterfaceAlias -Profile Private,Domain | Out-Null
    $rule = Get-NetFirewallRule -Name $ruleName -ErrorAction Stop
    $ports = $rule | Get-NetFirewallPortFilter
    $addressesFilter = $rule | Get-NetFirewallAddressFilter
    $interfaces = $rule | Get-NetFirewallInterfaceFilter
    Assert-Native ($rule.Direction -eq 'Inbound' -and $rule.Action -eq 'Allow' -and $rule.Enabled -eq 'True' -and [string]$rule.Profile -notmatch 'Public|Any' -and $ports.Protocol -eq 'TCP' -and
        @($ports.LocalPort).Count -eq 2 -and @($ports.LocalPort) -contains [string]$httpPort -and @($ports.LocalPort) -contains [string]$httpsPort -and
        @($addressesFilter.LocalAddress).Count -eq 1 -and $addressesFilter.LocalAddress -eq $LanIp -and @($addressesFilter.RemoteAddress).Count -eq 1 -and $addressesFilter.RemoteAddress -eq $LanIp -and
        $interfaces.InterfaceAlias -eq $adapter[0].InterfaceAlias) 'Actual firewall rule is restricted to test high ports, self-LAN address, exact adapter and trusted profiles'
    Write-NativeJson (Join-Path $evidence 'firewall.json') @{name=$ruleName;localPorts=$ports.LocalPort;localAddress=$addressesFilter.LocalAddress;remoteAddress=$addressesFilter.RemoteAddress;interface=$interfaces.InterfaceAlias;profiles=[string]$rule.Profile}
    $httpListener.Stop(); $httpListener=$null
    $httpsListener.Stop(); $httpsListener=$null
    $dockerStarted=$true
    $startup = Invoke-NativeDocker ($composeArguments + @('up','-d','--pull','never','--wait','--wait-timeout','60'))
    [IO.File]::WriteAllText((Join-Path $evidence 'docker-startup.log'), $startup, (New-Object Text.UTF8Encoding($false)))
    $frontId = (Invoke-NativeDocker ($composeArguments + @('ps','-q','frontend'))).Trim()
    $front = (Invoke-NativeDocker @('inspect',$frontId) | ConvertFrom-Json)[0]
    foreach ($bindingName in @('80/tcp','443/tcp')) { foreach ($binding in $front.NetworkSettings.Ports.$bindingName) { Assert-Native ($binding.HostIp -eq $LanIp -and [int]$binding.HostPort -gt 20000) ('Actual Docker binding remains isolated: '+$bindingName) } }
    Initialize-HttpsClientProbe
    [PuroCole.HttpsClientProbe]::Verify($LanIp,$httpsPort,[IO.File]::ReadAllBytes($material.RootCerPath))
    Assert-Native $true 'Actual native certificate and exported CNG leaf key serve valid pinned TLS through real Nginx'
    $beforeTrust = Test-NativeFreshWindowsTrust 'windows-untrusted-before'
    Assert-Native ($beforeTrust.ExitCode -eq 17 -and $beforeTrust.Output -match 'AuthenticationException|SecurityException|trust relationship|certificate|certificado') 'Fresh normal Windows HTTPS fails before installing the test root' $beforeTrust.Output
    $wrongFingerprint = if ($ownRootSha256 -ne ('0'*64)) { '0'*64 } else { '1'*64 }
    $rejected = Invoke-NativeClient 'client-wrong-fingerprint' $wrongFingerprint
    $publicRoot=Get-NativePublicRoot
    try { Assert-Native ($rejected.ExitCode -ne 0 -and -not (Test-HttpsRootInstalled $publicRoot)) 'Actual client rejects an incorrect independently supplied fingerprint without adding trust' }
    finally { $publicRoot.Dispose() }
    [IO.File]::WriteAllText((Join-Path $control 'fail-ready'), 'test readiness failure')
    $rollback = Invoke-NativeClient 'client-health-rollback' $ownRootSha256
    $publicRoot=Get-NativePublicRoot
    try { Assert-Native ($rollback.ExitCode -ne 0 -and $rollback.Output -match 'Se retiro solamente' -and -not (Test-HttpsRootInstalled $publicRoot)) 'Actual client adds trust then removes only its own root when real backend readiness fails' }
    finally { $publicRoot.Dispose() }
    Remove-Item -LiteralPath (Join-Path $control 'fail-ready') -Force
    $installed = Invoke-NativeClient 'client-installed' $ownRootSha256
    $publicRoot=Get-NativePublicRoot
    try { Assert-Native ($installed.ExitCode -eq 0 -and (Test-HttpsRootInstalled $publicRoot)) 'Actual shipped client installs the exact root and validates real HTTPS readiness' }
    finally { $publicRoot.Dispose() }
    $trusted = Test-NativeFreshWindowsTrust 'windows-trusted'
    Assert-Native ($trusted.ExitCode -eq 0 -and $trusted.Output -match 'WINDOWS_TRUST_OK') 'Fresh normal Windows HTTPS succeeds with machine trust, without explicit CA or certificate bypass'
    $again = Invoke-NativeClient 'client-idempotent' $ownRootSha256
    Assert-Native ($again.ExitCode -eq 0 -and @(Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq $ownRootThumbprint }).Count -eq 1) 'Actual client reinstall is idempotent and does not duplicate the root'
    [IO.File]::WriteAllText((Join-Path $control 'fail-ready'), 'test readiness failure with preexisting trust')
    $preexistingFailure = Invoke-NativeClient 'client-preserves-preexisting-trust' $ownRootSha256
    $publicRoot=Get-NativePublicRoot
    try { Assert-Native ($preexistingFailure.ExitCode -ne 0 -and (Test-HttpsRootInstalled $publicRoot)) 'Failed later client attempt preserves trust that predated that attempt' }
    finally { $publicRoot.Dispose() }
    Remove-Item -LiteralPath (Join-Path $control 'fail-ready') -Force
    Remove-NativeOwnTrust
    [PuroCole.HttpsClientProbe]::Verify($LanIp,$httpsPort,[IO.File]::ReadAllBytes($material.RootCerPath))
    $afterTrust = Test-NativeFreshWindowsTrust 'windows-untrusted-after'
    Assert-Native ($afterTrust.ExitCode -eq 17 -and $afterTrust.Output -match 'AuthenticationException|SecurityException|trust relationship|certificate|certificado') 'Fresh normal Windows HTTPS fails again after removing test trust while pinned TLS still succeeds' $afterTrust.Output
}
catch { $failure=$_; Write-Warning $_.Exception.Message }
finally {
    if ($httpListener) { $httpListener.Stop() }
    if ($httpsListener) { $httpsListener.Stop() }
    # Every cleanup item is independent so one failed cleanup does not skip others.
    try { Remove-NativeOwnTrust } catch { $cleanupErrors.Add('Root trust: '+$_.Exception.Message) }
    if ($ruleIntent) {
        try {
            if ($ruleName -cne ('LDSM-HTTPS-NATIVE-TEST-'+$RunId)) { throw 'Unsafe firewall cleanup identifier.' }
            Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction Stop
            Assert-Native (-not (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue)) 'Only the run-specific firewall rule is removed'
        } catch { $cleanupErrors.Add('Firewall: '+$_.Exception.Message) }
    }
    if ($dockerStarted) {
        try {
            if ($composeProject -cne ('ldsm_https_native_'+$RunId) -or [IO.Path]::GetFullPath($workspace) -ne [IO.Path]::GetFullPath((Join-Path $evidence 'workspace'))) { throw 'Unsafe Docker cleanup target.' }
            $cleanup = Invoke-NativeDocker @('compose','--project-directory',$workspace,'--project-name',$composeProject,'down','--remove-orphans','--timeout','5')
            [IO.File]::WriteAllText((Join-Path $evidence 'docker-cleanup.log'), $cleanup, (New-Object Text.UTF8Encoding($false)))
            $remaining = Invoke-NativeDocker @('ps','-aq','--filter',('label=com.docker.compose.project='+$composeProject))
            Assert-Native ([string]::IsNullOrWhiteSpace($remaining)) 'All run-owned Docker containers are removed'
        } catch { $cleanupErrors.Add('Docker: '+$_.Exception.Message) }
    }
    if ($ownRootThumbprint) {
        try {
            $rootPath='Cert:\LocalMachine\My\'+$ownRootThumbprint
            if (Test-Path -LiteralPath $rootPath) {
                $root=Get-Item -LiteralPath $rootPath
                try { Assert-NativeOwnRoot $root; $rootSubject=$root.Subject } finally { $root.Dispose() }
            }
            foreach ($thumbprint in $ownLeafThumbprints) {
                $leafPath='Cert:\LocalMachine\My\'+$thumbprint
                if (Test-Path -LiteralPath $leafPath) {
                    $leaf=Get-Item -LiteralPath $leafPath
                    try {
                        if ($beforeMy -contains $thumbprint -or $thumbprint -eq $ownRootThumbprint -or $leaf.Subject -ne ('CN='+$LanIp) -or $leaf.Issuer -ne $rootSubject) { throw 'Refusing unproven temporary leaf cleanup.' }
                    } finally { $leaf.Dispose() }
                    Remove-Item -LiteralPath $leafPath -DeleteKey -Force -ErrorAction Stop
                }
                Assert-Native (-not (Test-Path -LiteralPath $leafPath)) 'Run-owned temporary leaf is absent from LocalMachine My' $thumbprint
            }
            if (Test-Path -LiteralPath $rootPath) { Remove-Item -LiteralPath $rootPath -DeleteKey -Force -ErrorAction Stop }
            Assert-Native (-not (Test-Path -LiteralPath $rootPath)) 'Only the fresh test CA is removed from LocalMachine My with DeleteKey'
            if ($rootKeyFile) { Assert-Native (-not (Test-Path -LiteralPath $rootKeyFile)) 'Native non-exportable CA key container is removed by DeleteKey' }
        } catch { $cleanupErrors.Add('Native keys: '+$_.Exception.Message) }
    }
    foreach ($name in @($mainBefore.Keys)) {
        try {
            $after=(Invoke-NativeDocker @('inspect',$name) | ConvertFrom-Json)[0]
            Assert-Native ($after.Id -eq $mainBefore[$name].id -and $after.Image -eq $mainBefore[$name].image -and $after.State.StartedAt -eq $mainBefore[$name].startedAt) ('Main service was neither replaced nor restarted: '+$name)
        } catch { $cleanupErrors.Add('Main container check: '+$_.Exception.Message) }
    }
    if ($evidenceCreated -and (Test-Path -LiteralPath $workspace) -and $cleanupErrors.Count -eq 0) {
        try {
            $resolvedWorkspace=[IO.Path]::GetFullPath($workspace)
            $expectedEvidence=[IO.Path]::GetFullPath((Join-Path $projectRoot ('output/https/native-'+$RunId))).TrimEnd('\')
            if ($resolvedWorkspace -ne ($expectedEvidence+'\workspace')) { throw 'Unsafe private workspace cleanup target.' }
            Assert-LdsmNoReparsePoint $resolvedWorkspace $expectedEvidence
            Remove-Item -LiteralPath $resolvedWorkspace -Recurse -Force -ErrorAction Stop
            Assert-Native (-not (Test-Path -LiteralPath $resolvedWorkspace)) 'Private PEM keys, client staging and fixture workspace removed'
        } catch { $cleanupErrors.Add('Private workspace: '+$_.Exception.Message) }
    }
    if ($evidenceCreated -and (Test-Path -LiteralPath $evidence)) {
        Write-NativeJson (Join-Path $evidence 'results.json') ([ordered]@{
            runId=$RunId; startedAt=$started.ToString('o'); completedAt=(Get-Date).ToString('o'); powerShell=$PSVersionTable.PSVersion.ToString()
            passed=($null -eq $failure -and $cleanupErrors.Count -eq 0); cleanupComplete=($cleanupErrors.Count -eq 0)
            failure=$(if($failure){$failure.Exception.Message}else{$null}); cleanupErrors=$cleanupErrors.ToArray(); checks=$checks.ToArray()
            project=$composeProject; httpPort=$httpPort; httpsPort=$httpsPort; rootThumbprint=$ownRootThumbprint; rootSha256=$ownRootSha256
            scope='Actual Windows native CNG CA+leaf generation/reuse, actual shipped trusted-root client and rollback, actual restricted firewall rule lifecycle, isolated real Nginx + stateless backend. No school app/database login or writes. Local tests do not establish remote LAN firewall reachability.'
        })
    }
    if ($transcriptStarted) { Stop-Transcript | Out-Null }
}
Write-Host "Evidence: $evidence"
if ($failure) { throw $failure }
if ($cleanupErrors.Count) { throw ('Cleanup incomplete: '+($cleanupErrors -join '; ')) }
Write-Host "$($checks.Count) native Windows integration checks passed; run-owned host changes cleaned up."
