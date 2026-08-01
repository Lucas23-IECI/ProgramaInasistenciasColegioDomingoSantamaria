[CmdletBinding()]
param(
  [switch]$IncluirRestauracion,
  [string]$PlanillaErp = ""
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$Root = Split-Path -Parent $PSScriptRoot
$Downloads = Split-Path -Parent (Split-Path -Parent $Root)

if ([string]::IsNullOrWhiteSpace($PlanillaErp)) {
  $PlanillaErp = Join-Path $Downloads 'usuarios_actualizar_Liceo Domingo Santa Maria_20260602.xlsx'
}

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
      Invoke-CommandChecked 'backend test' { npm test }
    } finally { Pop-Location }
  }
  Invoke-Step 'Frontend: lint, unitarias y compilacion' {
    Push-Location frontend
    try {
      Invoke-CommandChecked 'frontend lint' { npm run lint }
      Invoke-CommandChecked 'frontend test' { npm test }
      Invoke-CommandChecked 'frontend build' { npm run build }
      Invoke-CommandChecked 'frontend performance' { npm run test:performance }
    } finally { Pop-Location }
  }
  Invoke-Step 'Frontend: flujos criticos E2E' {
    Push-Location frontend
    try { Invoke-CommandChecked 'frontend E2E' { npm run test:e2e } } finally { Pop-Location }
  }
  Invoke-Step 'Planilla ERP oficial: previsualizacion' {
    Push-Location frontend
    try {
      if (-not (Test-Path -LiteralPath $PlanillaErp)) {
        throw "No se encontro la planilla ERP: $PlanillaErp. Use -PlanillaErp para indicar otra ruta."
      }
      Invoke-CommandChecked 'previsualizacion ERP oficial' { npm run test:official-erp-preview -- $PlanillaErp }
    } finally { Pop-Location }
  }
  Invoke-Step 'Auditoria de dependencias aplicable' {
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
