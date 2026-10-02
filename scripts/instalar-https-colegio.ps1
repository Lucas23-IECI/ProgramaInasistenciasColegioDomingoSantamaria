#requires -Version 5.1
[CmdletBinding(DefaultParameterSetName = 'Diagnostico')]
param(
    [Parameter(ParameterSetName = 'Aplicar', Mandatory = $true)][switch]$Aplicar,
    [Parameter(ParameterSetName = 'Restaurar', Mandatory = $true)][switch]$Restaurar,
    [Parameter(ParameterSetName = 'Renovar', Mandatory = $true)][switch]$Renovar,
    [Parameter(ParameterSetName = 'Diagnostico')][switch]$Diagnostico,
    [Parameter(ParameterSetName = 'Aplicar')][Parameter(ParameterSetName = 'Diagnostico')][string]$LanIp = '',
    [Parameter(ParameterSetName = 'Aplicar')][switch]$ConfirmarIpFija,
    [Parameter(ParameterSetName = 'Aplicar')][Parameter(ParameterSetName = 'Diagnostico')][ValidateRange(1,65535)][int]$HttpPort = 80,
    [Parameter(ParameterSetName = 'Aplicar')][Parameter(ParameterSetName = 'Diagnostico')][ValidateRange(1,65535)][int]$HttpsPort = 443,
    [string]$ProjectRoot = ''
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$script:LdsmHttpsScriptRoot = $PSScriptRoot
$entryArguments = @{} + $PSBoundParameters
$runAsEntryPoint = $MyInvocation.InvocationName -ne '.'
Import-Module (Join-Path $PSScriptRoot 'https/Server.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'https/Certificates.psm1') -Force
. (Join-Path $PSScriptRoot 'https/Confiar-Equipo.ps1')
Set-StrictMode -Version 2.0

function Read-JsonIfExists([string]$Path) {
    if (Test-Path -LiteralPath $Path) { return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json) }
    return $null
}

function Restore-HttpsTransaction($Transaction, [string]$JournalPath) {
    Write-Host 'Recuperando solamente la configuracion web anterior. No se elimina ninguna base de datos.'
    # Preserve the generated CA identity even when its first activation failed.
    if (Test-Path -LiteralPath $Transaction.ca_recovery) { Copy-Item -LiteralPath $Transaction.ca_recovery -Destination (Join-Path (Split-Path -Parent $JournalPath) 'autoridad.json') -Force }
    if (Test-Path -LiteralPath $script:overridePath) {
        $hash = (Get-FileHash -LiteralPath $script:overridePath -Algorithm SHA256).Hash
        if ($hash -notin @($Transaction.before_override_sha256, $Transaction.candidate_override_sha256)) { throw 'El override cambio durante la instalacion. Recuperacion detenida para no sobrescribir cambios ajenos.' }
    }
    if ($Transaction.had_override) {
        Copy-Item -LiteralPath $Transaction.before_override -Destination $script:overridePath -Force
    } elseif (Test-Path -LiteralPath $script:overridePath) {
        # Exact managed file, never a directory or a user-owned override.
        $current = Read-JsonIfExists $script:overridePath
        if ($current.'x-ldsm-https-managed' -ne 1) { throw 'El override fue cambiado por otra persona. Recuperacion detenida para no sobrescribirlo.' }
        Remove-Item -LiteralPath $script:overridePath
    }
    if ($Transaction.switch_started) {
        Invoke-LdsmDocker @('compose', '--project-directory', $Transaction.project_root, '-p', $Transaction.project, '-f', $Transaction.before_config, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '150', 'backend', 'frontend') | Out-Null
    }
    if ($Transaction.root_added) {
        $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($Transaction.root_cer)
        try { Remove-HttpsAddedRoot $cert } finally { $cert.Dispose() }
    }
    if ($Transaction.firewall_created) {
        Get-NetFirewallRule -Name $Transaction.firewall_rule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    }
    if ($Transaction.had_state) { Copy-Item -LiteralPath $Transaction.before_state -Destination $script:statePath -Force }
    elseif (Test-Path -LiteralPath $script:statePath) { Remove-Item -LiteralPath $script:statePath }
    $Transaction.status = 'restored'
    Write-LdsmPrivateJson $JournalPath $Transaction
    Write-Host 'Configuracion anterior recuperada. Se conserva el diagnostico de este intento.'
}

function Invoke-LdsmHttpsServer {
param([switch]$Aplicar, [switch]$Restaurar, [switch]$Renovar, [switch]$Diagnostico, [string]$LanIp='', [switch]$ConfirmarIpFija, [string]$ProjectRoot='', [ValidateRange(1,65535)][int]$HttpPort=80, [ValidateRange(1,65535)][int]$HttpsPort=443)
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) { $ProjectRoot = Split-Path -Parent $script:LdsmHttpsScriptRoot }
$transaction = $null
$journalPath = $null
$mutex = $null
$locked = $false
Push-Location $ProjectRoot
try {
    $ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
    $dataPath = Join-Path $ProjectRoot '.https-lan'
    Assert-LdsmNoReparsePoint $dataPath $dataPath
    $script:overridePath = Join-Path $ProjectRoot 'docker-compose.override.yml'
    $script:statePath = Join-Path $dataPath 'estado.json'
    foreach ($required in @('docker-compose.yml', '.env', 'frontend/frontend.https.conf')) {
        if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $required) -PathType Leaf)) { throw "No se encontro $required en la carpeta del proyecto." }
    }
    if ($env:COMPOSE_FILE -or $env:COMPOSE_PROJECT_NAME) { throw 'COMPOSE_FILE/COMPOSE_PROJECT_NAME estan definidos en esta consola. Usa una consola limpia para evitar operar otro proyecto.' }
    if (Select-String -LiteralPath (Join-Path $ProjectRoot '.env') -Pattern '^\s*COMPOSE_(FILE|PROJECT_NAME)\s*=' -Quiet) { throw 'El proyecto usa una seleccion Compose personalizada. Requiere revision antes de automatizar HTTPS.' }
    foreach ($alternative in @('compose.yaml', 'compose.yml', 'compose.override.yml', 'compose.override.yaml', 'docker-compose.override.yaml')) {
        if (Test-Path -LiteralPath (Join-Path $ProjectRoot $alternative)) { throw "Existe $alternative. No se modificara una instalacion Compose personalizada automaticamente." }
    }
    $state = Read-JsonIfExists $script:statePath
    if ($state) {
        if ($state.PSObject.Properties['http_port']) { $HttpPort = [int]$state.http_port }
        if ($state.PSObject.Properties['https_port']) { $HttpsPort = [int]$state.https_port }
    }
    if ($HttpPort -eq $HttpsPort) { throw 'HTTP y HTTPS necesitan puertos distintos.' }
    $admin = Test-HttpsClientAdministrator
    $mutating = $Aplicar -or $Restaurar -or $Renovar
    if ($mutating -and -not $admin) { throw 'Abre PowerShell como administrador dentro del proyecto. Sin administrador solo se permite -Diagnostico; no se hicieron cambios.' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $id = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($ProjectRoot.ToLowerInvariant())))).Replace('-', '').Substring(0,16) }
    finally { $sha.Dispose() }
    $mutex = New-Object Threading.Mutex($false, "Global\LDSM-HTTPS-$id")
    try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw 'Ya hay una instalacion/renovacion HTTPS en curso. No abras dos instaladores a la vez.' }
    $journalPath = Join-Path $dataPath 'transaccion.json'
    $pending = Read-JsonIfExists $journalPath
    if ($Restaurar) {
        if ($null -eq $pending -or $pending.status -notin @('pending','failed')) { throw 'No hay una instalacion incompleta que recuperar. Esta opcion no revierte una instalacion terminada.' }
        Restore-HttpsTransaction $pending $journalPath
        return
    }
    if ($null -ne $pending -and $pending.status -in @('pending','failed')) { throw 'Hay una instalacion interrumpida. Ejecuta .\scripts\instalar-https-colegio.ps1 -Restaurar antes de otro intento.' }
    if (-not (Test-LdsmManagedOverride $script:overridePath $state)) { throw 'Existe un override desconocido o modificado. No sera sobrescrito: solicita revision de su configuracion.' }
    Get-Command docker, curl.exe -ErrorAction Stop | Out-Null
    Invoke-LdsmDocker @('info', '--format', '{{.ServerVersion}}') | Out-Null
    $composeHelp = Invoke-LdsmDocker @('compose', 'up', '--help')
    if ($composeHelp -notmatch '--wait-timeout' -or $composeHelp -notmatch '--pull') { throw 'Actualiza Docker Compose antes de instalar: falta el control de inicio y recuperacion --wait-timeout/--pull.' }
    $curlHelp = & curl.exe --help all
    if ($LASTEXITCODE -ne 0 -or ($curlHelp -join "`n") -notmatch '--ssl-revoke-best-effort') { throw 'Actualiza curl de Windows antes de instalar: falta la validacion compatible con la autoridad privada.' }
    $configText = Invoke-LdsmDocker @('compose', 'config', '--format', 'json')
    $config = $configText | ConvertFrom-Json
    if (@($config.services.frontend.ports | Where-Object { $_.target -eq 80 -and [int]$_.published -eq $HttpPort }).Count -ne 1) { throw "El puerto HTTP existente no coincide con $HttpPort. No sera cambiado automaticamente." }
    $containers = @{}
    foreach ($service in @('backend','frontend','postgres','backup')) {
        $cid = Invoke-LdsmDocker @('compose', 'ps', '-q', $service)
        if ([string]::IsNullOrWhiteSpace($cid)) { throw "El servicio $service no esta iniciado. HTTPS no se instalara sobre un sistema detenido." }
        $inspect = (Invoke-LdsmDocker @('inspect', $cid) | ConvertFrom-Json)[0]
        if ($inspect.State.Status -ne 'running' -or $inspect.State.Health.Status -ne 'healthy') { throw "El servicio $service aun no esta saludable. Corrige esto antes de cambiar HTTPS." }
        $containers[$service] = $inspect
    }
    Assert-LdsmRunningEnvironment $config.services.backend.environment $containers.backend
    # A backup renderer must reflect the bind mounts currently used by the app.
    foreach ($service in @('backend','frontend')) {
        $expectedBinds = @()
        if ($config.services.$service.PSObject.Properties['volumes']) { $expectedBinds = @($config.services.$service.volumes | Where-Object { $_.type -eq 'bind' }) }
        $actualBinds = @($containers[$service].Mounts | Where-Object { $_.Type -eq 'bind' })
        if ($expectedBinds.Count -ne $actualBinds.Count) { throw "Los montajes de $service cambiaron desde su inicio. Revisa esa diferencia antes de instalar HTTPS." }
        foreach ($bind in $expectedBinds) {
            $match = @($actualBinds | Where-Object { $_.Destination -eq $bind.target })
            if ($match.Count -ne 1) { throw "Un montaje de $service no coincide con la configuracion actual." }
            # Docker Desktop normalizes Windows bind sources differently; compare via container label/config on operator review if source changed.
            $normalSource = $match[0].Source.Replace('/run/desktop/mnt/host/', '').Replace('/host_mnt/', '').Replace(':','').Replace('\','/').TrimStart('/').ToLowerInvariant()
            $expectedSource = $bind.source.Replace(':','').Replace('\','/').TrimStart('/').ToLowerInvariant()
            if ($normalSource -ne $expectedSource) { throw "La ruta montada por $service no coincide. HTTPS se detuvo antes de hacer cambios." }
        }
    }
    if ($state -and [string]::IsNullOrWhiteSpace($LanIp)) { $LanIp = $state.lan_ip }
    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { (Test-LdsmPrivateIp $_.IPAddress) -and $_.AddressState -eq 'Preferred' })
    if ([string]::IsNullOrWhiteSpace($LanIp)) {
        $candidates = @($addresses | Where-Object { $_.InterfaceAlias -notmatch 'vEthernet|WSL|Virtual|Tailscale|Docker|VPN|Loopback' })
        if ($candidates.Count -ne 1) { throw 'No se puede elegir la red sin adivinar. Ejecuta -Diagnostico -LanIp con la IP privada del PC del colegio.' }
        $LanIp = $candidates[0].IPAddress
    }
    if (-not (Test-LdsmPrivateIp $LanIp)) { throw 'Usa la IP privada del PC servidor; no una direccion de Internet.' }
    $adapter = @($addresses | Where-Object { $_.IPAddress -eq $LanIp })
    if ($adapter.Count -ne 1) { throw "La IP $LanIp no pertenece a una interfaz activa de este PC. No se modifico la red." }
    $profile = Get-NetConnectionProfile -InterfaceIndex $adapter[0].InterfaceIndex -ErrorAction Stop
    if ($profile.NetworkCategory -notin @('Private','DomainAuthenticated')) { throw 'Windows clasifica esta red como publica. Confirma con soporte que sea la red confiable del colegio; el instalador no la cambiara automaticamente.' }
    if (-not $state -and @(Get-NetTCPConnection -LocalPort $HttpsPort -State Listen -ErrorAction SilentlyContinue).Count) { throw "El puerto $HttpsPort esta ocupado. No se cerrara ni reemplazara otro servicio." }
    if (-not $state -and (Get-NetFirewallRule -Name "LDSM-HTTPS-$id" -ErrorAction SilentlyContinue)) { throw 'Ya existe una regla de firewall no registrada como propia. No se alterara ni se continuara sin revision.' }
    if ($state -and $state.lan_ip -ne $LanIp) { throw 'La IP cambio. Requiere renovar y redistribuir la direccion con soporte; no se sustituira silenciosamente.' }
    $httpsOrigin = Get-LdsmHttpsOrigin $LanIp $HttpsPort
    Write-Host "Servidor detectado: $httpsOrigin/"
    Write-Host 'Base de datos, cuentas, contrasenas y registros: se conservan sin modificar.'
    Write-Host 'HTTPS cambia la direccion de acceso: hay que iniciar sesion otra vez y configurar confianza una vez en cada equipo.'
    if (-not $mutating) {
        if ($state) { Initialize-HttpsClientProbe; Test-LdsmServerHttps $LanIp (Join-Path $state.release_path 'rootCA.cer') (Join-Path $state.release_path 'rootCA.pem') $HttpsPort $HttpPort }
        Write-Host 'DIAGNOSTICO CORRECTO. No se hicieron cambios.'
        if (-not $state) { Write-Host 'Para instalar: .\scripts\instalar-https-colegio.ps1 -Aplicar -LanIp <IP> -ConfirmarIpFija' }
        return
    }
    if ($Renovar -and -not $state) { throw 'No hay una instalacion HTTPS gestionada que renovar.' }
    if ($state) {
        $leafExpiry = if ($state.leaf_not_after -is [datetime]) { [DateTimeOffset]$state.leaf_not_after } else { [DateTimeOffset]::Parse($state.leaf_not_after, [Globalization.CultureInfo]::InvariantCulture) }
        if ($leafExpiry -gt [DateTimeOffset]::Now.AddDays(30)) {
            Initialize-HttpsClientProbe
            Test-LdsmServerHttps $LanIp (Join-Path $state.release_path 'rootCA.cer') (Join-Path $state.release_path 'rootCA.pem') $HttpsPort $HttpPort
            Write-Host 'HTTPS ya esta instalado y vigente. No es necesario renovarlo ni reinstalar la confianza.'
            return
        }
    }
    if ($Aplicar) {
        if (-not $ConfirmarIpFija) { throw 'Primero confirma que la IP del servidor es fija/reservada. Despues agrega -ConfirmarIpFija. El instalador no cambiara el router.' }
        Write-Host 'Se hara un respaldo y se reiniciaran solamente backend/frontend con sus imagenes actuales.'
        Write-Host "Se habilitara el puerto $HttpsPort solo para la red local confiable y la autoridad de este servidor en este Windows."
        Write-Host 'IMPORTANTE: antes de continuar, todos los equipos deben haber sincronizado sus ingresos offline pendientes.'
        Write-Host 'La cola offline y la PWA antigua no se trasladan automaticamente de HTTP a HTTPS. No borres datos del navegador.'
        if ((Read-Host 'Con los equipos sincronizados, escribe INSTALAR para continuar') -cne 'INSTALAR') { Write-Host 'Cancelado sin cambios.'; return }
    }
    Protect-LdsmHttpsDirectory $dataPath
    $releasePath = Join-Path $dataPath ('versiones/' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
    Assert-LdsmNoReparsePoint $releasePath $dataPath
    Protect-LdsmHttpsDirectory $releasePath
    $beforeConfig = Join-Path $releasePath 'antes.json'
    foreach ($service in @('backend','frontend')) { $config.services.$service | Add-Member -NotePropertyName image -NotePropertyValue $containers[$service].Image -Force }
    # Already escaped by `compose config`; escaping again changes literal passwords.
    Write-LdsmPrivateJson $beforeConfig $config
    $beforeOverride = Join-Path $releasePath 'override-anterior.json'
    $beforeState = Join-Path $releasePath 'estado-anterior.json'
    if ($state) {
        Copy-Item -LiteralPath $script:overridePath -Destination $beforeOverride
        Copy-Item -LiteralPath $script:statePath -Destination $beforeState
    }
    $oldOverrideHash = if ($state) { $state.override_sha256 } else { '' }
    $transaction = [pscustomobject]@{ status='pending'; project=$config.name; project_root=$ProjectRoot; ca_recovery=(Join-Path $releasePath 'ca-recovery.json'); before_config=$beforeConfig; had_override=[bool]$state; before_override=$beforeOverride; before_override_sha256=$oldOverrideHash; candidate_override_sha256=''; had_state=[bool]$state; before_state=$beforeState; switch_started=$false; root_added=$false; root_cer=''; firewall_created=$false; firewall_rule="LDSM-HTTPS-$id" }
    Write-LdsmPrivateJson $journalPath $transaction
    Invoke-LdsmDocker @('exec', $containers.backup.Id, 'sh', '/backup.sh') | Out-Null
    $authority = Read-JsonIfExists (Join-Path $dataPath 'autoridad.json')
    $rootThumbprint = if ($state) { $state.root_thumbprint } elseif ($authority) { $authority.RootThumbprint } else { '' }
    $material = New-LdsmHttpsCertificateMaterial -LanIp $LanIp -OutputDirectory $releasePath -RootThumbprint $rootThumbprint
    $transaction.root_cer = $material.RootCerPath
    Copy-Item -LiteralPath $material.RecoveryPath -Destination (Join-Path $dataPath 'autoridad.json') -Force
    Write-LdsmPrivateJson $journalPath $transaction
    $nginx = Get-LdsmHttpsNginx $LanIp (Join-Path $ProjectRoot 'frontend/frontend.https.conf') $HttpsPort
    [IO.File]::WriteAllText((Join-Path $releasePath 'nginx.conf'), $nginx, (New-Object Text.UTF8Encoding($false)))
    $override = New-LdsmHttpsOverride $LanIp $releasePath $HttpsPort
    $candidate = Join-Path $releasePath 'override.json'
    Write-LdsmPrivateJson $candidate $override -Compose
    $transaction.candidate_override_sha256 = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash
    Write-LdsmPrivateJson $journalPath $transaction
    $imagePin = Join-Path $releasePath 'imagenes.json'
    Write-LdsmPrivateJson $imagePin @{ services=@{ backend=@{image=$containers.backend.Image}; frontend=@{image=$containers.frontend.Image} } }
    $composeArgs = @('compose','--project-directory',$ProjectRoot,'-p',$config.name,'-f',(Join-Path $ProjectRoot 'docker-compose.yml'),'-f',$candidate,'-f',$imagePin)
    Invoke-LdsmDocker ($composeArgs + @('config','--quiet')) | Out-Null
    # No network/port changes: compile the exact Nginx config against the existing backend network first.
    $networkName = @($containers.frontend.NetworkSettings.Networks.PSObject.Properties.Name)[0]
    Invoke-LdsmDocker @('run','--rm','--network',$networkName,'--entrypoint','nginx','--mount',"type=bind,source=$releasePath/nginx.conf,target=/etc/nginx/conf.d/default.conf,readonly",'--mount',"type=bind,source=$releasePath/ldsm-lan.pem,target=/etc/nginx/certs/ldsm-lan.pem,readonly",'--mount',"type=bind,source=$releasePath/ldsm-lan-key.pem,target=/etc/nginx/certs/ldsm-lan-key.pem,readonly",$containers.frontend.Image,'-t') | Out-Null
    $rule = Get-NetFirewallRule -Name $transaction.firewall_rule -ErrorAction SilentlyContinue
    if ($rule -and -not $state) { throw 'Ya existe una regla de firewall con el identificador de esta instalacion, pero no esta registrada como propia. No sera cambiada.' }
    if (-not $rule) {
        # Journal intent first, so interruption after creating the rule remains recoverable.
        $transaction.firewall_created = $true
        Write-LdsmPrivateJson $journalPath $transaction
        New-NetFirewallRule -Name $transaction.firewall_rule -DisplayName 'Colegio HTTPS (solo red local)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort @($HttpPort,$HttpsPort) -LocalAddress $LanIp -RemoteAddress LocalSubnet -InterfaceAlias $adapter[0].InterfaceAlias -Profile Private,Domain | Out-Null
    }
    Write-LdsmPrivateJson $script:overridePath $override -Compose
    $transaction.switch_started = $true
    Write-LdsmPrivateJson $journalPath $transaction
    Invoke-LdsmDocker ($composeArgs + @('up','-d','--no-deps','--no-build','--pull','never','--wait','--wait-timeout','150','backend','frontend')) | Out-Null
    Initialize-HttpsClientProbe
    Test-LdsmServerHttps $LanIp $material.RootCerPath $material.RootPemPath $HttpsPort $HttpPort
    $bundle = Join-Path $releasePath 'equipos'
    [IO.Directory]::CreateDirectory($bundle) | Out-Null
    Copy-Item -LiteralPath $material.RootCerPath -Destination (Join-Path $bundle 'rootCA.cer')
    Copy-Item -LiteralPath (Join-Path $script:LdsmHttpsScriptRoot 'https/Confiar-Equipo.ps1') -Destination (Join-Path $bundle 'Confiar-Equipo.ps1')
    $manifest = @{ schema_version=1; server_url="$httpsOrigin/"; root_sha256=$material.RootSha256; root_thumbprint=$material.RootThumbprint; root_not_after=(Get-Item "Cert:\LocalMachine\My\$($material.RootThumbprint)").NotAfter.ToUniversalTime().ToString('o') }
    Write-LdsmPrivateJson (Join-Path $bundle 'conexion.json') $manifest
    $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($material.RootCerPath)
    try {
        if (-not (Test-HttpsRootInstalled $cert)) {
            $transaction.root_added = $true
            Write-LdsmPrivateJson $journalPath $transaction
            Add-HttpsTrustedRoot $cert | Out-Null
        }
        Test-HttpsServerHealth ([uri]"$httpsOrigin/")
    } finally { $cert.Dispose() }
    $zip = Join-Path $releasePath 'Conectar-equipo.zip'
    Compress-Archive -LiteralPath @((Join-Path $bundle 'rootCA.cer'),(Join-Path $bundle 'conexion.json'),(Join-Path $bundle 'Confiar-Equipo.ps1')) -DestinationPath $zip
    $newState = @{ schema_version=1; lan_ip=$LanIp; http_port=$HttpPort; https_port=$HttpsPort; release_path=$releasePath; override_sha256=(Get-FileHash -LiteralPath $script:overridePath -Algorithm SHA256).Hash; root_thumbprint=$material.RootThumbprint; root_sha256=$material.RootSha256; leaf_not_after=$material.LeafNotAfter.ToUniversalTime().ToString('o'); bundle_zip=$zip }
    Write-LdsmPrivateJson $script:statePath $newState
    $transaction.status = 'complete'
    Write-LdsmPrivateJson $journalPath $transaction
    Write-Host "LISTO: $httpsOrigin/" -ForegroundColor Green
    Write-Host "Para los otros PC, entrega UNICAMENTE: $zip"
    Write-Host "Confirma por otro medio esta huella: $($material.RootSha256)"
    Write-Host 'Nunca copies .https-lan completo: contiene claves del servidor y configuracion privada.'
    Write-Host 'El certificado dura un ano. Ejecuta -Renovar dentro de sus ultimos 30 dias; conserva la misma autoridad.'
} catch {
    $reason = $_.Exception.Message
    if ($transaction -and $transaction.status -eq 'pending') {
        try { Restore-HttpsTransaction $transaction $journalPath }
        catch {
            $transaction.status = 'failed'
            Write-LdsmPrivateJson $journalPath $transaction
            Write-Host 'RECUPERACION PENDIENTE. No borres .https-lan. Ejecuta -Restaurar con soporte.' -ForegroundColor Red
        }
    }
    Write-Host "NO COMPLETADO: $reason" -ForegroundColor Red
    throw $reason
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
    Pop-Location
}
}

if ($runAsEntryPoint) {
    try { Invoke-LdsmHttpsServer @entryArguments }
    catch { exit 1 }
}
