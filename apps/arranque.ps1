# Puesta en marcha de la Fabrica en un solo script (uso unico).
# Lo lanza Pablo en su PowerShell:  powershell -ExecutionPolicy Bypass -File <esta ruta>
# Guia paso a paso y para solo donde hay que pulsar algo en el navegador.
# - Ningun secreto sale por pantalla, a ficheros ni al historial (los valores
#   viajan por la entrada estandar de gh/op, nunca por argumentos).
# - Se puede relanzar: lo que ya existe se salta.
# - Sube main de la v0 y, al final, crea el ruleset de main (todo con la misma sesion de gh).
# - Al final, siempre (tambien si algo falla), cierra la sesion de gh.
# Los textos van sin tildes a proposito: Windows PowerShell 5.1 lee un .ps1 sin BOM
# como ANSI y estropearia los acentos (y algunas comillas rompen el script).
param(
  [string]$Repo = 'factory-am89/fabrica',
  [string]$Fabrica = (Split-Path -Parent $PSScriptRoot),   # raiz del repo (carpeta de apps\ y scripts\); sale de donde esta este script, solo se lee
  [string]$CarpetaV0 = 'C:\dev\fabrica',   # el repo con la v0 en su main local (de ahi se sube)
  [string]$Boveda = 'Fabrica',
  [string]$NombreConstructor = 'fabrica-constructor',  # solo si cambiaste el nombre en crear-apps.html
  [string]$NombreRevisor = 'fabrica-revisor'
)

$ErrorActionPreference = 'Continue'   # los fallos de gh/op se miran con $LASTEXITCODE
$Dueno = ($Repo -split '/')[0]
$PemConstructor = 'fabrica-constructor.pem'   # nombre fijo de la clave en 1Password (lo busca scripts\token.mjs)
$script:NombreConstructor = $NombreConstructor
$script:NombreRevisor = $NombreRevisor
$script:HtmlAbierto = $false

# ---------- estado y resumen ----------
$Pasos = [ordered]@{
  '1 Sesion de gh'                  = 'pendiente'
  '2 Environment revisor (main)'    = 'pendiente'
  '3 Cuenta de servicio (llavero)'  = 'pendiente'
  '3 App fabrica-constructor'       = 'pendiente'
  '3 App fabrica-revisor'           = 'pendiente'
  '4 Apps instaladas en el repo'    = 'pendiente'
  '5 Token de Claude'               = 'pendiente'
  '6 Allow auto-merge'              = 'pendiente'
  '7 Subir main (v0)'               = 'pendiente'
  '8 Ruleset de main'               = 'pendiente'
}
$script:Estado = 'ok'
$script:ClientIdConstructor = $null
$script:Fallo = $false
# Entrada del llavero de Windows (distinta de la de MenuPlan): su nombre vive solo en apps\llavero.json, que tambien lee scripts\token.mjs.
$Llavero = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'llavero.json') | ConvertFrom-Json
$LlaveroRecurso = $Llavero.recurso
$LlaveroUsuario = $Llavero.usuario
if (-not $LlaveroRecurso -or -not $LlaveroUsuario) { Write-Host '  apps\llavero.json no trae recurso y usuario.' -ForegroundColor Red; exit 1 }
$CuentaServicio = 'fabrica-agentes'

function Titulo($t) { Write-Host ''; Write-Host "=== $t ===" -ForegroundColor Cyan }
function Info($t)   { Write-Host "  $t" }
function Bien($t)   { Write-Host "  [ok] $t" -ForegroundColor Green }
function Aviso($t)  { Write-Host "  [!] $t" -ForegroundColor Yellow }
. (Join-Path $PSScriptRoot 'lib-gh.ps1')   # Gh, Gh-Login, Subir-Main y llavero (usan Info, Aviso y Bien)

# Ejecuta un paso: registra ok / ya hecho / FALLO y, si falla, corta todo.
function Paso([string]$Nombre, [scriptblock]$Cuerpo) {
  Titulo $Nombre
  $script:Estado = 'ok'
  try {
    & $Cuerpo
    $Pasos[$Nombre] = $script:Estado
  } catch {
    $Pasos[$Nombre] = 'FALLO: ' + $_.Exception.Message
    throw
  }
}

