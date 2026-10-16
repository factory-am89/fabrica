# Piezas de proyecto-nuevo.ps1 (se cargan con punto: . .\lib-proyecto.ps1, despues de lib-gh.ps1).
# Necesitan Gh, Partir-Repo y las funciones Info, Aviso y Bien de quien las carga.
# Ninguna lee ni imprime el valor de un secreto: de los secretos solo se mira el NOMBRE.
# Sin tildes a proposito: Windows PowerShell 5.1 lee un .ps1 sin BOM como ANSI.

# Secretos que el juez reutilizable pide al environment `revisor` (los mismos que declara
# workflow_call en .github/workflows/revisor.yml; test/proyecto-nuevo.test.js comprueba que coinciden).
$script:SecretosRevisor = @('CLAUDE_CODE_OAUTH_TOKEN', 'REVISOR_CLIENT_ID', 'REVISOR_APP_KEY')

# Ficheros que se dejan en el repo nuevo: ruta en el repo y plantilla de apps\proyecto-nuevo\.
$script:ArchivosProyecto = @(
  @{ Ruta = '.github/workflows/tests.yml'; Plantilla = 'tests.yml' },
  @{ Ruta = '.github/workflows/revisor.yml'; Plantilla = 'revisor.yml' },
  @{ Ruta = 'CLAUDE.md'; Plantilla = 'CLAUDE.md' },
  @{ Ruta = '.fabrica.json'; Plantilla = 'ficha.json' }
)

# JSON de una respuesta de gh. Lanza con el motivo real y la salida de gh si la llamada fallo o no es JSON:
# nunca devuelve $null en silencio. Una lista vacia ([]) devuelve un array vacio.
function Json-De($r, [string]$Que) {
  if ($r.Code -ne 0) { throw "No pude leer ${Que}: $($r.Out)" }
  if ($r.Out.Trim() -eq '[]') { return @() }
  try { $j = $r.Out | ConvertFrom-Json } catch { throw "La respuesta de $Que no es JSON ($($_.Exception.Message)): $($r.Out)" }
  if ($null -eq $j) { throw "La respuesta de $Que viene vacia: '$($r.Out)'" }
  return $j
}

# Para si el plan de la cuenta no admite rulesets en este repo (privado y plan gratuito: 403). No cambia nada.
function Comprobar-Rulesets-Disponibles([string]$Repo) {
  $r = Gh @('api', "repos/$Repo/rulesets")
  if ($r.Code -eq 0) { return }
  if ($r.Out -match 'Upgrade to GitHub Pro|make this repository public') {
    throw "El repo $Repo no admite rulesets con este plan (GitHub: $($r.Out)). Sin ruleset main no queda protegida, asi que no sigo. Hazlo publico o cambia de plan."
  }
  throw "No pude leer los rulesets de ${Repo}: $($r.Out)"
}

function Leer-Repo([string]$Repo) {
  return (Json-De (Gh @('api', "repos/$Repo")) "el repo $Repo")
}

# Fusion automatica y borrado de ramas al fusionar. Devuelve 'ok' o 'ya hecho'; lanza si no quedan activados.
function Asegurar-Ajustes-Repo([string]$Repo) {
  $j = Leer-Repo $Repo
  if ($j.allow_auto_merge -eq $true -and $j.delete_branch_on_merge -eq $true) { return 'ya hecho' }
  $p = Gh @('api', '-X', 'PATCH', "repos/$Repo", '-F', 'allow_auto_merge=true', '-F', 'delete_branch_on_merge=true')
  if ($p.Code -ne 0) { throw "No pude activar la fusion automatica y el borrado de ramas: $($p.Out)" }
  $j = Leer-Repo $Repo
  if ($j.allow_auto_merge -ne $true) { throw 'La fusion automatica sigue desactivada tras activarla.' }
  if ($j.delete_branch_on_merge -ne $true) { throw 'El borrado de ramas al fusionar sigue desactivado tras activarlo.' }
  return 'ok'
}

