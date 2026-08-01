[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$statusPath = Join-Path $ProjectRoot 'backups\last-success.env'
if (-not (Test-Path -LiteralPath $statusPath)) {
  throw 'No existe backups\last-success.env. Ejecuta primero un respaldo.'
}

$status = @{}
Get-Content -LiteralPath $statusPath | ForEach-Object {
  if ($_ -match '^(?<key>[^=]+)=(?<value>.*)$') {
    $status[$Matches.key] = $Matches.value
  }
}
foreach ($key in @('database', 'documents', 'manifest')) {
  if (-not $status[$key]) { throw "El estado del respaldo no contiene '$key'." }
  $candidate = Join-Path $ProjectRoot "backups\$($status[$key])"
  if (-not (Test-Path -LiteralPath $candidate)) { throw "Falta el archivo de respaldo: $($status[$key])" }
}

$projectEnv = @{}
Get-Content -LiteralPath (Join-Path $ProjectRoot '.env') | ForEach-Object {
  if ($_ -match '^(?<key>[A-Z0-9_]+)=(?<value>.*)$') {
    $projectEnv[$Matches.key] = $Matches.value.Trim('"')
  }
}

$suffix = [Guid]::NewGuid().ToString('N').Substring(0, 10)
$databaseContainer = "ldsm_restore_db_$suffix"
$backendContainer = "ldsm_restore_backend_$suffix"
$network = "ldsm_restore_net_$suffix"
$uploadsVolume = "ldsm_restore_uploads_$suffix"
$temporaryPassword = [Guid]::NewGuid().ToString('N') + 'Aa1!'
$databaseName = 'ldsm_restore_test'
$databaseUser = 'ldsm_restore'
$created = [System.Collections.Generic.List[string]]::new()

function Invoke-Docker {
  & docker @args
  if ($LASTEXITCODE -ne 0) { throw 'Una operación temporal de Docker falló. Revisa la salida inmediatamente anterior.' }
}

try {
  Write-Host 'Creando entorno de restauración completamente aislado...' -ForegroundColor Cyan
  Invoke-Docker network create $network | Out-Null
  $created.Add('network')
  Invoke-Docker volume create $uploadsVolume | Out-Null
  $created.Add('volume')
  Invoke-Docker run -d --name $databaseContainer --network $network `
    -e "POSTGRES_USER=$databaseUser" `
    -e "POSTGRES_PASSWORD=$temporaryPassword" `
    -e "POSTGRES_DB=$databaseName" `
    postgres:16-alpine | Out-Null
  $created.Add('database')

  $ready = $false
  foreach ($attempt in 1..40) {
    & docker exec $databaseContainer pg_isready -h 127.0.0.1 -U $databaseUser -d $databaseName *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'La base temporal no quedó disponible.' }
  Start-Sleep -Seconds 1

  $backupMount = (Join-Path $ProjectRoot 'backups')
  $restoreScript = (Join-Path $ProjectRoot 'backend\restore.sh')
  Invoke-Docker run --rm --network $network `
    -e "CONFIRM_RESTORE=SI_RESTAURAR" `
    -e "DB_HOST=$databaseContainer" `
    -e "DB_USER=$databaseUser" `
    -e "DB_NAME=$databaseName" `
    -e "PGPASSWORD=$temporaryPassword" `
    -e 'UPLOADS_DIR=/uploads' `
    -v "${backupMount}:/backups:ro" `
    -v "${restoreScript}:/restore.sh:ro" `
    -v "${uploadsVolume}:/uploads" `
    postgres:16-alpine sh /restore.sh `
    "/backups/$($status.database)" `
    "/backups/$($status.documents)" `
    "/backups/$($status.manifest)"

  $sourceCounts = & docker exec ldsm_db psql -U $projectEnv.DB_USER -d $projectEnv.DB_NAME -Atc `
    "SELECT json_build_object('alumnos',(SELECT count(*) FROM alumno),'matriculas',(SELECT count(*) FROM matricula),'registros',(SELECT count(*) FROM attendance_registrations),'visitas',(SELECT count(*) FROM visitas),'retiros',(SELECT count(*) FROM retiros_alumno),'usuarios',(SELECT count(*) FROM usuarios));"
  if ($LASTEXITCODE -ne 0) { throw 'No fue posible contar los registros de origen.' }
  $targetCounts = & docker exec -e "PGPASSWORD=$temporaryPassword" $databaseContainer psql -U $databaseUser -d $databaseName -Atc `
    "SELECT json_build_object('alumnos',(SELECT count(*) FROM alumno),'matriculas',(SELECT count(*) FROM matricula),'registros',(SELECT count(*) FROM attendance_registrations),'visitas',(SELECT count(*) FROM visitas),'retiros',(SELECT count(*) FROM retiros_alumno),'usuarios',(SELECT count(*) FROM usuarios));"
  if ($LASTEXITCODE -ne 0) { throw 'No fue posible contar los registros restaurados.' }
  if (($sourceCounts | ConvertFrom-Json | ConvertTo-Json -Compress) -ne ($targetCounts | ConvertFrom-Json | ConvertTo-Json -Compress)) {
    throw "Los conteos restaurados no coinciden. Origen=$sourceCounts Restaurado=$targetCounts"
  }

  $backendImage = (docker inspect ldsm_backend --format '{{.Config.Image}}').Trim()
  if (-not $backendImage) { throw 'No se pudo identificar la imagen vigente del backend.' }
  Invoke-Docker run -d --name $backendContainer --network $network `
    -e "DB_HOST=$databaseContainer" `
    -e "DB_USER=$databaseUser" `
    -e "DB_NAME=$databaseName" `
    -e "DB_PASSWORD=$temporaryPassword" `
    -e 'DB_PORT=5432' `
    -e "JWT_SECRET=$($projectEnv.JWT_SECRET)" `
    -e "DEFAULT_USER_PASSWORD=$($projectEnv.DEFAULT_USER_PASSWORD)" `
    -e 'CORS_ORIGIN=http://restore.local' `
    -e 'COOKIE_SECURE=false' `
    -e 'NODE_ENV=test' `
    -e 'STRICT_ENV_VALIDATION=false' `
    -e 'UPLOADS_DIR=/app/uploads' `
    -v "${uploadsVolume}:/app/uploads" `
    $backendImage | Out-Null
  $created.Add('backend')

  $backendReady = $false
  foreach ($attempt in 1..40) {
    & docker exec $backendContainer node -e "fetch('http://127.0.0.1:5000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" *> $null
    if ($LASTEXITCODE -eq 0) { $backendReady = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $backendReady) { throw 'El backend no inició correctamente sobre la restauración.' }

  $migrationCount = & docker exec -e "PGPASSWORD=$temporaryPassword" $databaseContainer psql -U $databaseUser -d $databaseName -Atc 'SELECT count(*) FROM schema_migrations;'
  $documentCount = & docker run --rm -v "${uploadsVolume}:/uploads:ro" alpine sh -c 'find /uploads -type f | wc -l'
  Write-Host 'Ensayo de restauración aprobado.' -ForegroundColor Green
  Write-Host "Conteos coincidentes: $targetCounts"
  Write-Host "Migraciones registradas: $migrationCount"
  Write-Host "Documentos restaurados: $documentCount"
  Write-Host 'El backend temporal respondió correctamente.'
} finally {
  if ($created.Contains('backend')) { & docker rm -f $backendContainer *> $null }
  if ($created.Contains('database')) { & docker rm -f $databaseContainer *> $null }
  if ($created.Contains('volume')) { & docker volume rm $uploadsVolume *> $null }
  if ($created.Contains('network')) { & docker network rm $network *> $null }
  Write-Host 'Entorno temporal eliminado; la instalación principal no fue modificada.' -ForegroundColor DarkGray
}
