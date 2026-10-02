#requires -Version 5.1
[CmdletBinding()]
param([string]$EvidencePath = '')

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).ProviderPath
. (Join-Path $repository 'scripts/instalar-https-colegio.ps1')
Initialize-HttpsClientProbe
$transcribing = $false
if ($EvidencePath) {
    [IO.Directory]::CreateDirectory((Split-Path -Parent ([IO.Path]::GetFullPath($EvidencePath)))) | Out-Null
    Start-Transcript -Path $EvidencePath -Force | Out-Null
    $transcribing = $true
}
$script:count = 0
$script:fixtureBase = Join-Path ([IO.Path]::GetTempPath()) ('ldsm-https-server-test-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($script:fixtureBase) | Out-Null
$savedComposeFile = $env:COMPOSE_FILE
$savedComposeProject = $env:COMPOSE_PROJECT_NAME
$env:COMPOSE_FILE = $null
$env:COMPOSE_PROJECT_NAME = $null

function Assert-True { param($Value, [string]$Message) if (-not $Value) { throw $Message } }
function Assert-Throws { param([scriptblock]$Action, [string]$Pattern = '.')
    $failed = $false
    try { & $Action | Out-Null } catch { $failed = $true; if ($_.Exception.Message -notmatch $Pattern) { throw "Error inesperado: $($_.Exception.Message)" } }
    if (-not $failed) { throw 'La operacion debia ser rechazada.' }
}
function Test-Case { param([string]$Name, [scriptblock]$Action)
    & $Action
    $script:count++
    Write-Host "PASS $Name"
}
function Write-FixtureText { param([string]$Path, [string]$Value)
    [IO.Directory]::CreateDirectory((Split-Path -Parent $Path)) | Out-Null
    [IO.File]::WriteAllText($Path, $Value, (New-Object Text.UTF8Encoding($false)))
}
function Get-FixtureFiles { param([string]$Directory)
    return (@(Get-ChildItem -LiteralPath $Directory -File -Recurse -Force | ForEach-Object { $_.FullName.Substring($Directory.Length) + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } | Sort-Object) -join "`n")
}

# Test root is created in memory only; no Windows certificate store is written.
$rsa = New-Object Security.Cryptography.RSACng(3072)
$request = New-Object Security.Cryptography.X509Certificates.CertificateRequest -ArgumentList @('CN=QA Server Tests Not Installed', $rsa, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
$request.CertificateExtensions.Add((New-Object Security.Cryptography.X509Certificates.X509BasicConstraintsExtension($true, $true, 0, $true)))
$request.CertificateExtensions.Add((New-Object Security.Cryptography.X509Certificates.X509KeyUsageExtension([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign, $true)))
$temporaryRoot = $request.CreateSelfSigned([DateTimeOffset]::Now.AddDays(-1), [DateTimeOffset]::Now.AddYears(2))
$script:testRoot = New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList @(,$temporaryRoot.RawData)
$temporaryRoot.Dispose()
$rsa.Dispose()

# All mutating OS commands are replaced here. Only fixture files and temporary named mutexes are real.
function Test-HttpsClientAdministrator { return $script:fake.admin }
function Protect-LdsmHttpsDirectory { param([string]$Path) [IO.Directory]::CreateDirectory($Path) | Out-Null }
function Get-NetIPAddress { param($AddressFamily)
    return [pscustomobject]@{ IPAddress='192.168.50.28'; AddressState='Preferred'; InterfaceAlias='QA Ethernet'; InterfaceIndex=19 }
}
function Get-NetConnectionProfile { [CmdletBinding()]param($InterfaceIndex) return [pscustomobject]@{ NetworkCategory=$script:fake.profile } }
function Get-NetTCPConnection { [CmdletBinding()]param($LocalPort, $State) if ($script:fake.portBusy) { return [pscustomobject]@{ LocalPort=443 } } }
function Get-NetFirewallRule { [CmdletBinding()]param($Name) if ($script:fake.firewall) { return [pscustomobject]@{ Name=$Name } } }
function New-NetFirewallRule {
    [CmdletBinding()]param($Name,$DisplayName,$Direction,$Action,$Protocol,$LocalPort,$LocalAddress,$RemoteAddress,$InterfaceAlias,$Profile)
    $script:fake.firewall = $true; $script:fake.firewallAdded++
    Assert-True ($LocalAddress -eq '192.168.50.28' -and $RemoteAddress -eq 'LocalSubnet' -and @($Profile).Count -eq 2) 'Regla de firewall demasiado amplia.'
}
function Remove-NetFirewallRule { [CmdletBinding()]param([Parameter(ValueFromPipeline=$true)]$InputObject) process { $script:fake.firewall=$false; $script:fake.firewallRemoved++ } }
function Test-HttpsRootInstalled { param($Certificate) return $script:fake.rootInstalled }
function Add-HttpsTrustedRoot { param($Certificate) $script:fake.rootInstalled=$true; $script:fake.rootAdded++; return $true }
function Remove-HttpsAddedRoot { param($Certificate)
    Assert-True ($Certificate.Thumbprint -eq $script:testRoot.Thumbprint) 'Intento retirar una CA distinta.'
    $script:fake.rootInstalled=$false; $script:fake.rootRemoved++
}
function Test-HttpsServerHealth { param($ServerUri) $script:fake.healthCalls++; if ($script:fake.failHealth) { throw 'Fallo simulado de salud final.' } }
function Test-LdsmServerHttps { param($LanIp,$RootCer,$RootPem) $script:fake.tlsCalls++; if ($script:fake.failTls) { throw 'Fallo simulado de TLS.' } }
function Read-Host { param($Prompt) return $script:fake.confirm }
function Get-Item {
    [CmdletBinding()]param([Parameter(Position=0)]$Path, $LiteralPath, [switch]$Force)
    if ($Path -and ([string]$Path).StartsWith('Cert:\', [StringComparison]::OrdinalIgnoreCase)) { return $script:testRoot }
    if ($PSBoundParameters.ContainsKey('LiteralPath')) { return Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath -Force:$Force }
    return Microsoft.PowerShell.Management\Get-Item -Path $Path -Force:$Force
}
function New-LdsmHttpsCertificateMaterial {
    param($LanIp,$OutputDirectory,$RootThumbprint)
    $script:fake.certificateCalls++
    $script:fake.requestedThumbprints.Add([string]$RootThumbprint)
    $rootCer = Join-Path $OutputDirectory 'rootCA.cer'
    [IO.File]::WriteAllBytes($rootCer, $script:testRoot.RawData)
    Write-FixtureText (Join-Path $OutputDirectory 'rootCA.pem') 'PUBLIC TEST CERTIFICATE PLACEHOLDER'
    Write-FixtureText (Join-Path $OutputDirectory 'ldsm-lan.pem') 'PUBLIC TEST LEAF PLACEHOLDER'
    Write-FixtureText (Join-Path $OutputDirectory 'ldsm-lan-key.pem') 'PRIVATE TEST PLACEHOLDER NEVER DISTRIBUTE'
    $recovery = Join-Path $OutputDirectory 'ca-recovery.json'
    Write-LdsmPrivateJson $recovery @{ RootThumbprint=$script:testRoot.Thumbprint }
    return [pscustomobject]@{
        RootCerPath=$rootCer; RootPemPath=(Join-Path $OutputDirectory 'rootCA.pem'); RootThumbprint=$script:testRoot.Thumbprint
        RootSha256=(Get-CertificateSha256 $script:testRoot); RecoveryPath=$recovery; LeafNotAfter=[DateTimeOffset]::Now.AddDays(365)
    }
}
function Set-FakeRunningConfig { param($Config)
    $script:fake.config = $Config
    foreach ($service in @('backend','frontend')) {
        $spec = $Config.services.$service
        if ($spec.PSObject.Properties['environment']) {
            $script:fake.containers[$service].Config.Env = @($spec.environment.PSObject.Properties | ForEach-Object { $_.Name + '=' + ([string]$_.Value).Replace('$$','$') })
        }
        $mounts = @()
        if ($spec.PSObject.Properties['volumes']) {
            foreach ($bind in @($spec.volumes | Where-Object { $_.type -eq 'bind' })) { $mounts += [pscustomobject]@{ Type='bind'; Destination=$bind.target; Source=$bind.source } }
        }
        $script:fake.containers[$service].Mounts = $mounts
    }
}
function Invoke-LdsmDocker {
    param([string[]]$Arguments)
    $script:fake.commands.Add([pscustomobject]@{ Arguments=$Arguments })
    if ($Arguments[0] -eq 'info') { return 'test-engine' }
    if ($Arguments[0] -eq 'compose' -and $Arguments -contains '--help') { return '--wait-timeout --pull' }
    if ($Arguments[0] -eq 'inspect') { return (ConvertTo-Json -InputObject @($script:fake.containers[$Arguments[1]]) -Depth 40) }
    if ($Arguments[0] -eq 'exec') { if ($script:fake.failBackup) { throw 'Fallo simulado de respaldo.' }; return 'backup ok' }
    if ($Arguments[0] -eq 'run') { if ($script:fake.failNginx) { throw 'Fallo simulado de nginx -t.' }; return 'nginx ok' }
    if ($Arguments[0] -eq 'compose' -and $Arguments[1] -eq 'ps') { return $Arguments[-1] }
    if ($Arguments[0] -eq 'compose' -and $Arguments[1] -eq 'config') { return ($script:fake.config | ConvertTo-Json -Depth 40) }
    if ($Arguments[0] -eq 'compose' -and $Arguments -contains 'config') { return '' }
    if ($Arguments[0] -eq 'compose' -and $Arguments -contains 'up') {
        Assert-True ($Arguments -contains '--no-deps' -and $Arguments -contains '--no-build' -and $Arguments -contains '--pull' -and $Arguments -contains 'never') 'Up no conservador.'
        Assert-True ($Arguments[-2] -eq 'backend' -and $Arguments[-1] -eq 'frontend' -and $Arguments -notcontains 'postgres' -and $Arguments -notcontains 'backup') 'Modifico servicios de datos.'
        $snapshot = @($Arguments | Where-Object { $_ -like '*antes.json' })
        if ($snapshot.Count) {
            $script:fake.restoreCalls++
            if ($script:fake.failRestore) { throw 'Fallo simulado recuperando contenedores.' }
            Set-FakeRunningConfig (Get-Content -LiteralPath $snapshot[0] -Raw | ConvertFrom-Json)
        } else {
            $script:fake.switchCalls++
            $candidate = @($Arguments | Where-Object { $_ -like '*override.json' })[0]
            $override = Get-Content -LiteralPath $candidate -Raw | ConvertFrom-Json
            foreach ($p in $override.services.backend.environment.PSObject.Properties) { $script:fake.config.services.backend.environment | Add-Member -NotePropertyName $p.Name -NotePropertyValue $p.Value -Force }
            $script:fake.config.services.frontend | Add-Member -NotePropertyName volumes -NotePropertyValue $override.services.frontend.volumes -Force
            Set-FakeRunningConfig $script:fake.config
            if ($script:fake.failSwitch) { throw 'Fallo simulado durante cambio de contenedores.' }
        }
        return 'services ok'
    }
    throw "Comando Docker inesperado en harness: $($Arguments -join ' ')"
}
function Reset-Fixture {
    $script:project = Join-Path $script:fixtureBase ([Guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory((Join-Path $script:project 'frontend')) | Out-Null
    Write-FixtureText (Join-Path $script:project 'docker-compose.yml') 'services: {}'
    Write-FixtureText (Join-Path $script:project '.env') 'DB_PASSWORD=FAKE_NOT_A_PASSWORD'
    Copy-Item -LiteralPath (Join-Path $repository 'frontend/frontend.https.conf') -Destination (Join-Path $script:project 'frontend/frontend.https.conf')
    $script:fake = @{
        admin=$true; profile='Private'; portBusy=$false; firewall=$false; firewallAdded=0; firewallRemoved=0
        rootInstalled=$false; rootAdded=0; rootRemoved=0; healthCalls=0; tlsCalls=0; confirm='INSTALAR'
        failHealth=$false; failTls=$false; failBackup=$false; failNginx=$false; failSwitch=$false; failRestore=$false
        certificateCalls=0; switchCalls=0; restoreCalls=0; requestedThumbprints=(New-Object 'Collections.Generic.List[string]')
        commands=(New-Object 'Collections.Generic.List[object]'); containers=@{}
        config=('{"name":"qa_https_only","services":{"backend":{"environment":{"DB_PASSWORD":"a$$b$${SHOULD_NOT_EXPAND}$$$$end","COOKIE_SECURE":"false","CORS_ORIGIN":"http://192.168.50.28"},"volumes":[]},"frontend":{"ports":[{"target":80,"published":"80"}],"volumes":[]}}}' | ConvertFrom-Json)
    }
    foreach ($service in @('backend','frontend','postgres','backup')) {
        $script:fake.containers[$service] = [pscustomobject]@{ Id=$service; Image=('sha256:fixture_' + $service); State=[pscustomobject]@{Status='running';Health=[pscustomobject]@{Status='healthy'}}; Config=[pscustomobject]@{Env=@()}; Mounts=@(); NetworkSettings=[pscustomobject]@{ Networks=[pscustomobject]@{qa_network=[pscustomobject]@{}} } }
    }
    Set-FakeRunningConfig $script:fake.config
}
function Invoke-TestInstall { Invoke-LdsmHttpsServer -Aplicar -ConfirmarIpFija -LanIp '192.168.50.28' -ProjectRoot $script:project }
function Read-FixtureJournal { return (Get-Content -LiteralPath (Join-Path $script:project '.https-lan/transaccion.json') -Raw | ConvertFrom-Json) }
function Read-FixtureState { return (Get-Content -LiteralPath (Join-Path $script:project '.https-lan/estado.json') -Raw | ConvertFrom-Json) }

try {
    Test-Case 'RFC1918 estricto no acepta IP publica, abreviada ni octal' {
        foreach ($ip in @('10.0.0.1','172.16.0.1','172.31.255.254','192.168.50.28')) { Assert-True (Test-LdsmPrivateIp $ip) "Rechazo $ip" }
        foreach ($ip in @('127.0.0.1','8.8.8.8','169.254.1.2','172.32.0.1','192.168.001.2','192.168.1','192.168.256.1','10.1.1.1:443')) { Assert-True (-not (Test-LdsmPrivateIp $ip)) "Acepto $ip" }
    }
    Test-Case 'Override limita 443 a IP LAN y no redefine servicios de datos' {
        $override = New-LdsmHttpsOverride '192.168.50.28' 'C:\example\HTTPS'
        Assert-True ($override.services.frontend.ports[0].host_ip -eq '192.168.50.28' -and $override.services.frontend.ports[0].published -eq '443') 'Puerto global.'
        Assert-True (@($override.services.Keys).Count -eq 2 -and $override.services.backend.environment.COOKIE_SECURE -eq 'true') 'Override amplio o cookies inseguras.'
        Assert-True (@($override.services.frontend.volumes | Where-Object { -not $_.read_only }).Count -eq 0) 'Montajes de certificados no readonly.'
    }
    Test-Case 'Puertos alternativos conservan origen, redireccion y listener coherentes' {
        $override = New-LdsmHttpsOverride '192.168.50.28' 'C:\example\HTTPS' 35443
        $nginx = Get-LdsmHttpsNginx '192.168.50.28' (Join-Path $repository 'frontend/frontend.https.conf') 35443
        Assert-True ($override.services.frontend.ports[0].published -eq '35443' -and $override.services.frontend.ports[0].target -eq 443) 'Mapeo de puerto incorrecto.'
        Assert-True ($override.services.backend.environment.CORS_ORIGIN -eq 'https://192.168.50.28:35443' -and $nginx.Contains('https://192.168.50.28:35443$request_uri')) 'Origen y redireccion no coinciden.'
        Assert-Throws { New-LdsmHttpsOverride '192.168.50.28' 'C:\example' 0 } '.'
    }
    Test-Case 'Nginx fija redireccion y conserva SSE sin buffer ni cache' {
        $nginx = Get-LdsmHttpsNginx '192.168.50.28' (Join-Path $repository 'frontend/frontend.https.conf')
        Assert-True ($nginx.Contains('https://192.168.50.28$request_uri') -and -not $nginx.Contains('https://$host')) 'Redireccion dependiente de Host.'
        Assert-True ($nginx.Contains('proxy_buffering off;') -and $nginx.Contains('proxy_cache off;') -and $nginx.Contains('location = /healthz')) 'SSE/salud no configurados.'
    }
    Test-Case 'Comparacion de entorno decodifica $$ y preserva signos igual' {
        $expected = [pscustomobject]@{ PASSWORD='first$$piece=second$${VAR}$$$$' }
        Assert-LdsmRunningEnvironment $expected ([pscustomobject]@{Config=[pscustomobject]@{Env=@('PASSWORD=first$piece=second${VAR}$$')}})
        Assert-Throws { Assert-LdsmRunningEnvironment $expected ([pscustomobject]@{Config=[pscustomobject]@{Env=@('PASSWORD=different')}}) } 'pendientes'
    }
    Test-Case 'Snapshot Compose real conserva $, ${variable} y $$ sin expandir ni duplicar' {
        $source = '{"services":{"backend":{"image":"scratch","environment":{"LDSM_FIXTURE":"a$$b$${LDSM_SERVER_TEST_MISSING}$$$$end"}}}}'
        $rendered = $source | docker compose -p ldsm-readonly-serialization -f - config --format json
        Assert-True ($LASTEXITCODE -eq 0) 'Fallo compose config readonly.'
        $parsed = $rendered | ConvertFrom-Json
        $path = Join-Path $script:fixtureBase 'snapshot-compose.json'
        Write-LdsmPrivateJson $path $parsed
        $roundtrip = docker compose -p ldsm-readonly-serialization -f $path config --format json | ConvertFrom-Json
        Assert-True ($LASTEXITCODE -eq 0 -and $roundtrip.services.backend.environment.LDSM_FIXTURE -ceq $parsed.services.backend.environment.LDSM_FIXTURE) 'Se alteraron literales en snapshot.'
    }
    Test-Case 'Escritura Compose nueva escapa una vez rutas con $' {
        $path = Join-Path $script:fixtureBase 'new-compose.json'
        Write-LdsmPrivateJson $path @{services=@{backend=@{image='scratch';environment=@{LDSM_FIXTURE='a$b${NOT_EXPAND}$$end'}}}} -Compose
        $rendered = docker compose -p ldsm-readonly-serialization -f $path config --format json | ConvertFrom-Json
        Assert-True ($LASTEXITCODE -eq 0 -and $rendered.services.backend.environment.LDSM_FIXTURE -ceq 'a$$b$${NOT_EXPAND}$$$$end') 'Escape nuevo incorrecto.'
    }
    Test-Case 'Journal se reemplaza atomicamente varias veces en PS5.1 y PS7' {
        $path=Join-Path $script:fixtureBase 'journal-rewrite.json'
        Write-LdsmPrivateJson $path @{status='pending';stage=1}
        Write-LdsmPrivateJson $path @{status='pending';stage=2}
        Write-LdsmPrivateJson $path @{status='complete';stage=3}
        $result=Read-JsonIfExists $path
        Assert-True ($result.status -eq 'complete' -and $result.stage -eq 3 -and -not (Test-Path -LiteralPath "$path.next")) 'Journal no reemplazado de forma completa.'
    }
    Reset-Fixture
    Test-Case 'Diagnostico sin administrador no escribe archivos ni cambia servicios/confianza' {
        $script:fake.admin=$false
        $before=Get-FixtureFiles $script:project
        Invoke-LdsmHttpsServer -Diagnostico -LanIp '192.168.50.28' -ProjectRoot $script:project
        Assert-True ((Get-FixtureFiles $script:project) -ceq $before) 'Diagnostico escribio archivos.'
        Assert-True ($script:fake.switchCalls -eq 0 -and $script:fake.rootAdded -eq 0 -and $script:fake.certificateCalls -eq 0 -and $script:fake.firewallAdded -eq 0) 'Diagnostico mutante.'
    }
    Reset-Fixture
    Test-Case 'Aplicar sin administrador falla antes de cualquier cambio' {
        $script:fake.admin=$false
        $before=Get-FixtureFiles $script:project
        Assert-Throws { Invoke-TestInstall } 'administrador'
        Assert-True ((Get-FixtureFiles $script:project) -ceq $before -and $script:fake.commands.Count -eq 0) 'Cambio antes de admin.'
    }
    Reset-Fixture
    Test-Case 'Override ajeno se conserva byte por byte' {
        $path=Join-Path $script:project 'docker-compose.override.yml'
        Write-FixtureText $path 'services: { existing: { image: private } }'
        $before=Get-FixtureFiles $script:project
        Assert-Throws { Invoke-TestInstall } 'override desconocido'
        Assert-True ((Get-FixtureFiles $script:project) -ceq $before) 'Sobrescribio override ajeno.'
    }
    Reset-Fixture
    Test-Case 'IP publica no provoca cambio de red o archivos' {
        $before=Get-FixtureFiles $script:project
        Assert-Throws { Invoke-LdsmHttpsServer -Aplicar -ConfirmarIpFija -LanIp '8.8.8.8' -ProjectRoot $script:project } 'IP privada'
        Assert-True ((Get-FixtureFiles $script:project) -ceq $before) 'Escribio con IP publica.'
    }
    Reset-Fixture
    Test-Case 'Red publica Windows bloquea sin cambiar perfil ni abrir firewall' {
        $script:fake.profile='Public'
        Assert-Throws { Invoke-TestInstall } 'red como publica'
        Assert-True ($script:fake.firewallAdded -eq 0 -and -not (Test-Path -LiteralPath (Join-Path $script:project '.https-lan'))) 'Alteraciones red publica.'
    }
    Reset-Fixture
    Test-Case 'Puerto 443 ocupado no cierra procesos ni altera servicios' {
        $script:fake.portBusy=$true
        Assert-Throws { Invoke-TestInstall } '443 esta ocupado'
        Assert-True ($script:fake.switchCalls -eq 0 -and $script:fake.firewallAdded -eq 0) 'Cambio con puerto ocupado.'
    }
    Reset-Fixture
    Test-Case 'Cancelacion explicita no crea autoridad ni archivos de instalacion' {
        $script:fake.confirm='NO'
        $before=Get-FixtureFiles $script:project
        Invoke-TestInstall
        Assert-True ((Get-FixtureFiles $script:project) -ceq $before -and $script:fake.certificateCalls -eq 0) 'Cancelacion mutante.'
    }
    Reset-Fixture
    Test-Case 'Fallo respaldo recupera antes del cambio sin emitir CA' {
        $script:fake.failBackup=$true
        Assert-Throws { Invoke-TestInstall } 'respaldo'
        Assert-True ((Read-FixtureJournal).status -eq 'restored' -and $script:fake.switchCalls -eq 0 -and $script:fake.certificateCalls -eq 0) 'Rollback previo incompleto.'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $script:project 'docker-compose.override.yml'))) 'Dejo override fallido.'
    }
    Reset-Fixture
    Test-Case 'Fallo nginx previo preserva CA para reintentar sin rotarla' {
        $script:fake.failNginx=$true
        Assert-Throws { Invoke-TestInstall } 'nginx'
        $authority=Read-JsonIfExists (Join-Path $script:project '.https-lan/autoridad.json')
        Assert-True ($authority.RootThumbprint -eq $script:testRoot.Thumbprint -and (Read-FixtureJournal).status -eq 'restored' -and $script:fake.switchCalls -eq 0) 'Perdio identidad CA o cambio prematuro.'
        $script:fake.failNginx=$false
        Invoke-TestInstall
        Assert-True ($script:fake.requestedThumbprints[1] -eq $script:testRoot.Thumbprint) 'Reintento no reutilizo CA.'
    }
    Reset-Fixture
    Test-Case 'Fallo durante switch vuelve a imagen exacta y no toca DB/volumenes' {
        $script:fake.failSwitch=$true
        Assert-Throws { Invoke-TestInstall } 'cambio de contenedores'
        $journal=Read-FixtureJournal
        $before=Get-Content -LiteralPath $journal.before_config -Raw | ConvertFrom-Json
        Assert-True ($journal.status -eq 'restored' -and $script:fake.restoreCalls -eq 1 -and $before.services.backend.image -eq 'sha256:fixture_backend' -and $before.services.frontend.image -eq 'sha256:fixture_frontend') 'No recupero imagenes fijadas.'
        Assert-True ($script:fake.firewallRemoved -eq 1 -and $script:fake.rootRemoved -eq 0) 'Limpieza incorrecta.'
        Assert-True (@($script:fake.commands | Where-Object { $_.Arguments -contains 'down' -or $_.Arguments -contains 'volume' }).Count -eq 0) 'Operacion destructiva.'
    }
    Reset-Fixture
    Test-Case 'Fallo TLS despues de switch recupera HTTP sin instalar CA' {
        $script:fake.failTls=$true
        Assert-Throws { Invoke-TestInstall } 'TLS'
        Assert-True ((Read-FixtureJournal).status -eq 'restored' -and $script:fake.restoreCalls -eq 1 -and $script:fake.rootAdded -eq 0) 'Confio antes de TLS o rollback falto.'
        Assert-True ($script:fake.config.services.backend.environment.COOKIE_SECURE -eq 'false') 'Entorno anterior no restaurado.'
    }
    Reset-Fixture
    Test-Case 'Fallo salud tras importar retira solo CA y firewall nuevos' {
        $script:fake.failHealth=$true
        Assert-Throws { Invoke-TestInstall } 'salud final'
        Assert-True ($script:fake.rootAdded -eq 1 -and $script:fake.rootRemoved -eq 1 -and -not $script:fake.rootInstalled -and -not $script:fake.firewall) 'No recupero confianza/firewall.'
    }
    Reset-Fixture
    Test-Case 'Firewall preexistente ajeno bloquea sin quitar confianza ni cambiar servicios' {
        $script:fake.rootInstalled=$true; $script:fake.firewall=$true; $script:fake.failHealth=$true
        Assert-Throws { Invoke-TestInstall } 'firewall no registrada'
        Assert-True ($script:fake.rootRemoved -eq 0 -and $script:fake.firewallRemoved -eq 0 -and $script:fake.rootInstalled -and $script:fake.firewall) 'Retiro configuracion preexistente.'
        Assert-True ($script:fake.certificateCalls -eq 0 -and $script:fake.switchCalls -eq 0) 'Cambio antes de resolver regla ajena.'
    }
    Reset-Fixture
    Test-Case 'Fallo de salud no retira autoridad que ya estaba instalada' {
        $script:fake.rootInstalled=$true; $script:fake.failHealth=$true
        Assert-Throws { Invoke-TestInstall } 'salud final'
        Assert-True ($script:fake.rootRemoved -eq 0 -and $script:fake.rootInstalled -and $script:fake.firewallRemoved -eq 1) 'Retiro autoridad preexistente o conservo firewall nuevo.'
    }
    Reset-Fixture
    Test-Case 'Exito genera ZIP exactamente de tres archivos sin clave privada' {
        Invoke-TestInstall
        $state=Read-FixtureState
        Assert-True ((Read-FixtureJournal).status -eq 'complete' -and $state.root_thumbprint -eq $script:testRoot.Thumbprint) 'Estado no completo.'
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive=[IO.Compression.ZipFile]::OpenRead($state.bundle_zip)
        try {
            $names=@($archive.Entries | ForEach-Object { $_.FullName } | Sort-Object)
            Assert-True (($names -join ',') -eq 'conexion.json,Confiar-Equipo.ps1,rootCA.cer') ('ZIP inesperado: ' + ($names -join ','))
        } finally { $archive.Dispose() }
        $bundle=Read-HttpsClientBundle (Join-Path $state.release_path 'equipos')
        try { Assert-True ($bundle.Certificate.Thumbprint -eq $state.root_thumbprint) 'Paquete no validable por cliente.' } finally { $bundle.Certificate.Dispose() }
    }
    Test-Case 'Repetir aplicacion vigente es idempotente, sin nueva CA ni reinicio' {
        $before=Get-FixtureFiles $script:project
        $calls=$script:fake.certificateCalls; $switches=$script:fake.switchCalls; $rootAdds=$script:fake.rootAdded
        Invoke-TestInstall
        Assert-True ((Get-FixtureFiles $script:project) -ceq $before -and $script:fake.certificateCalls -eq $calls -and $script:fake.switchCalls -eq $switches -and $script:fake.rootAdded -eq $rootAdds) 'Repeticion no idempotente.'
    }
    Test-Case 'Cambio ajeno en override gestionado bloquea antes de reinstalar' {
        $path=Join-Path $script:project 'docker-compose.override.yml'
        [IO.File]::AppendAllText($path, "`n ")
        $before=Get-FixtureFiles $script:project
        Assert-Throws { Invoke-TestInstall } 'override desconocido'
        Assert-True ((Get-FixtureFiles $script:project) -ceq $before) 'Alteracion concurrente sobrescrita.'
    }
    Reset-Fixture
    Test-Case 'Recuperacion interrumpida queda failed y -Restaurar recupera identidad/configuracion' {
        $script:fake.failTls=$true; $script:fake.failRestore=$true
        Assert-Throws { Invoke-TestInstall } 'TLS'
        Assert-True ((Read-FixtureJournal).status -eq 'failed') 'No guardo recuperacion pendiente.'
        $script:fake.failRestore=$false; $script:fake.failTls=$false
        Invoke-LdsmHttpsServer -Restaurar -ProjectRoot $script:project
        $authority=Read-JsonIfExists (Join-Path $script:project '.https-lan/autoridad.json')
        Assert-True ((Read-FixtureJournal).status -eq 'restored' -and $authority.RootThumbprint -eq $script:testRoot.Thumbprint -and -not (Test-Path -LiteralPath (Join-Path $script:project 'docker-compose.override.yml'))) 'Recuperacion incompleta.'
    }
    Reset-Fixture
    Test-Case 'Journal pending bloquea otro intento y permite restauracion explicita' {
        $script:fake.failNginx=$true
        Assert-Throws { Invoke-TestInstall } 'nginx'
        $journal=Read-FixtureJournal
        $journal.status='pending'
        Write-LdsmPrivateJson (Join-Path $script:project '.https-lan/transaccion.json') $journal
        Assert-Throws { Invoke-TestInstall } 'interrumpida'
        Invoke-LdsmHttpsServer -Restaurar -ProjectRoot $script:project
        Assert-True ((Read-FixtureJournal).status -eq 'restored') 'No recupero journal pending.'
    }
    Reset-Fixture
    Test-Case 'Rollback de renovacion restaura override y estado anteriores byte por byte' {
        Invoke-TestInstall
        $state=Read-FixtureState
        $state.leaf_not_after=[DateTimeOffset]::Now.AddDays(3).ToString('o')
        Write-LdsmPrivateJson (Join-Path $script:project '.https-lan/estado.json') $state
        $oldOverride=[IO.File]::ReadAllBytes((Join-Path $script:project 'docker-compose.override.yml'))
        $oldState=[IO.File]::ReadAllBytes((Join-Path $script:project '.https-lan/estado.json'))
        $script:fake.failTls=$true
        Assert-Throws { Invoke-LdsmHttpsServer -Renovar -ProjectRoot $script:project } 'TLS'
        Assert-True ([Convert]::ToBase64String($oldOverride) -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $script:project 'docker-compose.override.yml')))) 'Override anterior no exacto.'
        Assert-True ([Convert]::ToBase64String($oldState) -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $script:project '.https-lan/estado.json')))) 'Estado anterior no exacto.'
        Assert-True ($script:fake.requestedThumbprints[-1] -eq $script:testRoot.Thumbprint -and $script:fake.rootRemoved -eq 0) 'Rotacion o retiro de CA existente.'
    }
    Test-Case 'Rollback se niega a sobreescribir override cambiado por otro operador' {
        $journal=Read-FixtureJournal
        $override=Join-Path $script:project 'docker-compose.override.yml'
        [IO.File]::AppendAllText($override, "`n# cambio externo")
        $before=[IO.File]::ReadAllText($override)
        Assert-Throws { Restore-HttpsTransaction $journal (Join-Path $script:project '.https-lan/transaccion.json') } 'cambio durante'
        Assert-True ([IO.File]::ReadAllText($override) -ceq $before) 'Destruyo cambio externo.'
    }
    Write-Host "RESULTADO: $script:count pruebas aprobadas; sin cambios en Docker, red, firewall ni almacenes de certificados reales."
} finally {
    $env:COMPOSE_FILE=$savedComposeFile
    $env:COMPOSE_PROJECT_NAME=$savedComposeProject
    $script:testRoot.Dispose()
    $resolved=[IO.Path]::GetFullPath($script:fixtureBase)
    $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    if (-not $resolved.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notmatch '^ldsm-https-server-test-[a-f0-9]{32}$') { throw 'Limpieza rechazada: ruta temporal no verificada.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
    if ($transcribing) { Stop-Transcript | Out-Null }
}
