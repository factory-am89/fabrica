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
  if ($SinAislamiento) { function Gh-Login { & gh.exe auth login --scopes 'repo,workflow'; $global:LASTEXITCODE = 0 } }
  $hGlobal = Huella "$t\global"; $hSistema = Huella "$t\sistema"
  # gh falso: hace lo que hace el real. Si ve un helper (contando el de sistema), NO lo ejecuta:
  # anota la llamada a "git credential approve" en un fichero. Si no ve ninguno, escribe en la global.
  function gh.exe {
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
  function gh.exe { cmd /c exit 3 }
  Gh-Login
  Prueba 'si gh falla, devuelve su codigo y restaura las variables' ($LASTEXITCODE -eq 3 -and $env:GIT_CONFIG_GLOBAL -eq "$t\global" -and -not $env:GIT_CONFIG_NOSYSTEM)
  # Permisos del token (cabecera X-OAuth-Scopes).
  function gh.exe { "HTTP/2.0 200 OK`r`nX-OAuth-Scopes: repo`r`n`r`n{}" }
  Prueba 'Exigir-Workflow para si falta workflow' (-not (Pasa { Exigir-Workflow }))
  function gh.exe { "HTTP/2.0 200 OK`r`nX-OAuth-Scopes: repo, workflow`r`n`r`n{}" }
  Prueba 'Exigir-Workflow deja pasar con workflow' (Pasa { Exigir-Workflow })
  function gh.exe { "HTTP/2.0 200 OK`r`n`r`n{}" }
  Prueba 'Exigir-Workflow para si no puede leer los permisos' (-not (Pasa { Exigir-Workflow }))
  Remove-Item Function:\gh.exe
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
  # Llavero: SOLO lectura de un recurso que seguro no existe. Con -Command una excepcion de Retrieve corta
  # solo esa sentencia y el 'SI' de despues se escribia igual: Llavero-Existe daba siempre que si.
  $inexistente = 'fabrica-test-inexistente-' + [guid]::NewGuid().ToString('N')
  $viejo = '[void][Windows.Security.Credentials.PasswordVault, Windows.Security.Credentials, ContentType = WindowsRuntime]; $v = New-Object Windows.Security.Credentials.PasswordVault; $c = $v.Retrieve(''' + $inexistente + ''', ''service-account''); Write-Output ''SI'''
  $oViejo = (& powershell.exe -NoProfile -NonInteractive -Command $viejo 2>$null | Out-String).Trim()
  Prueba 'control: el bloque antiguo (sin Stop) daba SI con una entrada inexistente' ($oViejo -eq 'SI')
  Prueba 'Llavero-Existe da no con una entrada inexistente' ((Llavero-Existe $inexistente 'service-account') -eq $false)
  $leido = & powershell.exe -NoProfile -NonInteractive -Command (Llavero-Orden-Leer $inexistente 'service-account' $true) 2>$null | Out-String
  Prueba 'leer el valor de una entrada inexistente sale con error y sin salida' ($LASTEXITCODE -ne 0 -and -not $leido.Trim())
  # Captura de nativos: el error de stderr sale como texto plano, sin NativeCommandError, y con su codigo.
  $n = Captura-Nativo 'cmd.exe' @('/c', 'echo boom 1>&2 & exit 3')
  Prueba 'Captura-Nativo devuelve el codigo de salida' ($n.Code -eq 3)
  Prueba 'Captura-Nativo trae el mensaje de stderr' ($n.Out -match 'boom')
  Prueba 'Captura-Nativo no mete NativeCommandError ni CategoryInfo' ($n.Out -notmatch 'NativeCommandError|CategoryInfo')
  # Apps privadas: el id sale de /user/installations (app_id y app_slug), no de /apps/<slug> (404).
  function gh.exe { $global:LASTEXITCODE = 0; '{"installations":[{"id":9,"app_id":1234567,"app_slug":"fabrica-revisor","account":{"login":"pabloam89"}},{"id":8,"app_id":42,"app_slug":"otra","account":{"login":"x"}}]}' }
  $b = Buscar-App-Instalada 'fabrica-revisor'
  Prueba 'Buscar-App-Instalada saca el app_id de la lista de instalaciones' ($b.Estado -eq 'ok' -and $b.Id -eq 1234567 -and $b.Cuenta -eq 'pabloam89')
  Prueba 'Buscar-App-Instalada dice ninguna si la App no esta en la lista' ((Buscar-App-Instalada 'no-esta').Estado -eq 'ninguna')
  function gh.exe { cmd /c "echo HTTP 403 1>&2 & exit 1" }
  Prueba 'Buscar-App-Instalada dice dudosa si gh falla' ((Buscar-App-Instalada 'fabrica-revisor').Estado -eq 'dudosa')
  Remove-Item Function:\gh.exe
} finally {
  Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue
}
