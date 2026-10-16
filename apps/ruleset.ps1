# Crea el ruleset de main en un repo de una cuenta u organizacion (uso unico).
# Normalmente lo llama apps\arranque.ps1 al final (con -SesionAbierta). Suelto sirve para relanzarlo
# y para repos de otras cuentas de la organizacion:
#   powershell -ExecutionPolicy Bypass -File <esta ruta> -Repo factory-am89/fabrica
# El dueno del repo y el usuario de la sesion de gh son cosas distintas: la sesion puede ser de
# cualquiera que sea ADMIN del repo, y la App revisora tiene que estar instalada en la cuenta DUENA.
# -ContextoTests es el nombre del check de tests que se exige (por defecto 'tests'); un workflow
# reutilizado puede publicarlo con otro nombre (p. ej. 'tests / tests'): se mira en un PR real antes.
# Suelto hace login y, siempre (tambien si falla), logout de gh; con -SesionAbierta usa la sesion del
# que lo llama y no la cierra. Requiere que main exista en origin. El check `revisor` se exige con el
# id de la App aunque aun no haya corrido (solo corre en PR). Se puede relanzar: si el ruleset existe, no lo toca. Textos sin tildes a proposito (Windows PowerShell 5.1
# lee un .ps1 sin BOM como ANSI).
param(
  [Parameter(Mandatory = $true)][string]$Repo,   # dueno/nombre: sin valor por defecto a proposito
  [string]$ContextoTests = 'tests',              # nombre del check de tests que se exige
  [string]$AppRevisor = 'fabrica-revisor',
  [string]$NombreRuleset = 'main',
  [switch]$SesionAbierta   # la sesion de gh es del script que me llama: ni login ni logout
)

$ErrorActionPreference = 'Continue'
$Usuario = $null   # usuario de la sesion de gh: se lee tras el login; NO tiene por que ser el dueno del repo
$IdGitHubActions = 15368   # integracion de GitHub Actions: origen del check `tests`

function Info($t)  { Write-Host "  $t" }
function Aviso($t) { Write-Host "  [!] $t" -ForegroundColor Yellow }
function Bien($t)  { Write-Host "  [ok] $t" -ForegroundColor Green }
. (Join-Path $PSScriptRoot 'lib-gh.ps1')

try { $Dueno = (Partir-Repo $Repo).Dueno } catch { Write-Host "  $($_.Exception.Message)" -ForegroundColor Red; exit 1 }   # cuenta duena del repo
$resultado = 'no llego a ejecutarse'
$fallo = $false
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Write-Host 'Falta gh.' -ForegroundColor Red; exit 1 }
if ($env:GH_TOKEN -or $env:GITHUB_TOKEN) {
  Write-Host '  [!] Quito GH_TOKEN/GITHUB_TOKEN solo para este script (impediria el login).' -ForegroundColor Yellow
  Remove-Item Env:GH_TOKEN, Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
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
  if ($u.Code -ne 0 -or -not $u.Out) { throw "No pude leer el usuario de la sesion de gh: $($u.Out)" }
  $Usuario = $u.Out

  # --- requisitos: la sesion es admin del repo (da igual de quien sea el repo) y main tiene commits ---
  Write-Host '=== Comprobaciones ===' -ForegroundColor Cyan
  $ad = Gh @('api', "repos/$Repo", '--jq', '.permissions.admin')
  if ($ad.Code -ne 0) { throw "No veo el repo $Repo con la sesion de '$Usuario': $($ad.Out)" }
  if ($ad.Out -ne 'true') { throw "La sesion de '$Usuario' no es administradora de $Repo (hace falta para crear el ruleset)." }
  Write-Host "  [ok] La sesion de '$Usuario' es admin de $Repo (dueno: $Dueno)."
  $b = Gh @('api', "repos/$Repo/branches/main", '--jq', '.name')
  if ($b.Code -ne 0) { throw "La rama main de $Repo no existe todavia: sube antes la v0 (git push -u origin main)." }

  # --- id de la App revisor, leido por API ---
  # GET /apps/<slug> da 404 si la App es privada, asi que se busca en las instalaciones de la sesion
  # (/user/installations trae app_id y app_slug). Solo cuenta una App instalada en la cuenta DUENA del repo
  # ($Dueno), no en la del usuario de la sesion: no se fija el ruleset con una App ajena.
  $idRevisor = $null
  $b = Buscar-App-Instalada $AppRevisor $Dueno
  if ($b.Estado -eq 'ok') {
    $idRevisor = $b.Id
  }
  else {
    if ($b.Estado -eq 'ninguna') { Write-Host "  [!] La App $AppRevisor no aparece instalada en la cuenta '$Dueno' entre las instalaciones de '$Usuario' (instalala en el repo: paso 4 de arranque.ps1; o usa el nombre real de tu App con -AppRevisor)." -ForegroundColor Yellow }
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
    $cuerpo = Cuerpo-Ruleset $NombreRuleset $ContextoTests $IdGitHubActions $idRevisor | ConvertTo-Json -Depth 10
    $c = Gh @('api', '-X', 'POST', "repos/$Repo/rulesets", '--input', '-') $cuerpo
    if ($c.Code -ne 0) { throw "GitHub rechazo el ruleset: $($c.Out)" }
    $v = Gh @('api', "repos/$Repo/rulesets")
    $jv = $null
    try { $jv = @($v.Out | ConvertFrom-Json) | Where-Object { $_.name -eq $NombreRuleset } | Select-Object -First 1 } catch { $jv = $null }
    if (-not $jv -or $jv.enforcement -ne 'active') { throw 'El ruleset no aparece activo tras crearlo.' }
    Write-Host '  [ok] Ruleset creado y activo: PR obligatorio, checks $ContextoTests y revisor, sin force push, sin borrado, sin bypass.' -ForegroundColor Green
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
    # Se cierra la sesion que abrio este script (la del usuario leido tras el login), no la del dueno del repo.
    if ($Usuario) { & gh.exe auth logout --hostname github.com --user $Usuario 2>&1 | Out-Null }
    else { & gh.exe auth logout --hostname github.com 2>&1 | Out-Null }
    & gh.exe auth status 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host '  [!] gh sigue con sesion: ejecuta  gh auth logout  a mano.' -ForegroundColor Yellow }
    else { Write-Host '  Sesion de gh cerrada.' -ForegroundColor Green }
  }
  Write-Host "Resumen: ruleset de main -> $resultado"
}
if ($fallo) { exit 1 }
exit 0