# Guarda un secreto en el environment revisor pasandolo por stdin, byte a byte
# (sin salto de linea final) y sin ponerlo en argumentos.
function Set-Secreto([string]$Nombre, [string]$Valor) {
  $js = 'const r=require(''child_process'').spawnSync(''gh'',[''secret'',''set'',process.argv[1],''--repo'',process.argv[2],''--env'',''revisor''],{input:process.env.FAB_VALOR,stdio:[''pipe'',''ignore'',''inherit'']});process.exit(r.status===null?1:r.status)'
  $env:FAB_VALOR = $Valor
  try { & node -e $js $Nombre $Repo; return ($LASTEXITCODE -eq 0) }
  finally { Remove-Item Env:FAB_VALOR -ErrorAction SilentlyContinue }
}

function Secretos-Del-Entorno {
  $r = Gh @('secret', 'list', '--repo', $Repo, '--env', 'revisor')
  if ($r.Code -ne 0) { return @() }
  return @($r.Out -split "`n" | ForEach-Object { ($_ -split '\s+')[0] } | Where-Object { $_ })
}

function Pedir-Codigo {
  while ($true) {
    $t = (Read-Host '  Pega lo que va tras code= (Enter vacio para cancelar)').Trim()
    if (-not $t) { throw 'Cancelado: sin codigo.' }
    if ($t -match 'code=([^&\s]+)') { $t = $Matches[1] }
    if ($t -match '^[A-Za-z0-9_\-]{10,}$') { return $t }
    Aviso 'Eso no parece un codigo. Copia solo lo que va tras code= en la barra de direcciones.'
  }
}

# Lanza convertir.mjs y devuelve su salida (id, client id y avisos; nunca la clave).
function Convertir([string]$Codigo) {
  $env:OP_VAULT = $Boveda
  $env:REPO = $Repo
  Push-Location $Fabrica
  try { $o = & node 'apps\convertir.mjs' $Codigo 2>&1 | Plano | Out-String; $c = $LASTEXITCODE }
  finally { Pop-Location }
  Write-Host $o.Trim()
  if ($c -ne 0) { throw 'convertir.mjs fallo (mira el mensaje de arriba).' }
  return $o
}

# Guarda un .pem en su sitio (constructor: 1Password con nombre fijo; revisor: secretos del environment).
function Guardar-Pem([string]$Ruta, [string]$Rol, [string]$ClientId) {
  if ($Rol -eq 'constructor') {
    & op document create $Ruta --title $PemConstructor --vault $Boveda | Out-Null
    return ($LASTEXITCODE -eq 0)
  }
  $ok = (Set-Secreto 'REVISOR_APP_KEY' (Get-Content -Raw $Ruta))
  if ($ok -and $ClientId) { $ok = (Set-Secreto 'REVISOR_CLIENT_ID' $ClientId) }
  return $ok
}

# Si convertir.mjs dejo la clave en un fichero temporal, la rescata y borra el fichero.
function Rescatar-Pem([string]$Salida, [string]$Destino, [string]$ClientId) {
  if ($Salida -notmatch 'AVISO') { return }
  if ($Salida -notmatch '([A-Za-z]:\\[^\r\n]*?\.pem)') { return }
  $ruta = $Matches[1]
  if (-not (Test-Path $ruta)) { return }
  Aviso 'convertir.mjs no pudo guardar la clave y la dejo en un fichero temporal. Intento rescatarla.'
  $ok = Guardar-Pem $ruta $Destino $ClientId
  if ($ok) { Remove-Item $ruta -Force; Remove-Item (Split-Path $ruta) -ErrorAction SilentlyContinue; Bien 'Clave rescatada y fichero temporal borrado.' }
  else { Aviso "No pude rescatarla. El fichero sigue en $ruta : guardala a mano y borralo." }
}

function Json($r) { try { return ($r.Out | ConvertFrom-Json) } catch { return $null } }

# Client ID de una App (empieza por Iv; no es secreto). Si la API no lo da, se pide una vez por App.
$script:ClientIds = @{}
function Pedir-ClientId([string]$Slug) {
  if ($script:ClientIds.ContainsKey($Slug)) { return $script:ClientIds[$Slug] }
  Info "GitHub no me da el Client ID de '$Slug' (es una App privada). Lo ves en https://github.com/settings/apps/$Slug : empieza por Iv (no es el App ID numerico)."
  while ($true) {
    $t = (Read-Host '  Escribe el Client ID (empieza por Iv; vacio para cancelar)').Trim()
    if (-not $t) { throw "Sin el Client ID de '$Slug' no sigo." }
    if ($t -match '^Iv[A-Za-z0-9.]{10,}$') { $script:ClientIds[$Slug] = $t; return $t }
    Aviso 'Eso no parece un Client ID (Iv23...). No es el App ID numerico.'
  }
}

