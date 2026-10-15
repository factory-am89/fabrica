# Crea el ruleset de main en fabrica (uso unico).
# Lanzar DESPUES de subir la v0 y de que el check `revisor` haya corrido al menos una vez.
# Lo lanza Pablo:  powershell -ExecutionPolicy Bypass -File <esta ruta>
# Hace login y, siempre (tambien si falla), logout de gh. Se puede relanzar: si el
# ruleset existe, no lo toca. Textos sin tildes a proposito (Windows PowerShell 5.1
# lee un .ps1 sin BOM como ANSI).
param(
  [string]$Repo = 'pabloam89/fabrica',
  [string]$AppRevisor = 'fabrica-revisor',
  [string]$NombreRuleset = 'main'
)

$ErrorActionPreference = 'Continue'
$Dueno = ($Repo -split '/')[0]
$IdGitHubActions = 15368   # integracion de GitHub Actions: origen del check `tests`

function Gh([string[]]$A, [string]$Entrada) {
  if ($PSBoundParameters.ContainsKey('Entrada')) { $o = $Entrada | & gh @A 2>&1 | Out-String }
  else { $o = & gh @A 2>&1 | Out-String }
  [pscustomobject]@{ Code = $LASTEXITCODE; Out = $o.Trim() }
}

$resultado = 'no llego a ejecutarse'
$fallo = $false
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Write-Host 'Falta gh.' -ForegroundColor Red; exit 1 }
if ($env:GH_TOKEN -or $env:GITHUB_TOKEN) {
  Write-Host '  [!] Quito GH_TOKEN/GITHUB_TOKEN solo para este script (impediria el login).' -ForegroundColor Yellow
  Remove-Item Env:GH_TOKEN, Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
}

& gh auth status --hostname github.com 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
  $q = (& gh api user --jq .login 2>$null | Out-String).Trim()
  if ($q -ne $Dueno) {
    Write-Host "  Ya hay una sesion de gh abierta como '$q' (no como '$Dueno'). No la toco: cierrala tu (gh auth logout) o usa otro terminal, y vuelve a lanzar." -ForegroundColor Red
    exit 1
  }
}

try {
  # --- login ---
  Write-Host '=== Sesion de gh ===' -ForegroundColor Cyan
  & gh auth status --hostname github.com 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host '  Se abrira el navegador: copia el codigo que te da gh, pegalo y autoriza.'
    & gh auth login --hostname github.com --git-protocol https --web --scopes repo --skip-ssh-key
    if ($LASTEXITCODE -ne 0) { throw 'gh auth login no termino bien.' }
  }
  $u = Gh @('api', 'user', '--jq', '.login')
  if ($u.Code -ne 0 -or $u.Out -ne $Dueno) { throw "La sesion es de '$($u.Out)' y deberia ser '$Dueno'." }

  # --- requisitos: main con commits ---
  Write-Host '=== Comprobaciones ===' -ForegroundColor Cyan
  $b = Gh @('api', "repos/$Repo/branches/main", '--jq', '.name')
  if ($b.Code -ne 0) { throw "La rama main de $Repo no existe todavia: sube antes la v0 (git push -u origin main)." }

  # --- id de la App revisor, leido por API ---
  $a = Gh @('api', "apps/$AppRevisor")
  $idRevisor = $null
  $ja = $null
  if ($a.Code -eq 0) { try { $ja = $a.Out | ConvertFrom-Json } catch { $ja = $null } }
  if ($ja -and $ja.id) {
    if ([string]$ja.owner.login -ine $Dueno) { throw "La App '$AppRevisor' es de '$($ja.owner.login)', no de $Dueno. No fijo el ruleset con una App ajena: usa el nombre real de tu App con -AppRevisor." }
    $idRevisor = [int]$ja.id
  }
  else {
    Write-Host "  [!] La API no me dio la App $AppRevisor ($($a.Out))." -ForegroundColor Yellow
    Write-Host "      Lo ves en https://github.com/settings/apps/$AppRevisor (App ID, es un numero y no es secreto; comprueba que la App es tuya)."
    $t = (Read-Host '  Escribe el App ID del revisor (vacio para cancelar)').Trim()
    if ($t -notmatch '^\d+$') { throw 'Sin id de la App revisor no se puede fijar el origen del check.' }
    $idRevisor = [int]$t
  }
  Write-Host "  [ok] App $AppRevisor con id $idRevisor."

  # Aviso (no bloquea): el check revisor deberia haber corrido ya en algun commit.
  $cr = Gh @('api', "repos/$Repo/commits/main/check-runs", '--jq', '.check_runs[].name')
  if ($cr.Code -eq 0 -and (@($cr.Out -split "`n" | ForEach-Object { $_.Trim() }) -notcontains 'revisor')) {
    Write-Host '  [!] En el ultimo commit de main aun no veo el check revisor. Si el ruleset lo exige y nunca corre, bloquea los PR.' -ForegroundColor Yellow
  }

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
  & gh auth logout --hostname github.com --user $Dueno 2>&1 | Out-Null
  & gh auth status 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Write-Host '  [!] gh sigue con sesion: ejecuta  gh auth logout  a mano.' -ForegroundColor Yellow }
  else { Write-Host '  Sesion de gh cerrada.' -ForegroundColor Green }
  Write-Host "Resumen: ruleset de main -> $resultado"
}
if ($fallo) { exit 1 }
