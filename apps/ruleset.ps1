# Crea el ruleset de main en fabrica (uso unico).
# Normalmente lo llama apps\arranque.ps1 al final (con -SesionAbierta). Suelto sirve para relanzarlo:
#   powershell -ExecutionPolicy Bypass -File <esta ruta>
# Suelto hace login y, siempre (tambien si falla), logout de gh; con -SesionAbierta usa la sesion del
# que lo llama y no la cierra. Requiere que main exista en origin. El check `revisor` se exige con el
# id de la App aunque aun no haya corrido (solo corre en PR). Se puede relanzar: si el ruleset existe, no lo toca. Textos sin tildes a proposito (Windows PowerShell 5.1
# lee un .ps1 sin BOM como ANSI).
param(
  [string]$Repo = 'factory-am89/fabrica',
  [string]$AppRevisor = 'fabrica-revisor',
  [string]$NombreRuleset = 'main',
  [switch]$SesionAbierta   # la sesion de gh es del script que me llama: ni login ni logout
)

$ErrorActionPreference = 'Continue'
$Dueno = ($Repo -split '/')[0]
$IdGitHubActions = 15368   # integracion de GitHub Actions: origen del check `tests`

function Info($t)  { Write-Host "  $t" }
function Aviso($t) { Write-Host "  [!] $t" -ForegroundColor Yellow }
function Bien($t)  { Write-Host "  [ok] $t" -ForegroundColor Green }
. (Join-Path $PSScriptRoot 'lib-gh.ps1')

$resultado = 'no llego a ejecutarse'
$fallo = $false
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Write-Host 'Falta gh.' -ForegroundColor Red; exit 1 }
if ($env:GH_TOKEN -or $env:GITHUB_TOKEN) {
  Write-Host '  [!] Quito GH_TOKEN/GITHUB_TOKEN solo para este script (impediria el login).' -ForegroundColor Yellow
  Remove-Item Env:GH_TOKEN, Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
}

& gh.exe auth status --hostname github.com 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
  $q = (& gh.exe api user --jq .login 2>$null | Out-String).Trim()
  if ($q -ne $Dueno) {
    Write-Host "  Ya hay una sesion de gh abierta como '$q' (no como '$Dueno'). No la toco: cierrala tu (gh auth logout) o usa otro terminal, y vuelve a lanzar." -ForegroundColor Red
    exit 1
  }
}

