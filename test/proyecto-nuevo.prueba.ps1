# Prueba de apps\proyecto-nuevo.ps1 en Windows PowerShell 5.1 con un gh FALSO con estado: no toca GitHub (lo lanza
# test/proyecto-nuevo.test.js). Imprime una linea "OK: ..." por comprobacion; si falla, "FALLO: ...".
param([string]$Script)
$ErrorActionPreference = 'Continue'
$RP = 'factory-am89/homenu-panel'
$global:ArgsLog = New-Object System.Collections.ArrayList
$global:E = $null

function Nuevo-Estado {
  @{
    privado = $false; planGratis403 = $false; admin = $true; sinMain = $false
    auto = $false; borrar = $false
    env = $false; policies = @()
    instalaciones = @(
      @{ id = 1; app_slug = 'fabrica-constructor'; repository_selection = 'all'; account = @{ login = 'factory-am89' } },
      @{ id = 2; app_slug = 'fabrica-revisor'; repository_selection = 'all'; account = @{ login = 'factory-am89' } })
    reposDe = @{}
    secretos = @('CLAUDE_CODE_OAUTH_TOKEN', 'REVISOR_CLIENT_ID', 'REVISOR_APP_KEY')
    enMain = @('.github/workflows/tests.yml', '.github/workflows/revisor.yml', 'CLAUDE.md', '.fabrica.json')
    enRama = @(); ramaCreada = $false; prAbierto = $false
    checks = @('tests / tests')
    rulesets = @(); cuerpoRuleset = $null
    rompe = @{}   # patron de ruta -> @{ Texto; Codigo }: respuesta ilegible o llamada fallida
  }
}

function Json($o) { ConvertTo-Json -InputObject $o -Depth 10 -Compress }

