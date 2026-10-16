# Pone un proyecto nuevo a trabajar con la Fabrica (lo lanza Pablo con SU sesion de gh, que debe ser admin del repo):
#   powershell -ExecutionPolicy Bypass -File <esta ruta> -Repo factory-am89/homenu-panel
# Hace, en este orden, y se puede relanzar (lo que ya esta hecho se salta):
#   2 el repo existe, tienes admin y main tiene commits   3 el plan admite rulesets (un repo privado con plan gratuito da 403: para)
#   4 fusion automatica y borrado de ramas al fusionar    5 environment `revisor` limitado a main
#   6 las Apps fabrica-constructor y fabrica-revisor estan instaladas en el repo (NO las instala: dice el clic que falta)
#   7 secretos del environment: dice cuales faltan por NOMBRE y como crearlos (nunca lee ni imprime un valor)
#   8 abre un PR con los workflows que llaman a los reutilizables de la Fabrica, un CLAUDE.md minimo y la ficha .fabrica.json
#   9 ruleset de main (lo crea ruleset.ps1)               10 comprueba que GitHub exige de verdad tests y revisor
# El ruleset espera a que el PR del paso 8 este fusionado: el check `revisor` solo corre si su workflow ya esta en main,
# asi que con el ruleset puesto antes ese PR no se podria fusionar nunca. Por eso el primer lanzamiento acaba en
# «pendiente: fusiona el PR» y el segundo, ya con los ficheros en main, crea el ruleset.
# Apps en «todos los repos» de la cuenta o repo a repo: valen las dos; el paso 6 solo mira que estan.
# Sale con 0 solo si todo esta hecho; con 1 si algo fallo o queda un pendiente (el resumen dice cual).
# Textos sin tildes a proposito (Windows PowerShell 5.1 lee un .ps1 sin BOM como ANSI).
param(
  [Parameter(Mandatory = $true)][string]$Repo,   # dueno/nombre: sin valor por defecto a proposito
  [string]$ContextoTests = '',                   # nombre del check de tests; vacio = el que GitHub ve en main
  [string]$AppConstructor = 'fabrica-constructor',
  [string]$AppRevisor = 'fabrica-revisor',
  [string]$Rama = 'ops/fabrica-inicial'          # rama del PR del paso 8
)

$ErrorActionPreference = 'Continue'
$Base = 'main'
$AbriSesion = $false
$Usuario = $null
$script:Hay = @{}   # estado de cada paso: ok | ya hecho | pendiente: ... | FALLO: ...
$script:Orden = @('2 Repo', '3 Plan (rulesets)', '4 Ajustes del repo', '5 Environment revisor', '6 Apps instaladas', '7 Secretos', '8 PR con los ficheros', '9 Ruleset de main', '10 Comprobacion final')
$script:Pendientes = @()

function Titulo($t) { Write-Host ''; Write-Host "=== $t ===" -ForegroundColor Cyan }
function Info($t)   { Write-Host "  $t" }
function Aviso($t)  { Write-Host "  [!] $t" -ForegroundColor Yellow }
function Bien($t)   { Write-Host "  [ok] $t" -ForegroundColor Green }
. (Join-Path $PSScriptRoot 'lib-gh.ps1')
. (Join-Path $PSScriptRoot 'lib-proyecto.ps1')

try { $null = Partir-Repo $Repo } catch { Write-Host "  $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
$Dueno = (Partir-Repo $Repo).Dueno
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Write-Host 'Falta gh.' -ForegroundColor Red; exit 1 }
if ($env:GH_TOKEN -or $env:GITHUB_TOKEN) {
  Aviso 'Quito GH_TOKEN/GITHUB_TOKEN solo para este script (impediria el login).'
  Remove-Item Env:GH_TOKEN, Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
}
$Plantillas = Join-Path $PSScriptRoot 'proyecto-nuevo'
$fallo = $false

# Un paso: su resultado (ok / ya hecho) o su pendiente quedan en el resumen; si lanza, el script para.
function Paso([string]$Nombre, [scriptblock]$Cuerpo) {
  Titulo $Nombre
  $r = & $Cuerpo
  $script:Hay[$Nombre] = [string](@($r)[-1])
  if ($script:Hay[$Nombre] -like 'pendiente*') { $script:Pendientes += "$Nombre -> $($script:Hay[$Nombre])" }
}

