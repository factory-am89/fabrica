# Prueba de apps\lib-gh.ps1 en Windows PowerShell 5.1, sin tocar GitHub, ni el git ni el llavero reales
# (lo lanza test/lib-gh.test.js). Imprime una linea "OK: ..." por comprobacion; si falla, "FALLO: ...".
# -SinAislamiento sustituye Gh-Login por una version que NO aisla la config de git: sirve para ver
# que la prueba falla sin el aislamiento (la prueba normal no lo usa).
param([string]$Lib, [switch]$SinAislamiento)
$ErrorActionPreference = 'Continue'
$t = Join-Path $env:TEMP ('libgh' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory $t | Out-Null
# Config global y de SISTEMA de mentira (GIT_CONFIG_SYSTEM, git >= 2.32): el sistema trae un helper
# "manager" como el de Pablo. Nada de esto es la config real.
$env:GIT_CONFIG_GLOBAL = "$t\global"
$env:GIT_CONFIG_SYSTEM = "$t\sistema"
Remove-Item Env:GIT_CONFIG_NOSYSTEM -ErrorAction SilentlyContinue
[System.IO.File]::WriteAllText("$t\global", '')
[System.IO.File]::WriteAllText("$t\sistema", "[credential]`n`thelper = manager`n")
$script:llamadas = "$t\llamadas.log"
function Anota([string]$x) { [System.IO.File]::AppendAllText($script:llamadas, "$x`n") }
function Info($x) {}; function Aviso($x) {}; function Bien($x) {}
function Prueba([string]$n, [bool]$ok) { if ($ok) { "OK: $n" } else { "FALLO: $n" } }
function Pasa([scriptblock]$b) { try { & $b; $true } catch { $false } }
function Huella([string]$f) { (Get-FileHash $f -Algorithm SHA256).Hash }
try {
  . $Lib
  if ($SinAislamiento) { function Gh-Login { & gh auth login --scopes 'repo,workflow'; $global:LASTEXITCODE = 0 } }
  $hGlobal = Huella "$t\global"; $hSistema = Huella "$t\sistema"
  # gh falso: hace lo que hace el real. Si ve un helper (contando el de sistema), NO lo ejecuta:
  # anota la llamada a "git credential approve" en un fichero. Si no ve ninguno, escribe en la global.
  function gh {
    if ($args[0] -eq 'auth' -and $args[1] -eq 'login') {
      $ve = @(git config --get-all credential.helper 2>$null)
      Anota "scopes=$($args -join ' ')"
      Anota "env=GLOBAL:$env:GIT_CONFIG_GLOBAL"
      if ($ve.Count -gt 0) { Anota "git credential approve (helper visto: $($ve -join ','))" }
      else { git config --global --add credential.https://github.com.helper '!gh auth git-credential' }
    }
    cmd /c exit 0
  }
  Gh-Login
  $log = @(Get-Content $llamadas -ErrorAction SilentlyContinue)
  Prueba 'el login pide repo y workflow' (($log -join "`n") -match 'scopes=.*--scopes repo,workflow')
  Prueba 'el gh falso no vio ningun helper (sistema apagado, global vacia)' (-not (($log -join "`n") -match 'git credential approve'))
  Prueba 'la config global de la prueba no ha cambiado' ((Huella "$t\global") -eq $hGlobal)
  Prueba 'la config de sistema de la prueba no ha cambiado' ((Huella "$t\sistema") -eq $hSistema)
  Prueba 'tras el login las variables de git vuelven a su valor' ($env:GIT_CONFIG_GLOBAL -eq "$t\global" -and -not $env:GIT_CONFIG_NOSYSTEM)
  $temporal = ($log | Where-Object { $_ -like 'env=*' } | Select-Object -First 1) -replace '.*GLOBAL:', ''
  Prueba 'el temporal de la config global se ha borrado' ($temporal -and $temporal -ne "$t\global" -and -not (Test-Path $temporal))
  # Control: fuera del login el helper de sistema si se ve (la prueba reproduce el caso real).
  $c = @(git config --get-all credential.helper)
  Prueba 'fuera del login el helper de sistema si se ve' ($c.Count -eq 1 -and $c[0] -eq 'manager')
  # Si gh falla, tambien se restauran las variables.
  function gh { cmd /c exit 3 }
  Gh-Login
  Prueba 'si gh falla, devuelve su codigo y restaura las variables' ($LASTEXITCODE -eq 3 -and $env:GIT_CONFIG_GLOBAL -eq "$t\global" -and -not $env:GIT_CONFIG_NOSYSTEM)
  # Permisos del token (cabecera X-OAuth-Scopes).
  function gh { "HTTP/2.0 200 OK`r`nX-OAuth-Scopes: repo`r`n`r`n{}" }
  Prueba 'Exigir-Workflow para si falta workflow' (-not (Pasa { Exigir-Workflow }))
  function gh { "HTTP/2.0 200 OK`r`nX-OAuth-Scopes: repo, workflow`r`n`r`n{}" }
  Prueba 'Exigir-Workflow deja pasar con workflow' (Pasa { Exigir-Workflow })
  function gh { "HTTP/2.0 200 OK`r`n`r`n{}" }
  Prueba 'Exigir-Workflow para si no puede leer los permisos' (-not (Pasa { Exigir-Workflow }))
  Remove-Item Function:\gh
  # El push de main no pasa por el llavero: tras el helper de sistema viene el vacio, que lo borra, y
  # solo despues el de gh. Con -c, git ve los tres en este orden.
  $h = Args-Helper-Gh
  $v = @(& git @h config --get-all credential.helper)
  Prueba 'git ve manager, luego el vacio (que lo borra) y por ultimo el de gh' ($v.Count -eq 3 -and $v[0] -eq 'manager' -and $v[1] -eq '' -and $v[2] -eq '!gh auth git-credential')
  # Subida a un remoto local falso.
  git init -q --bare -b main "$t\remoto.git"
  git init -q -b main "$t\v0"
  git -C "$t\v0" -c user.name=a -c user.email=a@a commit -q --allow-empty -m v0
  Prueba 'primera subida' ((Subir-Main "$t\v0" 'x/y' "$t\remoto.git") -eq 'ok')
  Prueba 'el remoto tiene el mismo commit' ((git -C "$t\remoto.git" rev-parse main) -eq (git -C "$t\v0" rev-parse main))
  Prueba 'segunda vez la salta' ((Subir-Main "$t\v0" 'x/y' "$t\remoto.git") -eq 'ya hecho')
  git -C "$t\v0" -c user.name=a -c user.email=a@a commit -q --allow-empty -m otro
  $paro = $false; try { [void](Subir-Main "$t\v0" 'x/y' "$t\remoto.git") } catch { $paro = $true }
  Prueba 'si el remoto tiene otro commit, para sin empujar' $paro
  Prueba 'la config global no ha guardado ningun helper' ((Huella "$t\global") -eq $hGlobal)
} finally {
  Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue
}
