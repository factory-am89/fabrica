# Prueba de apps\lib-gh.ps1 en Windows PowerShell 5.1, sin tocar GitHub ni el ~/.gitconfig real
# (lo lanza test/lib-gh.test.js). Imprime una linea "OK: ..." por comprobacion; si falla, "FALLO: ...".
param([string]$Lib)
$ErrorActionPreference = 'Continue'
$t = Join-Path $env:TEMP ('libgh' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory $t | Out-Null
$env:GIT_CONFIG_GLOBAL = "$t\gitconfig"; $env:GIT_CONFIG_NOSYSTEM = '1'
New-Item "$t\gitconfig" -ItemType File | Out-Null
function Info($x) {}; function Aviso($x) {}; function Bien($x) {}
function Prueba([string]$n, [bool]$ok) { if ($ok) { "OK: $n" } else { "FALLO: $n" } }
try {
  . $Lib
  # gh falso: escribe el helper en la config global como hace gh al contestar que si.
  function gh { git config --global --add credential.https://github.com.helper 'x'; git config --global --add credential.https://github.com.helper '!gh auth git-credential'; cmd /c exit 0 }
  Gh-Login
  Prueba 'tras el login no queda helper de gh en la config global' (@(git config --global --get-all credential.https://github.com.helper).Count -eq 0)
  Remove-Item Function:\gh
  # Las comillas del helper llegan a git tal cual: uno vacio y el de gh, cada uno entero.
  $h = Args-Helper-Gh
  $v = @(& git @h config --get-all credential.helper)
  Prueba 'git ve el helper vacio y el de gh como dos valores' ($v.Count -eq 2 -and $v[0] -eq '' -and $v[1] -eq '!gh auth git-credential')
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
  Prueba 'la config global no ha guardado ningun helper' (-not ((Get-Content "$t\gitconfig" -Raw) -match 'helper'))
} finally {
  Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue
}