# Cada llamada se anota; las que cambian algo (-X PATCH/PUT/POST) tambien se cuentan aparte.
function gh.exe {
  $a = @($args)
  $cuerpo = $null
  if ($MyInvocation.ExpectingInput) { $cuerpo = ($input | Out-String) }
  [void]$global:ArgsLog.Add(($a -join ' '))
  $global:LASTEXITCODE = 0
  $e = $global:E
  $ruta = if ($a[0] -eq 'api') { ($a | Where-Object { $_ -match '^(repos/|/user|user$)' } | Select-Object -First 1) } else { '' }
  $metodo = if ($a -contains '-X') { $a[[array]::IndexOf($a, '-X') + 1] } else { 'GET' }
  $jq = $a -contains '--jq'
  function Falla([string]$t) { $global:LASTEXITCODE = 1; $t }
  if ($a[0] -eq 'auth') { return }
  foreach ($k in @($e.rompe.Keys)) { if ($ruta -like $k -and -not $jq) { $global:LASTEXITCODE = $e.rompe[$k].Codigo; return $e.rompe[$k].Texto } }
  if ($ruta -eq 'user' -and $a -contains '-i') { return "HTTP/2.0 200 OK`r`nX-OAuth-Scopes: repo, workflow`r`n`r`n{}" }
  if ($ruta -eq 'user') { return 'pablo' }
  if ($ruta -eq "repos/$RP" -and $metodo -eq 'PATCH') { $e.auto = $true; $e.borrar = $true; return '{}' }
  if ($ruta -eq "repos/$RP") {
    if ($jq) { return $(if ($e.admin) { 'true' } else { 'false' }) }
    return (Json @{ private = $e.privado; allow_auto_merge = $e.auto; delete_branch_on_merge = $e.borrar; permissions = @{ admin = $e.admin } })
  }
  if ($ruta -eq "repos/$RP/branches/main") { if ($e.sinMain) { return (Falla 'Not Found') }; return 'main' }
  if ($ruta -eq "repos/$RP/rulesets" -and $metodo -eq 'POST') { $e.cuerpoRuleset = $cuerpo; $e.rulesets += 'main'; return '{}' }
  if ($ruta -eq "repos/$RP/rulesets") {
    if ($e.planGratis403) { return (Falla 'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)') }
    if ($jq) { return ($e.rulesets -join "`n") }
    return (Json @($e.rulesets | ForEach-Object { @{ name = $_; enforcement = 'active' } }))
  }
  if ($ruta -eq "repos/$RP/environments/revisor" -and $metodo -eq 'PUT') { $e.env = $true; return '{}' }
  if ($ruta -eq "repos/$RP/environments/revisor") { if ($e.env) { return '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' }; return (Falla 'Not Found') }
  if ($ruta -eq "repos/$RP/environments/revisor/deployment-branch-policies" -and $metodo -eq 'POST') { if (-not $e.politicaIgnorada) { $e.policies += 'main' }; return '{}' }
  if ($ruta -eq "repos/$RP/environments/revisor/deployment-branch-policies") { return (Json @{ branch_policies = @($e.policies | ForEach-Object { @{ name = $_; type = 'branch' } }) }) }
  if ($ruta -eq "repos/$RP/environments/revisor/secrets") { return (Json @{ secrets = @($e.secretos | ForEach-Object { @{ name = $_ } }) }) }
  if ($ruta -like '/user/installations?per_page*') { return (Json @{ installations = $e.instalaciones }) }
  if ($ruta -match '^/user/installations/(\d+)/repositories') { return (Json @{ repositories = @($e.reposDe[[int]$Matches[1]] | ForEach-Object { @{ full_name = $_ } }) }) }
  if ($ruta -like "repos/$RP/contents/*" -and $metodo -eq 'PUT') { $p = ($ruta -replace "^repos/$RP/contents/", ''); $e.enRama += $p; return '{}' }
  if ($ruta -like "repos/$RP/contents/*") {
    $p = ($ruta -replace "^repos/$RP/contents/", '') -replace '\?ref=.*$', ''
    $rama = ($ruta -replace '^.*\?ref=', '')
    $donde = if ($rama -eq 'main') { $e.enMain } else { $e.enRama }
    if ($donde -contains $p) { return '{"sha":"abc"}' }
    return (Falla 'gh: Not Found (HTTP 404)')
  }
  if ($ruta -like "repos/$RP/pulls?*") { if ($e.prAbierto) { return (Json @(@{ html_url = "https://github.com/$RP/pull/1" })) }; return '[]' }
  if ($ruta -eq "repos/$RP/pulls" -and $metodo -eq 'POST') { $e.prAbierto = $true; return (Json @{ html_url = "https://github.com/$RP/pull/1" }) }
  if ($ruta -eq "repos/$RP/git/ref/heads/main") { return '{"object":{"sha":"0123456789012345678901234567890123456789"}}' }
  if ($ruta -eq "repos/$RP/git/refs") { if ($e.ramaCreada) { return (Falla 'Reference already exists') }; $e.ramaCreada = $true; return '{}' }
  if ($ruta -like "repos/$RP/commits/main/check-runs*") { return (Json @{ check_runs = @($e.checks | ForEach-Object { @{ name = $_ } }) }) }
  if ($ruta -eq "repos/$RP/rules/branches/main") {
    if (-not $e.cuerpoRuleset) { return '[]' }
    $c = $e.cuerpoRuleset | ConvertFrom-Json
    $rs = @($c.rules | Where-Object { $_.type -eq 'required_status_checks' })
    return (Json @(@{ type = 'required_status_checks'; parameters = @{ required_status_checks = @($rs[0].parameters.required_status_checks | ForEach-Object { @{ context = $_.context } }) } }))
  }
  return (Falla "gh falso: no conozco $($a -join ' ')")
}

function Lanza([hashtable]$Estado, [hashtable]$Extra = @{}) {
  $global:E = $Estado
  $global:ArgsLog.Clear()
  $salida = (& $Script -Repo $RP @Extra *>&1 | Out-String)
  [pscustomobject]@{ Code = $LASTEXITCODE; Out = $salida; Muta = @($global:ArgsLog | Where-Object { $_ -match '-X (PATCH|PUT|POST)' }) }
}
function Prueba([string]$n, [bool]$ok) { if ($ok) { "OK: $n" } else { "FALLO: $n" } }