# Estado de una App en un repo, mirando las instalaciones de la sesion de gh. NO instala nada.
# Estado: repo (instalada con acceso a ese repo) | todos (instalada en todos los repos de la cuenta) |
#         otros (instalada en la cuenta pero sin este repo) | ninguna | dudosa (no se pudo leer; Detalle dice por que).
function Estado-App-En-Repo([string]$Slug, [string]$Repo) {
  $p = Partir-Repo $Repo
  # 'dudosa' lleva siempre el motivo real (salida de gh incluida) en Detalle; el paso 6 la muestra y para.
  try { $j = Json-De (Gh @('api', '/user/installations?per_page=100')) 'las instalaciones de Apps' }
  catch { return [pscustomobject]@{ Estado = 'dudosa'; Detalle = $_.Exception.Message } }
  $m = @($j.installations | Where-Object { $_.app_slug -eq $Slug -and $_.account.login -ieq $p.Dueno })
  if ($m.Count -eq 0) { return [pscustomobject]@{ Estado = 'ninguna'; Detalle = '' } }
  if ($m[0].repository_selection -eq 'all') { return [pscustomobject]@{ Estado = 'todos'; Detalle = '' } }
  try { $j2 = Json-De (Gh @('api', "/user/installations/$($m[0].id)/repositories?per_page=100")) 'los repos de la instalacion' }
  catch { return [pscustomobject]@{ Estado = 'dudosa'; Detalle = $_.Exception.Message } }
  $esta = @($j2.repositories | Where-Object { [string]$_.full_name -ieq $Repo })
  if ($esta.Count -gt 0) { return [pscustomobject]@{ Estado = 'repo'; Detalle = '' } }
  return [pscustomobject]@{ Estado = 'otros'; Detalle = '' }
}

# El clic que falta para una App, con la direccion exacta. Texto vacio si no falta nada.
function Clic-App-Que-Falta([string]$Slug, $Estado, [string]$Repo) {
  $p = Partir-Repo $Repo
  switch ($Estado.Estado) {
    'ninguna' { return "Instala la App $Slug en la cuenta $($p.Dueno): abre https://github.com/apps/$Slug/installations/new , elige la cuenta $($p.Dueno), marca 'Only select repositories' y elige $($p.Nombre) (o 'All repositories' si decides esa opcion)." }
    'otros' { return "La App $Slug esta en $($p.Dueno) pero sin $($p.Nombre): abre https://github.com/organizations/$($p.Dueno)/settings/installations (si la cuenta es personal: https://github.com/settings/installations ), Configure en $Slug y anade $($p.Nombre) en 'Repository access'." }
    'dudosa' { return "No pude comprobar la App ${Slug}: $($Estado.Detalle)" }
    default { return '' }
  }
}

# Nombres de secretos del environment `revisor` que faltan (solo nombres; el valor no se pide a GitHub).
function Secretos-Que-Faltan([string]$Repo) {
  $j = Json-De (Gh @('api', "repos/$Repo/environments/revisor/secrets")) 'los secretos del environment revisor'
  $hay = @($j.secrets | ForEach-Object { [string]$_.name })
  return @($script:SecretosRevisor | Where-Object { $hay -notcontains $_ })
}

# Como crear un secreto sin que su valor pase por la pantalla ni por la orden.
function Texto-Crear-Secreto([string]$Nombre, [string]$Repo) {
  $o = "gh secret set $Nombre --env revisor --repo $Repo"
  switch ($Nombre) {
    'CLAUDE_CODE_OAUTH_TOKEN' { return "$o   (te pide el valor oculto; sale de  claude setup-token )" }
    'REVISOR_CLIENT_ID' { return "$o   (te pide el valor oculto; es el Client ID de la App fabrica-revisor, el que empieza por Iv)" }
    'REVISOR_APP_KEY' { return "$o < ruta\a\la\clave-de-fabrica-revisor.pem   (la clave privada de la App; entra por la entrada, no por la orden)" }
    default { return $o }
  }
}

function Archivo-En-Rama([string]$Repo, [string]$Ruta, [string]$Rama) {
  $r = Gh @('api', "repos/$Repo/contents/${Ruta}?ref=$Rama")
  if ($r.Code -eq 0) { return $true }
  if ($r.Out -match 'Not Found|404') { return $false }
  throw "No pude mirar $Ruta en ${Repo}@${Rama}: $($r.Out)"
}

# Contenido de un fichero del repo nuevo a partir de su plantilla (cambia __REPO__ y __NOMBRE__).
function Contenido-De-Plantilla([string]$Carpeta, [string]$Plantilla, [string]$Repo) {
  $f = Join-Path $Carpeta $Plantilla
  if (-not (Test-Path $f)) { throw "Falta la plantilla $f." }
  $t = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
  return $t.Replace('__REPO__', $Repo).Replace('__NOMBRE__', (Partir-Repo $Repo).Nombre)
}

# Rutas de $script:ArchivosProyecto que aun no estan en la rama base del repo.
function Archivos-Que-Faltan([string]$Repo, [string]$Base) {
  return @($script:ArchivosProyecto | Where-Object { -not (Archivo-En-Rama $Repo $_.Ruta $Base) } | ForEach-Object { $_.Ruta })
}