# Datos de una App por su nombre. Una App privada da 404 en /apps/<nombre> aunque exista y sea tuya,
# asi que un 404 NO basta: se mira tambien entre tus instalaciones. Existe=$false solo si ninguna la ve;
# si no se puede leer, corta.
function Info-App([string]$Nombre) {
  $r = Gh @('api', "apps/$Nombre")
  if ($r.Code -ne 0) {
    if ($r.Out -notmatch 'Not Found|404') { throw "No pude consultar la App '$Nombre' en GitHub: $($r.Out)" }
    $b = Buscar-App-Instalada $Nombre
    if ($b.Estado -eq 'dudosa') { throw "No pude consultar la App '$Nombre' en GitHub (404 en /apps y no pude leer tus instalaciones)." }
    if ($b.Estado -eq 'ninguna') { return [pscustomobject]@{ Existe = $false; Dueno = $null; ClientId = $null; Slug = $Nombre } }
    $cid = $b.ClientId
    if (-not $cid) { $cid = Pedir-ClientId $Nombre }
    return [pscustomobject]@{ Existe = $true; Dueno = $b.Cuenta; ClientId = $cid; Slug = $Nombre }
  }
  $j = Json $r
  if (-not $j -or -not $j.slug) { throw "No entiendo la respuesta de GitHub para la App '$Nombre'." }
  return [pscustomobject]@{ Existe = $true; Dueno = [string]$j.owner.login; ClientId = [string]$j.client_id; Slug = [string]$j.slug }
}

function Tiene-Clave([string]$Rol) {
  if ($Rol -eq 'constructor') {
    $l = & op item list --vault $Boveda --format json 2>&1 | Plano | Out-String
    return ($l -match [regex]::Escape($PemConstructor))
  }
  $s = Secretos-Del-Entorno
  return (($s -contains 'REVISOR_APP_KEY') -and ($s -contains 'REVISOR_CLIENT_ID'))
}

# La App existe y es tuya, pero falta su clave (el canje del codigo fallo o se corto): se genera una nueva en GitHub.
function Generar-Clave([string]$Slug, [string]$Rol, [string]$ClientId) {
  Aviso "La App '$Slug' ya existe y es tuya, pero falta su clave. No hace falta crearla otra vez: genera una clave nueva."
  Start-Process "https://github.com/settings/apps/$Slug"
  Info 'En esa pagina baja a Private keys y pulsa Generate a private key: se descarga un fichero .pem.'
  Read-Host '  Pulsa Enter cuando se haya descargado' | Out-Null
  $dl = Join-Path $env:USERPROFILE 'Downloads'
  $f = Get-ChildItem -Path $dl -Filter "$Slug*.pem" -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt (Get-Date).AddMinutes(-30) } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($f) { $ruta = $f.FullName; Info "Encontrado: $ruta" }
  else { $ruta = (Read-Host '  No lo encuentro en Descargas. Escribe la ruta del .pem descargado').Trim().Trim('"') }
  if (-not $ruta -or -not (Test-Path $ruta)) { throw 'No tengo el fichero .pem: genera la clave y relanza.' }
  if ((Get-Content -Raw $ruta) -notmatch 'PRIVATE KEY') { throw "El fichero $ruta no parece una clave privada." }
  $ok = Guardar-Pem $ruta $Rol $ClientId
  if (-not $ok) { throw "No pude guardar la clave. El fichero sigue en $ruta : guardalo a mano y borralo." }
  Remove-Item $ruta -Force
  Bien 'Clave guardada y fichero .pem borrado.'
}