# 1. Todo bien y los ficheros ya en main: crea el ruleset con tests y revisor, y lo comprueba.
$e = Nuevo-Estado
$r = Lanza $e
Prueba 'camino completo sale 0' ($r.Code -eq 0)
Prueba 'activa fusion automatica y borrado de ramas' ($e.auto -and $e.borrar)
Prueba 'deja el environment revisor limitado a main' ($e.env -and ($e.policies -contains 'main'))
Prueba 'crea el ruleset con tests / tests (el que ve GitHub) y revisor' ($e.cuerpoRuleset -match 'tests / tests' -and $e.cuerpoRuleset -match '"revisor"')
Prueba 'no abre PR si los ficheros ya estan' (-not $e.prAbierto)
Prueba 'no instala nada: ninguna llamada a installations con metodo que cambie' (@($r.Muta | Where-Object { $_ -match 'installations' }).Count -eq 0)
# 2. Relanzarlo: nada cambia.
$r2 = Lanza $e
Prueba 'relanzado sale 0' ($r2.Code -eq 0)
$muta2 = @($r2.Muta | Where-Object { $_ -notmatch 'environments/revisor -F' })   # el PUT del environment es idempotente y se repite
Prueba 'relanzado no cambia nada (salvo el PUT idempotente del environment)' ($muta2.Count -eq 0)
# 3. Repo privado con plan gratuito: para con el motivo y sin tocar nada.
$e = Nuevo-Estado; $e.planGratis403 = $true; $e.privado = $true
$r = Lanza $e
Prueba 'privado en plan gratuito: sale 1 con el motivo' ($r.Code -eq 1 -and $r.Out -match 'Upgrade to GitHub Pro' -and $r.Out -match 'no sigo')
Prueba 'privado en plan gratuito: no cambia nada' ($r.Muta.Count -eq 0 -and -not $e.auto)
# 4. Sin permisos de admin: para antes de tocar.
$e = Nuevo-Estado; $e.admin = $false
$r = Lanza $e
Prueba 'sin admin: sale 1 y no cambia nada' ($r.Code -eq 1 -and $r.Out -match 'no es administradora' -and $r.Muta.Count -eq 0)
# 5. Apps: revisor sin instalar. Dice el clic y no crea el ruleset.
$e = Nuevo-Estado; $e.instalaciones = @($e.instalaciones[0])
$r = Lanza $e
Prueba 'falta la App revisora: sale 1 con la direccion exacta del clic' ($r.Code -eq 1 -and $r.Out -match 'https://github.com/apps/fabrica-revisor/installations/new')
Prueba 'falta la App revisora: no crea el ruleset ni PR de ruleset' (-not $e.cuerpoRuleset)
# 5b. App instalada solo en otros repos de la cuenta.
$e = Nuevo-Estado; $e.instalaciones[1].repository_selection = 'selected'; $e.reposDe[2] = @('factory-am89/otro')
$r = Lanza $e
Prueba 'App en otros repos: dice como anadir este y no crea el ruleset' ($r.Code -eq 1 -and $r.Out -match 'Repository access' -and -not $e.cuerpoRuleset)
# 5c. App 'selected' que si incluye el repo: pasa.
$e = Nuevo-Estado; $e.instalaciones[1].repository_selection = 'selected'; $e.reposDe[2] = @($RP)
$r = Lanza $e
Prueba 'App repo a repo con este repo incluido: pasa' ($r.Code -eq 0 -and $e.cuerpoRuleset)
# 6. Ficheros que faltan: abre el PR y NO crea el ruleset.
$e = Nuevo-Estado; $e.enMain = @()
$r = Lanza $e
Prueba 'faltan ficheros: abre rama, sube los cuatro y abre el PR' ($e.ramaCreada -and $e.enRama.Count -eq 4 -and $e.prAbierto)
Prueba 'faltan ficheros: no crea el ruleset y sale 1 diciendo que fusione' ($r.Code -eq 1 -and -not $e.cuerpoRuleset -and $r.Out -match 'fusiona el PR')
$r = Lanza $e
Prueba 'con el PR ya abierto no abre otro ni vuelve a subir ficheros' ($e.enRama.Count -eq 4 -and @($r.Muta | Where-Object { $_ -match '/pulls |contents/' }).Count -eq 0)
# 7. Secretos: dice los que faltan por nombre y como crearlos; nunca llama a nada que lea un valor.
$e = Nuevo-Estado; $e.secretos = @('REVISOR_CLIENT_ID')
$r = Lanza $e
Prueba 'faltan secretos: los nombra y da gh secret set --env revisor' ($r.Out -match 'CLAUDE_CODE_OAUTH_TOKEN' -and $r.Out -match 'REVISOR_APP_KEY' -and $r.Out -match 'gh secret set REVISOR_APP_KEY --env revisor --repo factory-am89/homenu-panel')
Prueba 'faltan secretos: sale 1 pero el ruleset se crea igual' ($r.Code -eq 1 -and $e.cuerpoRuleset)
Prueba 'nunca pide un valor: ninguna llamada a secrets con metodo distinto de GET' (@($global:ArgsLog | Where-Object { $_ -match 'secrets' -and $_ -match '-X' }).Count -eq 0)
# 8. El check de tests aun no ha corrido en main: no inventa el nombre.
$e = Nuevo-Estado; $e.checks = @()
$r = Lanza $e
Prueba 'sin check de tests observado: para sin crear el ruleset' ($r.Code -eq 1 -and -not $e.cuerpoRuleset -and $r.Out -match 'ContextoTests')
$e = Nuevo-Estado; $e.checks = @()
$r = Lanza $e @{ ContextoTests = 'tests' }
Prueba '-ContextoTests manda sobre lo observado' ($r.Code -eq 0 -and $e.cuerpoRuleset -match '"context":\s+"tests"')
# 10. Respuestas ilegibles o llamadas fallidas: se para con el motivo real y la salida de gh, nunca en silencio.
$e = Nuevo-Estado; $e.enMain = @(); $e.rompe["repos/$RP/pulls?*"] = @{ Texto = '<html>Bad gateway</html>'; Codigo = 0 }
$r = Lanza $e
Prueba 'lista de PR ilegible: sale 1 con el motivo y la salida de gh' ($r.Code -eq 1 -and $r.Out -match 'los PR abiertos' -and $r.Out -match 'Bad\s+gateway')
Prueba 'lista de PR ilegible: no crea rama ni PR' (-not $e.ramaCreada -and -not $e.prAbierto -and $e.enRama.Count -eq 0)
$e = Nuevo-Estado; $e.rompe["repos/$RP"] = @{ Texto = '<html>Bad gateway</html>'; Codigo = 0 }
$r = Lanza $e
Prueba 'repo ilegible: dice que no es JSON con la salida y no culpa a los permisos' ($r.Code -eq 1 -and $r.Out -match 'no es JSON' -and $r.Out -match 'Bad\s+gateway' -and $r.Out -notmatch 'no es administradora')
$e = Nuevo-Estado; $e.rompe["repos/$RP"] = @{ Texto = 'gh: Server Error (HTTP 500)'; Codigo = 1 }
$r = Lanza $e
Prueba 'llamada al repo fallida: la salida de gh llega al mensaje' ($r.Code -eq 1 -and $r.Out -match 'HTTP 500' -and $r.Out -notmatch 'no es administradora')
$e = Nuevo-Estado; $e.rompe['/user/installations?per_page*'] = @{ Texto = '<html>nope</html>'; Codigo = 0 }
$r = Lanza $e
Prueba 'instalaciones ilegibles: el pendiente lleva el motivo y no se crea el ruleset' ($r.Code -eq 1 -and $r.Out -match 'nope' -and -not $e.cuerpoRuleset)
$e = Nuevo-Estado; $e.rompe["repos/$RP/environments/revisor/secrets"] = @{ Texto = '<html>x500</html>'; Codigo = 0 }
$r = Lanza $e
Prueba 'secretos ilegibles: para con el motivo' ($r.Code -eq 1 -and $r.Out -match 'x500' -and $r.Out -match 'los secretos')
$e = Nuevo-Estado; $e.politicaIgnorada = $true
$r = Lanza $e
Prueba 'environment que no queda limitado a main: sale 1 y lo dice (se lee de vuelta, no se cree al POST)' ($r.Code -eq 1 -and $r.Out -match 'NO queda limitado a main')
