#requires -Version 5.1
<#
Run only with explicit user consent and elevation. Creates a disposable FOUR
service installation with its own database/volumes and high LAN ports. Runs
the actual installer entry point, not mocks. Always removes its own temporary
trust, firewall rule, CA key and containers. Never operates the main project.
#>
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$LanIp, [Parameter(Mandatory=$true)][string]$EvidencePath)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
$repo=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
Import-Module (Join-Path $repo 'scripts/https/Server.psm1') -Force
. (Join-Path $repo 'scripts/https/Confiar-Equipo.ps1')
if (-not (Test-HttpsClientAdministrator)) { throw 'Esta prueba REAL requiere autorizacion y PowerShell elevado.' }
if (-not (Test-LdsmPrivateIp $LanIp)) { throw 'Se requiere la IP LAN real.' }
$evidence=[IO.Path]::GetFullPath($EvidencePath)
$evidenceRoot=[IO.Path]::GetFullPath((Join-Path $repo 'output/https')).TrimEnd('\')+'\'
if (-not $evidence.StartsWith($evidenceRoot,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $evidence) -notmatch '^full-native-[a-f0-9]{12}$') { throw 'Ruta de evidencia no autorizada.' }
if ([IO.Path]::GetDirectoryName($evidence).TrimEnd('\') -ne $evidenceRoot.TrimEnd('\')) { throw 'La evidencia debe estar directamente dentro de output/https.' }
if (Test-Path -LiteralPath $evidence) { throw 'Usa una carpeta de evidencia NUEVA; no se reutilizara ni sobrescribira una prueba anterior.' }
Assert-LdsmNoReparsePoint $evidence (Join-Path $repo 'output')
# Exclusive creation establishes ownership before changing ACLs or writing files.
New-Item -ItemType Directory -Path $evidence -ErrorAction Stop | Out-Null
Protect-LdsmHttpsDirectory $evidence
$workspace=Join-Path $evidence 'workspace'
Protect-LdsmHttpsDirectory $workspace
$suffix=(Split-Path -Leaf $evidence).Substring(12)
$projectName='ldsm_https_full_'+$suffix
$checks=New-Object 'Collections.Generic.List[object]'
$failure=$null
$cleanupFailure=$null
$cleanupErrors=New-Object 'Collections.Generic.List[string]'
$dockerStarted=$false
$ruleName=$null
$rootThumb=$null
$password=$null
$rootBefore=@(Get-ChildItem Cert:\LocalMachine\Root | ForEach-Object {$_.Thumbprint})
$myBefore=@(Get-ChildItem Cert:\LocalMachine\My | ForEach-Object {$_.Thumbprint})
$mainBefore=@{}
$httpListener=$null
$httpsListener=$null
$expectedRule=$null
$ruleExistedBefore=$false
$rootSha256=$null
Start-Transcript -Path (Join-Path $evidence 'run.log') -Force | Out-Null
function Assert-Real([bool]$Condition,[string]$Name) {
    $checks.Add([pscustomobject]@{passed=$Condition;name=$Name})
    if (-not $Condition) { throw $Name }
    Write-Host "PASS $Name"
}
function New-TestPassword {
    $bytes=New-Object byte[] 32
    $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
    try {$rng.GetBytes($bytes)} finally {$rng.Dispose()}
    return 'Qa!'+([BitConverter]::ToString($bytes)).Replace('-','')+'a9'
}
function Run-Installer(
    [string[]]$Options,
    [string]$LogName,
    [string]$ScriptPath=(Join-Path $repo 'scripts/instalar-https-colegio.ps1'),
    [switch]$Standalone,
    [string]$StandardInputText='INSTALAR',
    [string]$WorkingDirectory=''
) {
    $start=New-Object Diagnostics.ProcessStartInfo
    $start.FileName=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',$ScriptPath)
    if (-not $Standalone) {$arguments+=@('-ProjectRoot',$workspace)}
    $arguments+=$Options
    $start.Arguments=(@($arguments | ForEach-Object {'"'+$_.Replace('"','\"')+'"'}) -join ' ')
    $start.UseShellExecute=$false
    $start.CreateNoWindow=$true
    $start.RedirectStandardInput=$true
    $start.RedirectStandardOutput=$true
    $start.RedirectStandardError=$true
    if ($WorkingDirectory) {$start.WorkingDirectory=$WorkingDirectory}
    $process=New-Object Diagnostics.Process
    $process.StartInfo=$start
    $processStarted=$false
    $timer=[Diagnostics.Stopwatch]::StartNew()
    $outTask=$null
    $errTask=$null
    try {
        [void]$process.Start()
        $processStarted=$true
        $outTask=$process.StandardOutput.ReadToEndAsync()
        $errTask=$process.StandardError.ReadToEndAsync()
        try { $process.StandardInput.WriteLine($StandardInputText) }
        finally { $process.StandardInput.Close() }
        # Do not kill an installer that may have Docker children still mutating
        # the test project. Its native operations have their own time limits.
        while (-not $process.WaitForExit(30000)) {
            Write-Host ("Instalador real sigue en curso: {0} ({1}s). Se espera su finalizacion antes de limpiar." -f $LogName,[int]$timer.Elapsed.TotalSeconds)
        }
        $code=$process.ExitCode
    } finally {
        if ($processStarted) {
            # Also cover an unexpected stdin/logging failure: never let finally
            # delete a project while its actual installer process is running.
            while (-not $process.WaitForExit(30000)) {
                Write-Host ("Esperando cierre seguro del instalador {0} antes de continuar ({1}s)." -f $LogName,[int]$timer.Elapsed.TotalSeconds)
            }
            if ($null -ne $outTask -and $null -ne $errTask) {
                [IO.File]::WriteAllText((Join-Path $evidence $LogName),($outTask.Result+"`n"+$errTask.Result),[Text.UTF8Encoding]::new($false))
            }
        }
        $timer.Stop()
        $process.Dispose()
    }
    if ($code -ne 0) { throw "El script Windows real fallo. Ver $LogName (codigo $code)." }
}
function Read-TestPublicLeaf([string]$Path) {
    $pem=[IO.File]::ReadAllText($Path)
    $base64=($pem.Replace('-----BEGIN CERTIFICATE-----','').Replace('-----END CERTIFICATE-----','') -replace '\s','')
    return New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList @(,[Convert]::FromBase64String($base64))
}
try {
    # Installer/client/status run in child processes: their Add-Type calls do
    # not initialize the parent that performs the final direct TLS probe.
    Initialize-HttpsClientProbe
    Assert-Real ($null -ne ('PuroCole.HttpsClientProbe' -as [type])) 'Parent process initializes the real TLS identity probe before native mutations'
    $sha=[Security.Cryptography.SHA256]::Create()
    try {$expectedRule='LDSM-HTTPS-'+([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($workspace.ToLowerInvariant())))).Replace('-','').Substring(0,16)}finally{$sha.Dispose()}
    $ruleExistedBefore=[bool](Get-NetFirewallRule -Name $expectedRule -ErrorAction SilentlyContinue)
    if ($ruleExistedBefore) { throw 'Ya existia una regla para esta ruta; no se reutilizara ni eliminara.' }
    foreach ($name in @('ldsm_frontend','ldsm_backend','ldsm_db','ldsm_backup')) {
        $existing=(Invoke-LdsmDocker @('inspect',$name) | ConvertFrom-Json)[0]
        $mainBefore[$name]=[pscustomobject]@{Id=$existing.Id;Image=$existing.Image;StartedAt=$existing.State.StartedAt}
    }
    Write-LdsmPrivateJson (Join-Path $evidence 'main-before.json') $mainBefore
    $frontImage=(Invoke-LdsmDocker @('inspect','--format','{{.Image}}','ldsm_frontend')).Trim()
    $backImage=(Invoke-LdsmDocker @('inspect','--format','{{.Image}}','ldsm_backend')).Trim()
    $pgImage=(Invoke-LdsmDocker @('inspect','--format','{{.Image}}','ldsm_db')).Trim()
    foreach ($folder in @('backend','frontend','backups')) {[IO.Directory]::CreateDirectory((Join-Path $workspace $folder))|Out-Null}
    Copy-Item -LiteralPath (Join-Path $repo 'backend/backup.sh') -Destination (Join-Path $workspace 'backend/backup.sh')
    Copy-Item -LiteralPath (Join-Path $repo 'frontend/frontend.https.conf') -Destination (Join-Path $workspace 'frontend/frontend.https.conf')
    [IO.Directory]::CreateDirectory((Join-Path $workspace 'scripts/https')) | Out-Null
    foreach ($relative in @('scripts/estado.ps1','scripts/https/Server.psm1','scripts/https/Confiar-Equipo.ps1')) {
        $source=Join-Path $repo $relative
        $copy=Join-Path $workspace $relative
        Copy-Item -LiteralPath $source -Destination $copy
        Assert-Real ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash) ("Unmodified shipped status dependency copied into isolated workspace: $relative")
    }
    $httpListener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse($LanIp),0);$httpListener.Start()
    $httpPort=([Net.IPEndPoint]$httpListener.LocalEndpoint).Port
    $httpsListener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse($LanIp),0);$httpsListener.Start()
    $httpsPort=([Net.IPEndPoint]$httpsListener.LocalEndpoint).Port
    Assert-Real ($httpPort -gt 20000 -and $httpsPort -gt 20000 -and $httpPort -ne $httpsPort) 'Isolated high ports; no replacement of ports 80/443'
    $password=New-TestPassword
    $envText=@('DB_USER=https_qa','DB_NAME=https_qa',('DB_PASSWORD='+(New-TestPassword)),('JWT_SECRET='+(New-TestPassword)),('DEFAULT_USER_PASSWORD='+$password),'NODE_ENV=production','COOKIE_SECURE=false',"CORS_ORIGIN=http://${LanIp}:$httpPort",'BACKUP_RETENTION_DAYS=30') -join "`n"
    [IO.File]::WriteAllText((Join-Path $workspace '.env'),$envText,[Text.UTF8Encoding]::new($false))
    # --project-directory resolves .env and mounts exclusively inside the disposable tree.
    $configText=Invoke-LdsmDocker @('compose','--project-directory',$workspace,'-p',$projectName,'--env-file',(Join-Path $workspace '.env'),'-f',(Join-Path $repo 'docker-compose.yml'),'config','--format','json')
    $config=$configText | ConvertFrom-Json
    foreach ($svc in @('postgres','backend','frontend','backup')) {
        $config.services.$svc.PSObject.Properties.Remove('container_name')
        $config.services.$svc.PSObject.Properties.Remove('build')
        $config.services.$svc.restart='no'
        $config.services.$svc.healthcheck.interval='2s'
        $config.services.$svc.healthcheck.timeout='5s'
        $config.services.$svc.healthcheck.retries=45
    }
    $config.services.backend | Add-Member -NotePropertyName image -NotePropertyValue $backImage -Force
    $config.services.frontend | Add-Member -NotePropertyName image -NotePropertyValue $frontImage -Force
    $config.services.postgres.image=$pgImage
    $config.services.backup.image=$pgImage
    $config.services.frontend.ports=@(@{target=80;published=[string]$httpPort;host_ip=$LanIp;protocol='tcp'})
    Write-LdsmPrivateJson (Join-Path $workspace 'docker-compose.yml') $config
    $httpListener.Stop();$httpListener=$null
    $httpsListener.Stop();$httpsListener=$null
    $dockerStarted=$true
    Invoke-LdsmDocker @('compose','--project-directory',$workspace,'-p',$projectName,'up','-d','--no-build','--pull','never','--wait','--wait-timeout','120') | Out-Null
    Assert-Real $true 'Four real services started with a NEW disposable database and separate uploads/backups'
    $beforeDb=(Invoke-LdsmDocker @('compose','--project-directory',$workspace,'-p',$projectName,'ps','-q','postgres')).Trim()
    $beforeBackup=(Invoke-LdsmDocker @('compose','--project-directory',$workspace,'-p',$projectName,'ps','-q','backup')).Trim()
    Run-Installer @('-Diagnostico','-LanIp',$LanIp,'-HttpPort',[string]$httpPort,'-HttpsPort',[string]$httpsPort) '01-diagnosis.log'
    Assert-Real (-not (Test-Path -LiteralPath (Join-Path $workspace '.https-lan'))) 'Actual diagnosis leaves installation unchanged'
    Run-Installer @('-Aplicar','-ConfirmarIpFija','-LanIp',$LanIp,'-HttpPort',[string]$httpPort,'-HttpsPort',[string]$httpsPort) '02-install.log'
    $state=Get-Content -LiteralPath (Join-Path $workspace '.https-lan/estado.json') -Raw | ConvertFrom-Json
    $journal=Get-Content -LiteralPath (Join-Path $workspace '.https-lan/transaccion.json') -Raw | ConvertFrom-Json
    $rootThumb=$state.root_thumbprint
    $rootSha256=$state.root_sha256
    $ruleName=$journal.firewall_rule
    Assert-Real ($journal.status -eq 'complete' -and $rootThumb -notin $rootBefore -and $rootThumb -notin $myBefore) 'Actual installer completed with a newly created native CA'
    $nativeCa=Get-Item -LiteralPath "Cert:\LocalMachine\My\$rootThumb"
    $key=[Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($nativeCa)
    try {
        Assert-Real ($key -is [Security.Cryptography.RSACng] -and $key.Key.ExportPolicy -eq [Security.Cryptography.CngExportPolicies]::None) 'Actual CA uses native CNG with non-exportable private key'
    } finally {$key.Dispose()}
    Assert-Real (Test-HttpsRootInstalled $nativeCa) 'Actual server trust installed in LocalMachine Root'
    $rule=Get-NetFirewallRule -Name $ruleName
    $addresses=$rule | Get-NetFirewallAddressFilter
    $ports=$rule | Get-NetFirewallPortFilter
    Assert-Real ($rule.Enabled -eq 'True' -and $addresses.RemoteAddress -contains 'LocalSubnet' -and $ports.LocalPort -contains [string]$httpsPort) 'Actual Windows firewall rule is enabled and limited to selected local ports/subnet'
    $url=(Get-LdsmHttpsOrigin $LanIp $httpsPort)+'/'
    Test-HttpsServerHealth ([uri]$url)
    Assert-Real $true 'Normal Windows certificate validation and real backend readiness succeed'
    Run-Installer -Options @() -LogName '02b-shipped-status.log' -ScriptPath (Join-Path $workspace 'scripts/estado.ps1') -Standalone
    Assert-Real $true 'Exact shipped estado.ps1 validates the real isolated installation using persisted HTTP/HTTPS high ports'
    $currentDb=(Invoke-LdsmDocker @('compose','--project-directory',$workspace,'-p',$projectName,'ps','-q','postgres')).Trim()
    $currentBackup=(Invoke-LdsmDocker @('compose','--project-directory',$workspace,'-p',$projectName,'ps','-q','backup')).Trim()
    Assert-Real ($currentDb -eq $beforeDb -and $currentBackup -eq $beforeBackup) 'Installer did not recreate database or backup services'
    Assert-Real (Test-Path -LiteralPath (Join-Path $workspace 'backups/last-success.env')) 'Actual pre-install backup succeeded'
    $bundle=Join-Path $state.release_path 'equipos'
    # Reproduce a new Windows client on this host: remove ONLY our new root,
    # then execute the shipped client script in a separate PowerShell process.
    Remove-HttpsAddedRoot $nativeCa
    $beforeClient= & curl.exe --silent --noproxy '*' --ssl-revoke-best-effort --max-time 8 --output NUL --write-out '%{http_code}' $url
    Assert-Real ($LASTEXITCODE -ne 0 -and $beforeClient -eq '000') 'Windows rejects the actual HTTPS installation before public-root enrollment'
    # Match the operator guide: no BundlePath or ExpectedRootSha256 parameters.
    # Fingerprint comes from the server's already-verified state, not the ZIP;
    # an unrelated cwd proves bundle discovery uses the script's own location.
    Run-Installer -Options @() -LogName '03-client.log' -ScriptPath (Join-Path $bundle 'Confiar-Equipo.ps1') -Standalone -StandardInputText $state.root_sha256 -WorkingDirectory (Join-Path $env:SystemRoot 'System32')
    Assert-Real (Test-HttpsRootInstalled $nativeCa) 'Shipped client discovers its bundle from System32 cwd and accepts independently supplied fingerprint through actual Read-Host enrollment'
    $browserScript=Join-Path $PSScriptRoot 'fixtures/probe-native-browser.cjs'
    $previousPassword=$env:LDSM_HTTPS_QA_PASSWORD
    try {
        $env:LDSM_HTTPS_QA_PASSWORD=$password
        & node $browserScript $repo $url (Join-Path $evidence 'browser') *> (Join-Path $evidence '04-browser.log')
        Assert-Real ($LASTEXITCODE -eq 0) 'Actual browser trusts Windows CA and completes login over HTTPS without certificate bypass'
    } finally {$env:LDSM_HTTPS_QA_PASSWORD=$previousPassword}
    Run-Installer @('-Aplicar','-ConfirmarIpFija','-LanIp',$LanIp) '05-repeat.log'
    $repeat=Get-Content -LiteralPath (Join-Path $workspace '.https-lan/estado.json') -Raw | ConvertFrom-Json
    Assert-Real ($repeat.root_thumbprint -eq $rootThumb -and $repeat.release_path -eq $state.release_path) 'Re-running actual installer is idempotent'
    # Replay an interrupted transaction intentionally; recovery itself is real.
    $journal.status='pending'
    Write-LdsmPrivateJson (Join-Path $workspace '.https-lan/transaccion.json') $journal
    Run-Installer @('-Restaurar') '06-restore.log'
    $restored=Get-Content -LiteralPath (Join-Path $workspace '.https-lan/transaccion.json') -Raw | ConvertFrom-Json
    Assert-Real ($restored.status -eq 'restored' -and -not (Test-HttpsRootInstalled $nativeCa) -and -not (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue)) 'Actual recovery removes only created root/firewall and restores previous web services'
    $status= & curl.exe --silent --noproxy '*' --max-time 10 --output NUL --write-out '%{http_code}' "http://${LanIp}:$httpPort/api/health/ready"
    Assert-Real ($LASTEXITCODE -eq 0 -and $status -eq '200') 'Previous HTTP application is operational after real recovery'
    Run-Installer @('-Aplicar','-ConfirmarIpFija','-LanIp',$LanIp,'-HttpPort',[string]$httpPort,'-HttpsPort',[string]$httpsPort) '07-retry.log'
    $retried=Get-Content -LiteralPath (Join-Path $workspace '.https-lan/estado.json') -Raw | ConvertFrom-Json
    Assert-Real ($retried.root_thumbprint -eq $rootThumb) 'Actual retry reuses existing CA identity instead of rotating trust'
    $oldLeafPath=Join-Path $retried.release_path 'ldsm-lan.pem'
    $oldLeaf=Read-TestPublicLeaf $oldLeafPath
    try {$oldLeafThumbprint=$oldLeaf.Thumbprint;$oldLeafNotAfter=$oldLeaf.NotAfter.ToUniversalTime().ToString('o')}
    finally {$oldLeaf.Dispose()}
    $oldLeafHash=(Get-FileHash -LiteralPath $oldLeafPath -Algorithm SHA256).Hash
    $renewalStatePath=Join-Path $workspace '.https-lan/estado.json'
    $renewalTrigger=Get-Content -LiteralPath $renewalStatePath -Raw | ConvertFrom-Json
    $renewalTrigger.leaf_not_after=[DateTime]::UtcNow.AddDays(10).ToString('o')
    foreach ($property in $retried.PSObject.Properties) {
        if ($property.Name -ne 'leaf_not_after') {
            Assert-Real ((ConvertTo-Json -InputObject $property.Value -Compress) -ceq (ConvertTo-Json -InputObject $renewalTrigger.($property.Name) -Compress)) ("Renewal trigger preserves state field: $($property.Name)")
        }
    }
    Write-LdsmPrivateJson $renewalStatePath $renewalTrigger
    Assert-Real ((Get-FileHash -LiteralPath $oldLeafPath -Algorithm SHA256).Hash -eq $oldLeafHash) 'Simulated renewal trigger changes only disposable state metadata, not certificate bytes or system clock'
    Write-LdsmPrivateJson (Join-Path $evidence 'renewal-trigger.json') @{scope='Simulated scheduling trigger only: leaf_not_after metadata changed to UTC now + 10 days in disposable state. Actual -Renovar operation, native certificate issuance, Docker switch and HTTPS validation are real. System clock and existing certificates are unchanged.';originalMetadata=$retried.leaf_not_after;simulatedMetadata=$renewalTrigger.leaf_not_after;actualOriginalCertificateExpiry=$oldLeafNotAfter;oldLeafThumbprint=$oldLeafThumbprint}
    Run-Installer @('-Renovar') '08-renew-real.log'
    $renewed=Get-Content -LiteralPath $renewalStatePath -Raw | ConvertFrom-Json
    $renewalJournal=Get-Content -LiteralPath (Join-Path $workspace '.https-lan/transaccion.json') -Raw | ConvertFrom-Json
    Assert-Real ($renewed.root_thumbprint -eq $rootThumb -and $renewed.root_sha256 -eq $rootSha256 -and $renewed.release_path -ne $retried.release_path) 'Real renewal keeps the same CA identity and activates a newly generated release'
    $newLeaf=Read-TestPublicLeaf (Join-Path $renewed.release_path 'ldsm-lan.pem')
    try {
        Assert-Real ($newLeaf.Thumbprint -ne $oldLeafThumbprint -and $newLeaf.NotAfter.ToUniversalTime() -gt [DateTime]::UtcNow.AddDays(360)) 'Real renewal issues a distinct native server certificate with a fresh one-year validity'
        Write-LdsmPrivateJson (Join-Path $evidence 'renewal-result.json') @{oldLeafThumbprint=$oldLeafThumbprint;newLeafThumbprint=$newLeaf.Thumbprint;rootThumbprint=$renewed.root_thumbprint;oldRelease=$retried.release_path;newRelease=$renewed.release_path;newNotAfter=$newLeaf.NotAfter.ToUniversalTime().ToString('o');trigger='Simulated state metadata; actual native renewal executed'}
    } finally {$newLeaf.Dispose()}
    Assert-Real ($renewalJournal.status -eq 'complete' -and -not $renewalJournal.root_added -and -not $renewalJournal.firewall_created -and (Test-HttpsRootInstalled $nativeCa)) 'Real renewal preserves existing trusted root and firewall rule without reinstalling either'
    Test-LdsmServerHttps $LanIp (Join-Path $renewed.release_path 'rootCA.cer') (Join-Path $renewed.release_path 'rootCA.pem') $httpsPort $httpPort
    Test-HttpsServerHealth ([uri]$url)
    Assert-Real $true 'Renewed leaf serves verified HTTPS and real application readiness using existing Windows trust'
    Run-Installer -Options @() -LogName '09-shipped-status-renewed.log' -ScriptPath (Join-Path $workspace 'scripts/estado.ps1') -Standalone
    Assert-Real $true 'Exact shipped estado.ps1 also validates the renewed installation and persisted ports'
    $renewedDb=(Invoke-LdsmDocker @('compose','--project-directory',$workspace,'-p',$projectName,'ps','-q','postgres')).Trim()
    $renewedBackup=(Invoke-LdsmDocker @('compose','--project-directory',$workspace,'-p',$projectName,'ps','-q','backup')).Trim()
    Assert-Real ($renewedDb -eq $beforeDb -and $renewedBackup -eq $beforeBackup) 'Real renewal does not recreate the isolated database or backup service'
} catch {
    $failure=$_.Exception.Message
    Write-Host "FAILED: $failure" -ForegroundColor Red
} finally {
    # Independent cleanup phases: a failed journal read or firewall removal
    # must not prevent stopping the disposable services or checking main ones.
    try { if ($httpListener) {$httpListener.Stop()}; if ($httpsListener) {$httpsListener.Stop()} }
    catch {$cleanupErrors.Add('Listeners: '+$_.Exception.Message)}
    try {
        $journalPath=Join-Path $workspace '.https-lan/transaccion.json'
        if (Test-Path -LiteralPath $journalPath) {
            $journal=Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json
            $ruleName=$journal.firewall_rule
            if ($ruleName -ne $expectedRule) { throw 'Refusing an unexpected firewall rule from the journal.' }
        }
    } catch {$cleanupErrors.Add('Journal: '+$_.Exception.Message)}
    try {
        $authorityPath=Join-Path $workspace '.https-lan/autoridad.json'
        if (Test-Path -LiteralPath $authorityPath) {
            $authority=Get-Content -LiteralPath $authorityPath -Raw | ConvertFrom-Json
            $rootThumb=$authority.RootThumbprint
            $rootSha256=$authority.RootSha256
        }
        if (-not $rootThumb) {
            $recovery=@(Get-ChildItem -LiteralPath $workspace -Filter ca-recovery.json -Recurse -File -ErrorAction SilentlyContinue)
            if ($recovery.Count -eq 1) {
                $authority=Get-Content -LiteralPath $recovery[0].FullName -Raw | ConvertFrom-Json
                $rootThumb=$authority.RootThumbprint
                $rootSha256=$authority.RootSha256
            } elseif ($recovery.Count -gt 1) { throw 'Multiple recovery records require inspection; no CA will be guessed.' }
        }
        if ($rootThumb) { Write-LdsmPrivateJson (Join-Path $evidence 'owned-root.json') @{RootThumbprint=$rootThumb;RootSha256=$rootSha256} }
    } catch {$cleanupErrors.Add('CA recovery identity: '+$_.Exception.Message)}
    # Run-Installer has fully joined its process before reaching this block.
    # Stop its application/Docker project before removing any CA or key files.
    try {
        if ($dockerStarted) {
            if ($projectName -cne ('ldsm_https_full_'+$suffix) -or $projectName -notmatch '^ldsm_https_full_[a-f0-9]{12}$') {throw 'Unexpected disposable project.'}
            Assert-LdsmNoReparsePoint $workspace $evidence
            Invoke-LdsmDocker @('compose','--project-directory',$workspace,'-p',$projectName,'down','--volumes','--remove-orphans','--timeout','5')|Out-Null
            Assert-Real ([string]::IsNullOrWhiteSpace((Invoke-LdsmDocker @('ps','-aq','--filter',"label=com.docker.compose.project=$projectName")))) 'Disposable test containers removed'
            Assert-Real ([string]::IsNullOrWhiteSpace((Invoke-LdsmDocker @('volume','ls','-q','--filter',"label=com.docker.compose.project=$projectName")))) 'Disposable test project volumes removed'
        }
    } catch {$cleanupErrors.Add('Docker: '+$_.Exception.Message)}
    try {
        # Derive the only permitted name from the fresh owned directory. This
        # remains recoverable even if writing/reading the journal failed.
        if ($expectedRule -and -not $ruleExistedBefore) {
            Get-NetFirewallRule -Name $expectedRule -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction Stop
            Assert-Real (-not (Get-NetFirewallRule -Name $expectedRule -ErrorAction SilentlyContinue)) 'Only the disposable installation firewall rule removed'
        }
    } catch {$cleanupErrors.Add('Firewall: '+$_.Exception.Message)}
    try {
        if ($rootThumb) {
            if ($rootThumb -in $myBefore -or $rootThumb -in $rootBefore -or $rootThumb -notmatch '^[A-F0-9]{40}$' -or $rootSha256 -notmatch '^[A-F0-9]{64}$') {throw 'Refusing cleanup of preexisting/unknown certificate.'}
            $myPath="Cert:\LocalMachine\My\$rootThumb"
            $trustPath="Cert:\LocalMachine\Root\$rootThumb"
            $cleanupCa=Get-Item -LiteralPath $myPath -ErrorAction SilentlyContinue
            if (-not $cleanupCa) {$cleanupCa=Get-Item -LiteralPath $trustPath -ErrorAction SilentlyContinue}
            if ($cleanupCa) {
                try {
                    if ($cleanupCa.Subject -notmatch '^CN=LDSM Autoridad HTTPS interna [a-f0-9]{32}$' -or (Get-CertificateSha256 $cleanupCa) -ne $rootSha256) {throw 'Unexpected generated CA identity.'}
                    Remove-HttpsAddedRoot $cleanupCa
                } finally {$cleanupCa.Dispose()}
            }
            if (Test-Path -LiteralPath $myPath) {Remove-Item -LiteralPath $myPath -DeleteKey -Force -ErrorAction Stop}
            Assert-Real (-not (Test-Path -LiteralPath $myPath) -and -not (Test-Path -LiteralPath $trustPath)) 'Temporary native CA, private key and trust removed'
        }
    } catch {$cleanupErrors.Add('Native CA/trust: '+$_.Exception.Message)}
    foreach ($name in $mainBefore.Keys) {
        try {
            $after=(Invoke-LdsmDocker @('inspect',$name) | ConvertFrom-Json)[0]
            Assert-Real ($after.Id -eq $mainBefore[$name].Id -and $after.Image -eq $mainBefore[$name].Image -and $after.State.StartedAt -eq $mainBefore[$name].StartedAt) "Main container identity, image and start time unchanged: $name"
        } catch {$cleanupErrors.Add('Main service '+$name+': '+$_.Exception.Message)}
    }
    # Preserve protected evidence/keys for diagnosis if ANY cleanup is pending.
    if ($cleanupErrors.Count -eq 0) {
        try {
            $resolved=[IO.Path]::GetFullPath($workspace)
            $expectedWorkspace=Join-Path (Join-Path $evidenceRoot ('full-native-'+$suffix)) 'workspace'
            if ($resolved -ne [IO.Path]::GetFullPath($expectedWorkspace)) {throw 'Unsafe workspace cleanup path.'}
            Assert-LdsmNoReparsePoint $resolved (Join-Path $repo 'output')
            if (@(Get-ChildItem -LiteralPath $resolved -Force -Recurse | Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count) {throw 'Refusing recursive cleanup with a reparse point in the workspace.'}
            Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
        } catch {$cleanupErrors.Add('Workspace: '+$_.Exception.Message)}
    }
    if ($cleanupErrors.Count) {$cleanupFailure=$cleanupErrors -join '; ';Write-Host "CLEANUP PENDING: $cleanupFailure" -ForegroundColor Red}
    try {
        Write-LdsmPrivateJson (Join-Path $evidence 'results.json') @{passed=($null -eq $failure -and $null -eq $cleanupFailure);checks=$checks.ToArray();failure=$failure;cleanup_failure=$cleanupFailure;cleanup_errors=$cleanupErrors.ToArray();cleanup_complete=($cleanupErrors.Count -eq 0);scope='Native Windows LocalMachine PKI/Root/firewall + actual installer/client/status and isolated four-service database + actual browser. Renewal scheduling trigger is simulated only by disposable leaf_not_after metadata; native renewal and HTTPS validation are real. No system clock/certificate backdating and no second physical PC.';project=$projectName;completed_at=(Get-Date).ToString('o')}
    } finally {Stop-Transcript | Out-Null}
}
if ($failure -or $cleanupFailure) {exit 1}