# Deja la App lista (existe, es tuya y su clave esta guardada). Devuelve el nombre real (slug).
function Obtener-App([string]$Rol, [string]$Nombre) {
  if ($Rol -eq 'constructor') { $param = '-NombreConstructor' } else { $param = '-NombreRevisor' }
  $i = Info-App $Nombre
  if ($i.Existe -and $i.Dueno -ine $Dueno) {
    throw "El nombre '$Nombre' ya lo usa otra persona ($($i.Dueno)). Cambia el nombre en apps\crear-apps.html (el boton de $Rol) y relanza este script con $param <nuevo nombre>."
  }
  if ($i.Existe) {
    if (-not (Tiene-Clave $Rol)) {
      if ($Rol -eq 'constructor') { Generar-Clave $i.Slug $Rol $null } else { Generar-Clave $i.Slug $Rol $i.ClientId }
    } elseif ($Rol -eq 'revisor') {
      $s = Secretos-Del-Entorno
      if ($s -notcontains 'REVISOR_CLIENT_ID') { if (-not (Set-Secreto 'REVISOR_CLIENT_ID' $i.ClientId)) { throw 'No pude guardar REVISOR_CLIENT_ID.' } }
    }
    if ($Rol -eq 'constructor') { $script:ClientIdConstructor = $i.ClientId }
    return $i.Slug
  }
  if (Tiene-Clave $Rol) {
    # Una App privada aun sin instalar no sale en ninguna lista: se pregunta antes de darla por perdida.
    Aviso "Hay una clave de $Rol guardada pero GitHub no me ensena ninguna App llamada '$Nombre' (una App privada sin instalar no se ve por API)."
    Aviso "Mira https://github.com/settings/apps/$Nombre : si existe y es tuya, no hay que crearla otra vez."
    $r = Read-Host "  Existe y es tuya? (s/n)"
    if ($r -notmatch '^[sSyY]') { throw "Hay una clave de $Rol guardada pero no encuentro ninguna App llamada '$Nombre'. Relanza con el nombre real ($param <nombre>) para no crear otra." }
    $cidManual = Pedir-ClientId $Nombre
    if ($Rol -eq 'constructor') { $script:ClientIdConstructor = $cidManual }
    elseif ((Secretos-Del-Entorno) -notcontains 'REVISOR_CLIENT_ID') { if (-not (Set-Secreto 'REVISOR_CLIENT_ID' $cidManual)) { throw 'No pude guardar REVISOR_CLIENT_ID.' } }
    return $Nombre
  }
  # No existe: hay que crearla con el boton.
  if (-not $script:HtmlAbierto) {
    Start-Process (Join-Path $Fabrica 'apps\crear-apps.html'); $script:HtmlAbierto = $true
    Info 'Se ha abierto la pagina con dos botones. GitHub te llevara luego a una pagina que no carga (localhost:8787): es normal.'
  }
  Info "Pulsa el boton Crear $Nombre y luego Create GitHub App."
  Info 'Cuando llegues a la pagina que no carga, copia de la barra lo que va tras code=.'
  $codigo = Pedir-Codigo
  $salida = $null
  try { $salida = Convertir $codigo } catch { Aviso $_.Exception.Message }
  if ($salida) {
    $real = $Nombre
    if ($salida -match 'App creada: (\S+) \(') { $real = $Matches[1] }
    $cid = $null
    if ($salida -match 'client id ([^\s\),]+)') { $cid = $Matches[1] }
    if ($Rol -eq 'constructor' -and $cid) { $script:ClientIdConstructor = $cid }
    Rescatar-Pem $salida $Rol $cid
    if ($Rol -eq 'constructor' -and -not (Tiene-Clave 'constructor') -and $real -ne 'fabrica-constructor') {
      # GitHub le dio otro nombre: la clave quedo como '<nombre>.pem'; se le pone el nombre fijo que busca token.mjs.
      & op item edit "$real.pem" --title $PemConstructor --vault $Boveda 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "La clave quedo en 1Password como '$real.pem' y no pude renombrarla a '$PemConstructor'. Renombrala a mano en la caja $Boveda." }
    }
    if (-not (Tiene-Clave $Rol)) { throw "La clave de $Rol no esta guardada (mira los avisos de arriba)." }
    return $real
  }
  # El canje fallo, pero GitHub pudo crear la App: se mira antes de mandarte otra vez al boton.
  $i2 = Info-App $Nombre
  if ($i2.Existe -and $i2.Dueno -ieq $Dueno) {
    Generar-Clave $i2.Slug $Rol $i2.ClientId
    if ($Rol -eq 'constructor') { $script:ClientIdConstructor = $i2.ClientId }
    return $i2.Slug
  }
  throw 'No se creo la App. Relanza el script y pulsa de nuevo el boton.'
}