try {
  Titulo '1 Sesion de gh'
  & gh.exe auth status --hostname github.com 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Info 'Se abrira el navegador: copia el codigo que te da gh, pegalo y autoriza.'
    $AbriSesion = $true
    Gh-Login
    if ($LASTEXITCODE -ne 0) { throw 'gh auth login no termino bien.' }
  } else { Exigir-Workflow }
  $u = Gh @('api', 'user', '--jq', '.login')
  if ($u.Code -ne 0 -or -not $u.Out) { throw "No pude leer el usuario de la sesion de gh: $($u.Out)" }
  $Usuario = $u.Out
  Bien "Sesion de '$Usuario'."

  Paso '2 Repo' {
    $j = Leer-Repo $Repo
    if (-not $j.permissions -or $j.permissions.admin -ne $true) { throw "La sesion de '$Usuario' no es administradora de $Repo (hace falta para ajustes, environment y ruleset)." }
    if ($Dueno -ne 'factory-am89') { throw "La ficha .fabrica.json usa la identidad fabrica-constructor, que solo vale en repos de factory-am89; $Repo no vale." }
    $b = Gh @('api', "repos/$Repo/branches/$Base", '--jq', '.name')
    if ($b.Code -ne 0) { throw "La rama $Base de $Repo no existe todavia: sube antes un primer commit." }
    Bien "$Repo existe, la sesion es admin y $Base tiene commits."
    'ok'
  }
  Paso '3 Plan (rulesets)' { Comprobar-Rulesets-Disponibles $Repo; Bien 'El plan admite rulesets en este repo.'; 'ok' }
  Paso '4 Ajustes del repo' { $r = Asegurar-Ajustes-Repo $Repo; Bien 'Fusion automatica y borrado de ramas al fusionar activados.'; $r }
  Paso '5 Environment revisor' { $r = Asegurar-Environment-Revisor $Repo; Bien 'Environment revisor limitado a la rama main.'; $r }

  Paso '6 Apps instaladas' {
    $faltan = @()
    foreach ($app in @($AppConstructor, $AppRevisor)) {
      $e = Estado-App-En-Repo $app $Repo
      $clic = Clic-App-Que-Falta $app $e $Repo
      if ($clic) { Aviso $clic; $faltan += $app } else { Bien "App $app instalada en $Repo ($($e.Estado))." }
    }
    if ($faltan.Count -gt 0) { return "pendiente: falta instalar $($faltan -join ' y ') (el clic esta arriba; este script no instala Apps ni amplia permisos)" }
    'ok'
  }

  Paso '7 Secretos' {
    $faltan = @(Secretos-Que-Faltan $Repo)
    if ($faltan.Count -eq 0) { Bien 'Estan los tres secretos del environment revisor.'; return 'ya hecho' }
    foreach ($n in $faltan) { Aviso "Falta el secreto $n. Crealo asi:"; Info "  $(Texto-Crear-Secreto $n $Repo)" }
    "pendiente: faltan los secretos $($faltan -join ', ')"
  }

  $faltanFicheros = @()
  Paso '8 PR con los ficheros' {
    $script:faltanFicheros = @(Archivos-Que-Faltan $Repo $Base)
    if ($script:faltanFicheros.Count -eq 0) { Bien "Los workflows, CLAUDE.md y .fabrica.json ya estan en $Base."; return 'ya hecho' }
    Info "Faltan en ${Base}: $($script:faltanFicheros -join ', ')"
    $pr = Abrir-Pr-Inicial $Repo $Base $Rama $Plantillas $script:faltanFicheros
    Bien "PR $($pr.Estado): $($pr.Url)"
    "pendiente: fusiona el PR $($pr.Url) (el revisor aun no puede juzgarlo: su workflow no esta en main) y relanza este script"
  }

  Paso '9 Ruleset de main' {
    $bloqueos = @($script:Pendientes | Where-Object { $_ -notlike '7 *' })
    if ($bloqueos.Count -gt 0) { return 'pendiente: no se intenta hasta resolver los pasos 6 y 8 de arriba' }
    $ctx = $ContextoTests
    if (-not $ctx) {
      $ctx = Contexto-Tests-Observado $Repo $Base
      if (-not $ctx) { return "pendiente: el check tests aun no ha corrido en $Base; espera a que acabe y relanza (o pasa -ContextoTests con su nombre exacto)" }
      Info "Check de tests tal como lo ve GitHub: '$ctx'."
    }
    $script:Contexto = $ctx
    & (Join-Path $PSScriptRoot 'ruleset.ps1') -Repo $Repo -ContextoTests $ctx -AppRevisor $AppRevisor -SesionAbierta
    if ($LASTEXITCODE -ne 0) { throw 'ruleset.ps1 fallo (mira el mensaje de arriba). Se puede relanzar suelto: apps\ruleset.ps1' }
    'ok'
  }

  Paso '10 Comprobacion final' {
    if (-not $script:Contexto) { return 'pendiente: sin ruleset todavia' }
    Comprobar-Reglas-De-Main $Repo $Base $script:Contexto
    Bien "GitHub exige '$($script:Contexto)' y 'revisor' en $Base."
    'ok'
  }
}
catch {
  $fallo = $true
  $script:Hay['FALLO'] = "FALLO: $($_.Exception.Message)"
  Write-Host ''
  Write-Host "PARADO: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Arregla lo que dice y relanza el script: lo ya hecho se salta.' -ForegroundColor Red
}
finally {
  Titulo 'Cierre'
  if (-not $AbriSesion) { Info 'La sesion de gh ya existia antes de este script: no la cierro.' }
  else {
    if ($Usuario) { & gh.exe auth logout --hostname github.com --user $Usuario 2>&1 | Out-Null }
    else { & gh.exe auth logout --hostname github.com 2>&1 | Out-Null }
    Info 'Sesion de gh cerrada.'
  }
  Titulo 'Resumen'
  foreach ($k in $script:Orden) {
    $v = if ($script:Hay.ContainsKey($k)) { $script:Hay[$k] } else { 'no llego a ejecutarse' }
    $col = if ($v -eq 'ok') { 'Green' } elseif ($v -eq 'ya hecho') { 'DarkGreen' } elseif ($v -like 'pendiente*') { 'Yellow' } else { 'Red' }
    Write-Host ("  {0,-26} {1}" -f $k, $v) -ForegroundColor $col
  }
  if ($script:Hay.ContainsKey('FALLO')) { Write-Host "  $($script:Hay['FALLO'])" -ForegroundColor Red }
}
if ($fallo -or $script:Pendientes.Count -gt 0) { exit 1 }
exit 0
