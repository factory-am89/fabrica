# Reglas de Pablo para todas las sesiones

## Dónde se trabaja

- El repo de MenuPlan vive en `C:\dev\MenuPlan`. Nunca dentro de OneDrive:
  OneDrive vuelve a leer cada fichero que tocan los tests y el antivirus lo
  escanea otra vez, y el disco se satura.
- Los worktrees nuevos van al lado, en `C:\dev\MenuPlan-<tema>`. Nunca en
  `OneDrive`, ni en el Escritorio.
- Un worktree mergeado se borra solo: el hook de usuario
  `C:\Users\pablo\.claude\hooks\limpiar-worktrees.mjs` corre tras cada
  `gh pr merge` y al empezar sesión. Solo borra los mergeados y limpios.

## Borrar carpetas

- Antes de borrar un worktree o una carpeta, mira si `node_modules` (o
  cualquier cosa dentro) es una unión o un enlace. Quita primero la unión
  (`[System.IO.Directory]::Delete(ruta, $false)` en PowerShell) y luego la
  carpeta. Borrar en recursivo a través de una unión vacía la carpeta de
  destino (pasó el 8 oct 2026 con el `node_modules` del repo principal).
- Para worktrees, usa `node C:\Users\pablo\.claude\hooks\limpiar-worktrees.mjs --si`,
  que ya lo hace bien, en vez de un bucle a mano.
- Nada de `git stash` con worktrees en paralelo: el stash es común a todos y
  se cruza entre sesiones.

## La hora

- Pablo vive en Madrid. La hora local se calcula con Node
  (`node -e "console.log(new Date().toLocaleString('es-ES',{timeZone:'Europe/Madrid'}))"`,
  o `npm run hora` en MenuPlan), **nunca con `date`**: en Git Bash
  `TZ=Europe/Madrid date` devuelve la hora UTC con `+0000` y sin ningún error.
  El 8 oct 2026 todas las horas límite que se le dieron salieron 2 h antes.

## Pensar en datos

- Todo lo que se repite, en vocabulario cerrado y tabulado, para poder
  contarlo; la clase del problema y no el caso; la cifra antes y después de
  cada arreglo. En MenuPlan, detalle en su CLAUDE.md («Pensar en datos»).

## Cómo responder a Pablo

- Primera línea: **la idea raíz, en negrita**, una sola frase.
- Cuatro ideas clave como mucho, cortas y en llano: un término técnico se
  explica en media frase o se evita. Sin listas de ficheros ni detalles que
  no pida; el detalle va a un issue o a un fichero.
- Si necesitas algo de él, al final y en una línea; si es una decisión, tres
  opciones entendibles con la recomendada primero.
- En MenuPlan, el detalle de la forma está en la skill `estilo-de-respuesta`.

## Tests

- Lanza los tests de los ficheros que tocas, no la suite entera, salvo justo
  antes de abrir un PR. Varias sesiones con la suite completa a la vez saturan
  la máquina.
