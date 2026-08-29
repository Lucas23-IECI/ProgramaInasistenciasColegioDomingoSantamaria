[CmdletBinding()]
param(
  [switch]$IncluirRestauracion,
  [string]$PlanillaErp = ""
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$Root = Split-Path -Parent $PSScriptRoot

function Invoke-Step([string]$Name, [scriptblock]$Action) {
  Write-Host "`n== $Name ==" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "Fallo: $Name" }
}

function Invoke-CommandChecked([string]$Name, [scriptblock]$Action) {
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "Fallo el comando: $Name" }
}

Push-Location $Root
try {
  Invoke-Step 'Estado de contenedores' { docker compose ps }
  Invoke-Step 'Backend: sintaxis y pruebas' {
    Push-Location backend
    try {
      Invoke-CommandChecked 'backend check' { npm run check }
      Invoke-CommandChecked 'backend test con cobertura mínima' { npm run test:coverage }
    } finally { Pop-Location }
  }
  Invoke-Step 'Frontend: lint, unitarias y compilacion' {
    Push-Location frontend
    try {
      Invoke-CommandChecked 'frontend lint' { npm run lint }
      Invoke-CommandChecked 'frontend test con cobertura mínima' { npm run test:coverage }
      Invoke-CommandChecked 'frontend build' { npm run build }
      Invoke-CommandChecked 'frontend performance' { npm run test:performance }
    } finally { Pop-Location }
  }
  Invoke-Step 'Docker: reconstruccion del codigo validado' {
    Invoke-CommandChecked 'reconstruccion Docker' { docker compose up -d --build --wait }
  }
  Invoke-Step 'Frontend: flujos criticos E2E' {
    Push-Location frontend
    try {
      # Un solo worker evita que varios navegadores compitan por Docker y por
      # los mismos registros de verificación en equipos institucionales modestos.
      Invoke-CommandChecked 'frontend E2E' { npm run test:e2e -- --workers=1 }
    } finally { Pop-Location }
  }
  Invoke-Step 'Base y archivos: integridad de solo lectura' {
    Invoke-CommandChecked 'integridad de datos' { docker compose exec -T backend npm run test:data-integrity }
  }
  Invoke-Step 'Actualizacion por pull: contrato operativo' {
    $contracts = @(
      @{ Path = 'scripts\preparar-servidor-recomendado.ps1'; Patterns = @('preparar-https-red-interna\.ps1', 'Set-DatabaseRolePassword', 'instalar-actualizacion-por-pull\.ps1') },
      @{ Path = 'scripts\actualizar-servidor.ps1'; Patterns = @('respaldo-ahora\.ps1', 'docker compose @ComposeFiles build', '--wait-timeout 180', 'untracked-files=normal', 'verificar-produccion\.ps1') },
      @{ Path = 'scripts\instalar-actualizacion-por-pull.ps1'; Patterns = @('branch.*main', 'actualizar-servidor\.ps1') },
      @{ Path = 'scripts\estado.ps1'; Patterns = @('requiredServices', "healthState -ne 'healthy'", 'TotalHours -gt 26', 'Length -le 0') },
      @{ Path = 'scripts\verificar-produccion.ps1'; Patterns = @("StartType -eq 'Automatic'", "Status -eq 'Running'", 'docker info') }
    )
    foreach ($contract in $contracts) {
      $source = Get-Content -LiteralPath (Join-Path $Root $contract.Path) -Raw
      foreach ($pattern in $contract.Patterns) {
        if ($source -notmatch $pattern) { throw "Contrato ausente en $($contract.Path): $pattern" }
      }
    }
    Write-Host 'Preparacion, respaldo, rama main, build y verificacion permanecen conectados.'
  }
  Invoke-Step 'Planilla ERP oficial: previsualizacion' {
    Push-Location frontend
    try {
      if ([string]::IsNullOrWhiteSpace($PlanillaErp)) {
        Write-Host 'Omitida: no se indicó una planilla mediante -PlanillaErp. No se usarán datos institucionales implícitamente.' -ForegroundColor Yellow
        return
      }
      if (-not (Test-Path -LiteralPath $PlanillaErp)) {
        throw "No se encontro la planilla ERP: $PlanillaErp. Use -PlanillaErp para indicar otra ruta."
      }
      Invoke-CommandChecked 'previsualizacion ERP oficial' { npm run test:official-erp-preview -- $PlanillaErp }
    } finally { Pop-Location }
  }
  Invoke-Step 'Auditoria de dependencias aplicable' {
    Push-Location backend
    try { Invoke-CommandChecked 'auditoria backend' { npm audit --omit=dev --audit-level=high } } finally { Pop-Location }
    Push-Location frontend
    try { Invoke-CommandChecked 'auditoria frontend' { npm run audit:security } } finally { Pop-Location }
  }
  if ($IncluirRestauracion) {
    Invoke-Step 'Restauracion aislada del ultimo respaldo' { & "$PSScriptRoot\probar-restauracion.ps1" }
  }
  Write-Host "`nVALIDACION LOCAL APROBADA" -ForegroundColor Green
} finally {
  Pop-Location
}
