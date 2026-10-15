# Piezas de gh y git que comparten arranque.ps1 y ruleset.ps1 (se cargan con punto: . .\lib-gh.ps1).
# Necesitan las funciones Info, Aviso y Bien del script que las carga.
# Sin tildes a proposito: Windows PowerShell 5.1 lee un .ps1 sin BOM como ANSI.

# Argumentos de git para usar el helper de gh SOLO en esa orden, sin tocar ~/.gitconfig:
# primero un helper vacio (borra los demas) y luego el de gh. Cada -c va en su propio elemento.
function Args-Helper-Gh {
  return @('-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential')
}

# gh auth login por el navegador sin tocar el git de nadie. Con un helper de credenciales visible
# (Pablo tiene credential.helper manager en la config de SISTEMA), gh no escribe en ~/.gitconfig:
# hace "git credential reject" y "approve" y deja su token, sin caducidad, en el Administrador de
# credenciales de Windows. Por eso el login corre con la config de sistema apagada y una global
# vacia y temporal: gh no ve ningun helper y, si escribe algo, lo escribe en el temporal.
# Pide repo y workflow: el push de main trae .github/workflows/ y GitHub lo rechaza sin workflow.
function Gh-Login {
  $antesNoSistema = $env:GIT_CONFIG_NOSYSTEM
  $antesGlobal = $env:GIT_CONFIG_GLOBAL
  $temporal = [System.IO.Path]::GetTempFileName()
  $codigo = 1
  try {
    $env:GIT_CONFIG_NOSYSTEM = '1'
    $env:GIT_CONFIG_GLOBAL = $temporal
    & gh auth login --hostname github.com --git-protocol https --web --scopes 'repo,workflow' --skip-ssh-key
    $codigo = $LASTEXITCODE
  } finally {
    if ($null -eq $antesNoSistema) { Remove-Item Env:GIT_CONFIG_NOSYSTEM -ErrorAction SilentlyContinue } else { $env:GIT_CONFIG_NOSYSTEM = $antesNoSistema }
    if ($null -eq $antesGlobal) { Remove-Item Env:GIT_CONFIG_GLOBAL -ErrorAction SilentlyContinue } else { $env:GIT_CONFIG_GLOBAL = $antesGlobal }
    Remove-Item $temporal -Force -ErrorAction SilentlyContinue
  }
  $global:LASTEXITCODE = $codigo
}

# Permisos del token de la sesion de gh abierta (cabecera X-OAuth-Scopes). Devuelve la lista;
# vacia si no se puede leer. No cambia nada.
function Gh-Permisos {
  $o = (& gh api -i user 2>&1 | Out-String)
  if ($o -notmatch '(?im)^X-OAuth-Scopes:[ 	]*(.*?)\s*$') { return @() }
  return @($Matches[1] -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

# Para una sesion de gh que ya existia: si su token no lleva workflow, lanza con lo que hacer.
function Exigir-Workflow {
  $p = Gh-Permisos
  if ($p -notcontains 'workflow') {
    throw 'La sesion de gh no tiene el permiso workflow (lo necesita el push de main). Cierrala con  gh auth logout  y relanza.'
  }
}

# Sube main de la v0 a origin con el helper de gh solo para esa orden. Devuelve 'ok' o 'ya hecho';
# si algo no cuadra, lanza. $Url permite probarlo contra un remoto local.
function Subir-Main([string]$Carpeta, [string]$Repo, [string]$Url) {
  if (-not $Url) { $Url = "https://github.com/$Repo.git" }
  if (-not (Test-Path (Join-Path $Carpeta '.git'))) { throw "No encuentro el repo de la v0 en $Carpeta (parametro -CarpetaV0)." }
  $local = (& git -C $Carpeta rev-parse --verify main 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $local) { throw "La carpeta $Carpeta no tiene rama main." }
  $actual = (& git -C $Carpeta remote get-url origin 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $actual) {
    & git -C $Carpeta remote add origin $Url
    if ($LASTEXITCODE -ne 0) { throw 'No pude anadir el remoto origin.' }
    Info "Anadido origin = $Url"
  } elseif ($actual -ne $Url -and $actual -ne ($Url -replace '\.git$', '')) {
    throw "origin en $Carpeta apunta a $actual y deberia ser $Url. Corrigelo (git remote set-url origin $Url) y relanza."
  }
  $h = Args-Helper-Gh
  $r = (& git -C $Carpeta @h ls-remote origin refs/heads/main 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "No pude leer origin: $r" }
  if ($r -match '^([0-9a-f]{40})\s') {
    if ($Matches[1] -eq $local) { Info "main ya esta arriba con el mismo commit ($($local.Substring(0, 7)))."; return 'ya hecho' }
    throw "origin/main ya existe con otro commit ($($Matches[1].Substring(0, 7))) y la v0 local es $($local.Substring(0, 7)). No empujo encima: miralo."
  }
  $p = (& git -C $Carpeta @h push -u origin main 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "git push fallo: $p" }
  Bien "main subida a origin ($($local.Substring(0, 7)))."
  return 'ok'
}