# Las dos Apps se miran igual, por /user/installations con la sesion de gh: no se saca ninguna clave de 1Password.
# Estado de la instalacion de una App en el repo: ok (solo fabrica) | ninguna | ancha (mas repos) | dudosa (no se puede leer).
function Estado-Instalacion([string]$Rol, [string]$Nombre) {
  $r = Gh @('api', '/user/installations?per_page=100')
  if ($r.Code -ne 0) { return 'dudosa' }
  $j = Json $r
  if (-not $j) { return 'dudosa' }
  $m = @($j.installations | Where-Object { $_.app_slug -eq $Nombre })
  if ($m.Count -eq 0) { return 'ninguna' }
  if ($m[0].repository_selection -eq 'all') { return 'ancha' }
  $r2 = Gh @('api', "/user/installations/$($m[0].id)/repositories?per_page=100")
  if ($r2.Code -ne 0) { return 'dudosa' }
  $j2 = Json $r2
  if (-not $j2) { return 'dudosa' }
  $l = @($j2.repositories | ForEach-Object { [string]$_.full_name })
  if ($l.Count -eq 1 -and $l[0] -ieq $Repo) { return 'ok' }
  return 'ancha'
}

function Cierra-Sesion {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { return }
  & gh.exe auth logout --hostname github.com --user $Dueno 2>&1 | Out-Null
  & gh.exe auth status 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Aviso 'gh sigue con sesion abierta: ejecuta  gh auth logout  a mano.' }
  else { Write-Host '  Sesion de gh cerrada.' -ForegroundColor Green }
}

# ---------- comprobaciones previas (no tocan nada) ----------
Titulo 'Comprobaciones previas'
foreach ($c in 'gh', 'node', 'op', 'claude') {
  if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { Write-Host "  Falta el programa '$c'. Instalalo y vuelve a lanzar." -ForegroundColor Red; exit 1 }
}
foreach ($f in 'apps\crear-apps.html', 'apps\convertir.mjs', 'apps\ruleset.ps1') {
  if (-not (Test-Path (Join-Path $Fabrica $f))) { Write-Host "  No encuentro $Fabrica\$f" -ForegroundColor Red; exit 1 }
}
if ($env:GH_TOKEN -or $env:GITHUB_TOKEN) {
  Aviso 'Habia GH_TOKEN/GITHUB_TOKEN en este terminal: lo quito solo para este script (impediria el login).'
  Remove-Item Env:GH_TOKEN, Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
}
& op vault list --format json 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host '  1Password (op) no tiene sesion. Abre la app de 1Password, desbloqueala (con la integracion con CLI activa) o ejecuta  op signin  y vuelve a lanzar.' -ForegroundColor Red
  exit 1
}
Bien 'gh, node, op (con sesion) y claude encontrados.'
& gh.exe auth status --hostname github.com 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
  $q = (& gh.exe api user --jq .login 2>$null | Out-String).Trim()
  if ($q -ne $Dueno) {
    Write-Host "  Ya hay una sesion de gh abierta como '$q' (no como '$Dueno'). No la toco: cierrala tu (gh auth logout) o usa otro terminal, y vuelve a lanzar." -ForegroundColor Red
    exit 1
  }
}