# Deja listo el PR con los ficheros que faltan: rama nueva desde la base, un fichero por commit y el PR.
# Si ya hay un PR abierto desde esa rama, no hace nada. Devuelve la direccion del PR y si es 'nuevo' o 'ya abierto'.
function Abrir-Pr-Inicial([string]$Repo, [string]$Base, [string]$Rama, [string]$Carpeta, [string[]]$Faltan) {
  $p = Partir-Repo $Repo
  $l = Gh @('api', "repos/$Repo/pulls?state=open&head=$($p.Dueno):$Rama")
  $abiertos = @(Json-De $l 'los PR abiertos')
  if ($abiertos.Count -gt 0 -and $abiertos[0].html_url) { return [pscustomobject]@{ Url = [string]$abiertos[0].html_url; Estado = 'ya abierto' } }
  $s = Gh @('api', "repos/$Repo/git/ref/heads/$Base")
  $sj = Json-De $s "la punta de $Base"
  if (-not $sj.object.sha) { throw "La punta de ${Base} no trae sha: $($s.Out)" }
  $b = Gh @('api', '-X', 'POST', "repos/$Repo/git/refs", '-f', "ref=refs/heads/$Rama", '-f', "sha=$($sj.object.sha)")
  if ($b.Code -ne 0 -and $b.Out -notmatch 'Reference already exists') { throw "No pude crear la rama ${Rama}: $($b.Out)" }
  foreach ($a in ($script:ArchivosProyecto | Where-Object { $Faltan -contains $_.Ruta })) {
    if (Archivo-En-Rama $Repo $a.Ruta $Rama) { continue }
    $texto = Contenido-De-Plantilla $Carpeta $a.Plantilla $Repo
    $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($texto))
    $m = Gh @('api', '-X', 'PUT', "repos/$Repo/contents/$($a.Ruta)", '-f', "message=Fabrica: $($a.Ruta)", '-f', "content=$b64", '-f', "branch=$Rama")
    if ($m.Code -ne 0) { throw "No pude subir $($a.Ruta) a ${Rama}: $($m.Out)" }
  }
  $cuerpo = "Deja el repo trabajando con la Fabrica (https://github.com/factory-am89/fabrica): los workflows que llaman a los reutilizables, un CLAUDE.md minimo y la ficha .fabrica.json.`n`nLo abre apps/proyecto-nuevo.ps1. Los checks tests y revisor aun no son obligatorios: el ruleset de main se crea al relanzar el script cuando este PR este fusionado."
  $n = Gh @('api', '-X', 'POST', "repos/$Repo/pulls", '-f', 'title=Trabajar con la Fabrica', '-f', "head=$Rama", '-f', "base=$Base", '-f', "body=$cuerpo")
  $nj = Json-De $n 'la respuesta al abrir el PR'
  if (-not $nj.html_url) { throw "GitHub no devolvio la direccion del PR: $($n.Out)" }
  return [pscustomobject]@{ Url = [string]$nj.html_url; Estado = 'nuevo' }
}

# Nombre con el que GitHub ve el check de tests en el repo, mirando los checks de la punta de la rama base.
# Devuelve el nombre o $null si aun no hay ninguno (el workflow no ha corrido en esa rama).
function Contexto-Tests-Observado([string]$Repo, [string]$Base) {
  $r = Gh @('api', "repos/$Repo/commits/$Base/check-runs?per_page=100")
  $j = Json-De $r "los checks de $Base"
  $n = @($j.check_runs | ForEach-Object { [string]$_.name } | Where-Object { $_ -match '^tests( / tests)?$' })
  if ($n.Count -eq 0) { return $null }
  return $n[0]
}

# Comprueba lo que de verdad aplica GitHub a la rama: exige $ContextoTests y revisor. Lanza si no.
function Comprobar-Reglas-De-Main([string]$Repo, [string]$Base, [string]$ContextoTests) {
  $r = Gh @('api', "repos/$Repo/rules/branches/$Base")
  $j = Json-De $r "las reglas de $Base"
  $ctx = @($j | Where-Object { $_.type -eq 'required_status_checks' } | ForEach-Object { $_.parameters.required_status_checks } | ForEach-Object { [string]$_.context })
  foreach ($c in @($ContextoTests, 'revisor')) {
    if ($ctx -notcontains $c) { throw "GitHub no exige el check '$c' en ${Base} (exige: $($ctx -join ', '))." }
  }
}