try {
  # --- login ---
  Write-Host '=== Sesion de gh ===' -ForegroundColor Cyan
  & gh.exe auth status --hostname github.com 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host '  Se abrira el navegador: copia el codigo que te da gh, pegalo y autoriza.'
    Gh-Login
    if ($LASTEXITCODE -ne 0) { throw 'gh auth login no termino bien.' }
  }
  $u = Gh @('api', 'user', '--jq', '.login')
  if ($u.Code -ne 0 -or $u.Out -ne $Dueno) { throw "La sesion es de '$($u.Out)' y deberia ser '$Dueno'." }

  # --- requisitos: main con commits ---
  Write-Host '=== Comprobaciones ===' -ForegroundColor Cyan
  $b = Gh @('api', "repos/$Repo/branches/main", '--jq', '.name')
  if ($b.Code -ne 0) { throw "La rama main de $Repo no existe todavia: sube antes la v0 (git push -u origin main)." }

  # --- id de la App revisor, leido por API ---
  # GET /apps/<slug> da 404 si la App es privada, asi que se busca en las instalaciones de la sesion
  # (/user/installations trae app_id y app_slug). Solo se fija con una App instalada en la cuenta de $Dueno.
  $idRevisor = $null
  $b = Buscar-App-Instalada $AppRevisor
  if ($b.Estado -eq 'ok') {
    if ($b.Cuenta -ine $Dueno) { throw "La App '$AppRevisor' esta instalada en '$($b.Cuenta)', no en $Dueno. No fijo el ruleset con una App ajena: usa el nombre real de tu App con -AppRevisor." }
    $idRevisor = $b.Id
  }
  else {
    if ($b.Estado -eq 'ninguna') { Write-Host "  [!] La App $AppRevisor no aparece entre tus instalaciones (esta instalada en el repo? Es el paso 4 de arranque.ps1)." -ForegroundColor Yellow }
    else { Write-Host "  [!] No pude leer tus instalaciones de Apps en GitHub." -ForegroundColor Yellow }
    Write-Host "      Lo ves en https://github.com/settings/apps/$AppRevisor (App ID: un numero de 7 cifras, no el Client ID que empieza por Iv23; no es secreto; comprueba que la App es tuya)."
    $t = (Read-Host '  Escribe el App ID del revisor, solo numeros (vacio para cancelar)').Trim()
    if ($t -notmatch '^\d+$') { throw 'Sin el App ID (un numero, no el Iv23...) no se puede fijar el origen del check.' }
    $idRevisor = [int]$t
  }
  Write-Host "  [ok] App $AppRevisor con id $idRevisor."

  # --- ruleset (idempotente) ---
  Write-Host '=== Ruleset ===' -ForegroundColor Cyan
  $l = Gh @('api', "repos/$Repo/rulesets", '--jq', '.[].name')
  if ($l.Code -ne 0) { throw "No pude listar los rulesets: $($l.Out)" }
  if (($l.Out -split "`n" | ForEach-Object { $_.Trim() }) -contains $NombreRuleset) {
    Write-Host "  El ruleset '$NombreRuleset' ya existe: no lo toco." -ForegroundColor DarkGreen
    $resultado = 'ya hecho'
  } else {
    # Sin regla "update" (Restrict updates) y sin bypass_actors: nadie salta el ruleset.
    $cuerpo = [ordered]@{
      name          = $NombreRuleset
      target        = 'branch'
      enforcement   = 'active'
      conditions    = @{ ref_name = @{ include = @('~DEFAULT_BRANCH'); exclude = @() } }
      bypass_actors = @()
      rules         = @(
        @{ type = 'pull_request'; parameters = @{
            required_approving_review_count   = 0
            dismiss_stale_reviews_on_push     = $false
            require_code_owner_review         = $false
            require_last_push_approval        = $false
            required_review_thread_resolution = $false } },
        @{ type = 'required_status_checks'; parameters = @{
            strict_required_status_checks_policy = $false
            required_status_checks = @(
              @{ context = 'tests';   integration_id = $IdGitHubActions },
              @{ context = 'revisor'; integration_id = $idRevisor }) } },
        @{ type = 'non_fast_forward' },
        @{ type = 'deletion' }
      )
    } | ConvertTo-Json -Depth 10
    $c = Gh @('api', '-X', 'POST', "repos/$Repo/rulesets", '--input', '-') $cuerpo
    if ($c.Code -ne 0) { throw "GitHub rechazo el ruleset: $($c.Out)" }
    $v = Gh @('api', "repos/$Repo/rulesets")
    $jv = $null
    try { $jv = @($v.Out | ConvertFrom-Json) | Where-Object { $_.name -eq $NombreRuleset } | Select-Object -First 1 } catch { $jv = $null }
    if (-not $jv -or $jv.enforcement -ne 'active') { throw 'El ruleset no aparece activo tras crearlo.' }
    Write-Host '  [ok] Ruleset creado y activo: PR obligatorio, checks tests y revisor, sin force push, sin borrado, sin bypass.' -ForegroundColor Green
    $resultado = 'ok'
  }
}
catch {
  $fallo = $true
  $resultado = 'FALLO: ' + $_.Exception.Message
  Write-Host ''
  Write-Host "PARADO: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
  Write-Host '=== Cierre ===' -ForegroundColor Cyan
  if ($SesionAbierta) { Write-Host '  La sesion de gh es de quien me llamo: no la cierro aqui.' }
  else {
    & gh.exe auth logout --hostname github.com --user $Dueno 2>&1 | Out-Null
    & gh.exe auth status 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host '  [!] gh sigue con sesion: ejecuta  gh auth logout  a mano.' -ForegroundColor Yellow }
    else { Write-Host '  Sesion de gh cerrada.' -ForegroundColor Green }
  }
  Write-Host "Resumen: ruleset de main -> $resultado"
}
if ($fallo) { exit 1 }
exit 0