try {
  # ---------- 1. gh auth login ----------
  Paso '1 Sesion de gh' {
    & gh.exe auth status --hostname github.com 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Exigir-Workflow; Info 'Ya hay sesion de gh; la uso (se cerrara al final).'; $script:Estado = 'ya hecho' }
    else {
      Info 'Se abrira el navegador: copia el codigo que te da gh, pegalo en la pagina y autoriza.'
      Gh-Login
      if ($LASTEXITCODE -ne 0) { throw 'gh auth login no termino bien.' }
    }
    $u = Gh @('api', 'user', '--jq', '.login')
    if ($u.Code -ne 0 -or $u.Out -ne $Dueno) { throw "La sesion es de '$($u.Out)' y deberia ser '$Dueno'." }
    $v = Gh @('api', "repos/$Repo", '--jq', '.permissions.admin')
    if ($v.Code -ne 0) { throw "No veo el repo $Repo. Esta creado el repo vacio en GitHub (https://github.com/new)?" }
    if ($v.Out -ne 'true') { throw "No eres administrador de $Repo." }
    Bien "Sesion de $Dueno con permisos de administracion en $Repo."
  }

  # ---------- 2. environment revisor limitado a main ----------
  Paso '2 Environment revisor (main)' {
    $e = Gh @('api', "repos/$Repo/environments/revisor")
    $existia = ($e.Code -eq 0)
    $r = Gh @('api', '-X', 'PUT', "repos/$Repo/environments/revisor", '-F', 'deployment_branch_policy[protected_branches]=false', '-F', 'deployment_branch_policy[custom_branch_policies]=true')
    if ($r.Code -ne 0) { throw "No pude crear el environment: $($r.Out)" }
    $p = Gh @('api', "repos/$Repo/environments/revisor/deployment-branch-policies", '--jq', '.branch_policies[].name')
    if ($p.Code -ne 0) { throw "No pude leer las ramas permitidas: $($p.Out)" }
    $nombres = @($p.Out -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($nombres -notcontains 'main') {
      $n = Gh @('api', '-X', 'POST', "repos/$Repo/environments/revisor/deployment-branch-policies", '-f', 'name=main', '-f', 'type=branch')
      if ($n.Code -ne 0) { throw "No pude limitar el environment a main: $($n.Out)" }
    } elseif ($existia) { $script:Estado = 'ya hecho' }
    $extra = @($nombres | Where-Object { $_ -ne 'main' })
    if ($extra.Count -gt 0) { Aviso "El environment admite ademas: $($extra -join ', '). Deberia ser solo main." }
    Bien 'Environment revisor limitado a la rama main.'
  }

  # ---------- 3. las dos Apps ----------
  # Caja de 1Password
  & op vault get $Boveda 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Titulo "Caja '$Boveda' de 1Password"
    $c = & op vault create $Boveda 2>&1 | Plano | Out-String
    if ($LASTEXITCODE -ne 0) {
      $Pasos['3 App fabrica-constructor'] = 'FALLO: no existe la caja y no pude crearla'
      throw "La caja '$Boveda' no existe y no he podido crearla (falta permiso, o op sin sesion): $($c.Trim()). Crea la caja a mano en 1Password y relanza."
    }
    Bien "Caja '$Boveda' creada."
  }

  # ---------- 3-bis. cuenta de servicio de solo lectura sobre la caja ----------
  # Las sesiones del PC solo tienen la cuenta de MenuPlan (no ve 'Fabrica'). Esta ve solo 'Fabrica'.
  Paso '3 Cuenta de servicio (llavero)' {
    if (Llavero-Existe $LlaveroRecurso $LlaveroUsuario) {
      Info "Ya hay un token de '$CuentaServicio' en el llavero ('$LlaveroRecurso'): no creo otra cuenta."; $script:Estado = 'ya hecho'
    } else {
      $existe = $false; $fiable = $true
      $l = & op service-account list --format json 2>&1 | Plano | Out-String
      if ($LASTEXITCODE -eq 0) { if ($l -match [regex]::Escape("`"$CuentaServicio`"")) { $existe = $true } }
      else { $fiable = $false }
      $seguir = $true
      if (-not $fiable) {
        Aviso "No puedo saber si la cuenta '$CuentaServicio' ya existe en 1Password (esta version de op no lista cuentas de servicio)."
        Aviso 'Mira en 1Password.com (Developer, Service accounts). Si ya existe y no tienes su token, crear otra deja dos.'
        $r = Read-Host "  Creo una cuenta nueva igualmente? (s/n)"
        if ($r -notmatch '^[sSyY]') { $script:Estado = 'OMITIDO (por ti)'; $seguir = $false }
      }
      if ($seguir) {
        if ($existe) {
          Aviso "La cuenta '$CuentaServicio' YA existe en 1Password pero su token no esta en el llavero. No creo otra."
          Aviso 'El token solo se ve al crearla: anulala en 1Password.com (Developer, Service accounts) y relanza el script para crear una nueva.'
          $script:Estado = 'ya existe, sin token en el llavero'
        } else {
          Info "Creo la cuenta '$CuentaServicio' con lectura solo sobre '$Boveda' (el token no se muestra)."
          $salida = & op service-account create $CuentaServicio --vault "${Boveda}:read_items" --raw 2>&1 | Plano | Out-String
          $codigo = $LASTEXITCODE
          $tok = ($salida -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^ops_\S{20,}$' } | Select-Object -First 1)
          if ($codigo -eq 0 -and $tok) {
            $ok = Llavero-Guardar $LlaveroRecurso $LlaveroUsuario $tok
            $tok = $null; $salida = $null
            if (-not $ok) { throw "Cree la cuenta '$CuentaServicio' pero no pude guardar su token en el llavero (o no coincide). Anula la cuenta en 1Password.com y relanza." }
            Bien "Cuenta '$CuentaServicio' creada; token en el llavero de Windows ('$LlaveroRecurso' / '$LlaveroUsuario'), COINCIDEN."
          } else {
            $tok = $null
            $msg = ($salida -replace 'ops_\S+', '[token]').Trim()
            if ($msg -match 'unknown command|not available|upgrade|plan|not supported|not allowed|permission|forbidden|business|team') {
              Aviso "'op service-account create' no esta disponible en este plan o cuenta: $msg"
            } else {
              Aviso "No pude crear la cuenta de servicio: $msg"
            }
            Aviso 'Sigo sin este paso. Las sesiones de la Fabrica no podran leer la caja sin que Pablo apruebe en la app de 1Password.'
            $script:Estado = 'OMITIDO (no disponible)'
          }
        }
      }
    }
  }

  Titulo '3 Las dos Apps (hay que pulsar en el navegador si no existen)'

  Paso '3 App fabrica-constructor' {
    $existia = Tiene-Clave 'constructor'
    $script:NombreConstructor = Obtener-App 'constructor' $script:NombreConstructor
    if (-not $script:ClientIdConstructor) { $script:ClientIdConstructor = (Info-App $script:NombreConstructor).ClientId }
    if ($existia) { $script:Estado = 'ya hecho' }
    Bien "App $($script:NombreConstructor) y su clave ($PemConstructor) en 1Password (caja $Boveda)."
  }

  Paso '3 App fabrica-revisor' {
    $existia = Tiene-Clave 'revisor'
    $script:NombreRevisor = Obtener-App 'revisor' $script:NombreRevisor
    if ($existia) { $script:Estado = 'ya hecho' }
    Bien "App $($script:NombreRevisor): REVISOR_APP_KEY y REVISOR_CLIENT_ID en el environment revisor."
  }

  # ---------- 4. instalar las Apps en el repo (solo en fabrica) ----------
  Paso '4 Apps instaladas en el repo' {
    $todoYa = $true
    foreach ($rol in 'constructor', 'revisor') {
      if ($rol -eq 'constructor') { $slug = $script:NombreConstructor } else { $slug = $script:NombreRevisor }
      $vueltas = 0
      while ($true) {
        $vueltas++
        if ($vueltas -gt 6) { throw "No consigo dejar $slug instalada solo en $Repo." }
        $est = Estado-Instalacion $rol $slug
        if ($est -eq 'ok') { Bien "$slug instalada solo en $Repo."; break }
        if ($est -eq 'ancha') {
          $todoYa = $false
          Aviso "$slug tiene acceso a mas repositorios que $Repo (por ejemplo All repositories). Debe ser solo fabrica."
          Start-Process 'https://github.com/settings/installations'
          Info "En esa pagina: Configure junto a $slug -> Repository access -> Only select repositories -> solo fabrica -> Save."
          Read-Host '  Pulsa Enter cuando lo hayas cambiado' | Out-Null
          continue
        }
        if ($est -eq 'dudosa') {
          Aviso "No puedo comprobar por API si $slug esta instalada (GitHub no deja a esta sesion verlo)."
          Aviso "Compruebalo en https://github.com/settings/installations : $slug con acceso solo a 'fabrica' (Only select repositories)."
          $r = Read-Host "  Esta instalada y con acceso SOLO a fabrica? (s/n)"
          if ($r -match '^[sSyY]') { break }
        }
        $todoYa = $false
        Start-Process "https://github.com/apps/$slug/installations/new"
        Info "En la pagina de ${slug}: Install -> Only select repositories -> fabrica -> Install."
        Read-Host '  Pulsa Enter cuando la hayas instalado' | Out-Null
      }
    }
    if ($todoYa) { $script:Estado = 'ya hecho' }
  }

  # ---------- 5. token de Claude ----------
  Paso '5 Token de Claude' {
    if ((Secretos-Del-Entorno) -contains 'CLAUDE_CODE_OAUTH_TOKEN') {
      Info 'CLAUDE_CODE_OAUTH_TOKEN ya esta en el environment: salto.'; $script:Estado = 'ya hecho'
    } else {
      Info 'claude setup-token es interactivo (abre el navegador y ensena el token en pantalla):'
      Info 'no se puede canalizar directo a gh sin riesgo de guardar basura como secreto.'
      Info 'Cuando te muestre el token, copialo; luego el script te lo pide en una entrada oculta.'
      & claude setup-token
      if ($LASTEXITCODE -ne 0) { throw 'claude setup-token no termino bien.' }
      $token = $null
      for ($intento = 1; $intento -le 3 -and -not $token; $intento++) {
        $ss = Read-Host '  Pega el token entero (no se ve al pegarlo)' -AsSecureString
        $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
        try { $plano = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
        if ($plano -and ($plano.Trim() -match '^sk-ant-oat01-[A-Za-z0-9_\-]{80,}$')) { $token = $plano.Trim() }
        else { Aviso 'Eso no parece el token entero (sk-ant-oat01-... largo): puede haberse cortado al copiar. Prueba otra vez.' }
        $plano = $null
      }
      if (-not $token) { throw 'No recibi un token de Claude valido en tres intentos.' }
      $ok = Set-Secreto 'CLAUDE_CODE_OAUTH_TOKEN' $token
      $token = $null
      if (-not $ok) { throw 'gh no pudo guardar CLAUDE_CODE_OAUTH_TOKEN en el environment.' }
      Clear-Host
      if (-not ((Secretos-Del-Entorno) -contains 'CLAUDE_CODE_OAUTH_TOKEN')) { throw 'El secreto no aparece tras guardarlo.' }
      Bien 'Token guardado en el environment revisor (pantalla limpiada).'
    }
  }

  # ---------- 6. auto-merge ----------
  Paso '6 Allow auto-merge' {
    $g = Gh @('api', "repos/$Repo", '--jq', '.allow_auto_merge')
    if ($g.Code -eq 0 -and $g.Out -eq 'true') { $script:Estado = 'ya hecho' }
    else {
      $r = Gh @('api', '-X', 'PATCH', "repos/$Repo", '-F', 'allow_auto_merge=true')
      if ($r.Code -ne 0) { throw "No pude activar auto-merge: $($r.Out)" }
      $g = Gh @('api', "repos/$Repo", '--jq', '.allow_auto_merge')
      if ($g.Out -ne 'true') { throw 'Auto-merge sigue desactivado tras activarlo.' }
    }
    Bien 'Allow auto-merge activado.'
  }

  # ---------- 7. subir main (la v0) ----------
  # Va antes del ruleset: con el ruleset puesto, main ya no admite empujes directos.
  Paso '7 Subir main (v0)' {
    if ((Subir-Main $CarpetaV0 $Repo) -eq 'ya hecho') { $script:Estado = 'ya hecho' }
  }

  # ---------- 8. ruleset de main (al final) ----------
  # Exige el check revisor con el id de la App aunque aun no haya corrido (solo corre en PR).
  Paso '8 Ruleset de main' {
    & (Join-Path $PSScriptRoot 'ruleset.ps1') -Repo $Repo -AppRevisor $script:NombreRevisor -SesionAbierta
    if ($LASTEXITCODE -ne 0) { throw 'ruleset.ps1 fallo (mira el mensaje de arriba). Se puede relanzar suelto: apps\ruleset.ps1' }
  }
}
catch {
  $script:Fallo = $true
  Write-Host ''
  Write-Host "PARADO: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Arregla lo que dice y relanza el script: lo ya hecho se salta.' -ForegroundColor Red
}
finally {
  try { $Host.UI.RawUI.FlushInputBuffer() } catch { }
  Titulo 'Cierre'
  Cierra-Sesion
  Titulo 'Resumen'
  foreach ($k in $Pasos.Keys) {
    $v = $Pasos[$k]
    $col = if ($v -eq 'ok') { 'Green' } elseif ($v -eq 'ya hecho') { 'DarkGreen' } elseif ($v -eq 'pendiente') { 'Gray' } else { 'Red' }
    $txt = if ($v -eq 'pendiente') { 'no llego a ejecutarse' } else { $v }
    Write-Host ("  {0,-34} {1}" -f $k, $txt) -ForegroundColor $col
  }
  Write-Host ''
  Write-Host "  Apps: constructor = $($script:NombreConstructor), revisor = $($script:NombreRevisor)" -ForegroundColor Cyan
  if ($script:ClientIdConstructor) {
    Write-Host ''
    Write-Host "  Client id of the constructor now: $($script:ClientIdConstructor)   (not secret; information only)" -ForegroundColor Cyan
    Write-Host "  Compare it with CLIENT_ID_CONSTRUCTOR in scripts/lib/repo.mjs; if they differ, update that constant (the only place)." -ForegroundColor Cyan
  }
}
if ($script:Fallo) { exit 1 }
