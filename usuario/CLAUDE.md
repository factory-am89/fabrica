# Reglas para todas las sesiones

Este fichero es la parte común de `~/.claude/CLAUDE.md`. Al instalar (`npm run install-pc`) se le añade, debajo,
la capa personal de quien instala: `usuario/personas/<persona>.md`, con `persona` en su fichero de valores.

## Dónde se trabaja

- Los repos viven en una carpeta local fuera de OneDrive: OneDrive vuelve a
  leer cada fichero que tocan los tests y el antivirus lo escanea otra vez, y
  el disco se satura.
- Los worktrees nuevos van al lado del repo, en una carpeta hermana con el
  nombre del tema. Nunca en `OneDrive`, ni en el Escritorio.
- Un worktree mergeado se borra solo: el hook de usuario
  `~/.claude/hooks/limpiar-worktrees.mjs` corre tras cada `gh pr merge` y al
  empezar sesión. Solo borra los mergeados y limpios.

## Borrar carpetas

- Antes de borrar un worktree o una carpeta, mira si `node_modules` (o
  cualquier cosa dentro) es una unión o un enlace. Quita primero la unión
  (`[System.IO.Directory]::Delete(ruta, $false)` en PowerShell) y luego la
  carpeta. Borrar en recursivo a través de una unión vacía la carpeta de
  destino (pasó el 8 oct 2026 con el `node_modules` del repo principal).
- Para worktrees, usa `node ~/.claude/hooks/limpiar-worktrees.mjs --si`,
  que ya lo hace bien, en vez de un bucle a mano.
- Nada de `git stash` con worktrees en paralelo: el stash es común a todos y
  se cruza entre sesiones.

## La hora

- La hora local se calcula con Node
  (`node -e "console.log(new Date().toLocaleString('es-ES',{timeZone:'<zona>'}))"`),
  **nunca con `date`**: en Git Bash `TZ=<zona> date` devuelve la hora UTC con
  `+0000` y sin ningún error. El 8 oct 2026 todas las horas límite que se
  dieron salieron 2 h antes. La zona de cada persona está en su capa personal.

## Pensar en datos

- Todo lo que se repite, en vocabulario cerrado y tabulado, para poder
  contarlo; la clase del problema y no el caso; la cifra antes y después de
  cada arreglo. En MenuPlan, detalle en su CLAUDE.md («Pensar en datos»).

## Tests

- Lanza los tests de los ficheros que tocas, no la suite entera, salvo justo
  antes de abrir un PR. Varias sesiones con la suite completa a la vez saturan
  la máquina.
