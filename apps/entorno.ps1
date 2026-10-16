# Deja un environment de un repo limitado a la rama main y lo comprueba (lo llama apps/convertir.mjs).
# Uso: powershell -File apps/entorno.ps1 -Repo factory-am89/fabrica -Nombre administrador
# Sale con 1 si no puede o si el environment no queda limitado a main. Sin tildes a proposito (PS 5.1).
param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [Parameter(Mandatory = $true)][string]$Nombre
)
$ErrorActionPreference = 'Continue'
function Info($t)  { Write-Host "  $t" }
function Aviso($t) { Write-Host "  [!] $t" -ForegroundColor Yellow }
function Bien($t)  { Write-Host "  [ok] $t" -ForegroundColor Green }
. (Join-Path $PSScriptRoot 'lib-gh.ps1')
try { $r = Asegurar-Environment-Limitado $Repo $Nombre; Bien "Environment $Nombre limitado a main ($r)." }
catch { Write-Host "  $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
