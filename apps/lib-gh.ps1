# Piezas de gh y git que comparten arranque.ps1 y ruleset.ps1 (se cargan con punto: . .\lib-gh.ps1).
# Necesitan las funciones Info, Aviso y Bien del script que las carga.
# Sin tildes a proposito: Windows PowerShell 5.1 lee un .ps1 sin BOM como ANSI.

# Claves de ~/.gitconfig donde gh auth login deja su helper si se contesta que si a
# "Authenticate Git with your GitHub credentials?". gh 2.x no trae ninguna opcion para no preguntarlo.
$script:ClavesHelperGh = @('credential.https://github.com.helper', 'credential.https://gist.github.com.helper')

# Argumentos de git para usar el helper de gh SOLO en esa orden, sin tocar ~/.gitconfig:
# primero un helper vacio (borra los demas) y luego el de gh. Cada -c va en su propio elemento.
function Args-Helper-Gh {
  return @('-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential')
}

# gh auth login por el navegador sin dejar rastro en la config de git: pide contestar n y,
# si aun asi gh escribio su helper en ~/.gitconfig (y antes no habia ninguno en esa clave), lo quita.
function Gh-Login {
  $antes = @{}
  foreach ($k in $script:ClavesHelperGh) { $antes[$k] = @(& git config --global --get-all $k 2>$null) }
  Info 'Si gh pregunta "Authenticate Git with your GitHub credentials?", contesta  n  (no queremos que toque tu git).'
  & gh auth login --hostname github.com --git-protocol https --web --scopes repo --skip-ssh-key
  $codigo = $LASTEXITCODE
  foreach ($k in $script:ClavesHelperGh) {
    $ahora = @(& git config --global --get-all $k 2>$null)
    if ($ahora.Count -eq 0) { continue }
    if ($antes[$k].Count -eq 0) {
      & git config --global --unset-all $k 2>&1 | Out-Null
      Aviso "gh habia dejado su helper en tu git ($k): lo he quitado."
    } else {
      Aviso "Tu git ya tenia valores en $k : no los toco. Mira  git config --global --get-all $k"
    }
  }
  $global:LASTEXITCODE = $codigo
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
