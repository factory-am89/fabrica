## What changes

Trozo 9 del plan: `apps/proyecto-nuevo.ps1 -Repo <org/repo>`, un script que lanza Pablo con su sesion de `gh` (admin) para que un repo nuevo trabaje con la Fabrica. Idempotente, y para en alto donde algo no cuadre:

- Comprueba admin, que `main` existe y que el plan admite rulesets (repo privado con plan gratuito: 403 «Upgrade to GitHub Pro or make this repository public», el script se para con ese motivo).
- Activa fusion automatica y borrado de ramas al fusionar; deja el environment `revisor` limitado a `main` (la logica se extrajo a `Asegurar-Environment-Revisor` en `apps/lib-gh.ps1` y `arranque.ps1` ahora la llama: una idea, un sitio).
- Comprueba que `fabrica-constructor` y `fabrica-revisor` estan instaladas en el repo (valen «todos los repos» y repo a repo); si no, dice el clic exacto. No las instala ni amplia permisos.
- Dice por NOMBRE que secretos del environment faltan y el `gh secret set ...` para crearlos; nunca lee ni imprime valores.
- Abre un PR con `tests.yml` y `revisor.yml` (llaman a los reutilizables de la Fabrica), un `CLAUDE.md` minimo y `.fabrica.json` (plantillas en `apps/proyecto-nuevo/`).
- Crea el ruleset llamando a `ruleset.ps1` y comprueba que GitHub exige de verdad `tests / tests` y `revisor`.

Decision de diseno que conviene saber: el ruleset espera a que el PR de los workflows este fusionado (el check `revisor` solo corre si su workflow ya esta en `main`; con el ruleset antes, ese PR no se podria fusionar nunca). Por eso el primer lanzamiento acaba en «pendiente: fusiona el PR» y hay que relanzar. El nombre del check de tests se lee de los checks de `main` (no se inventa); si aun no hay, para y lo dice.

Decision de Pablo (16 oct 2026): las dos Apps se instalan en «All repositories» de factory-am89; el script lo acepta sin pedir clic y, si alguna vez una App no cubre el repo, sigue diciendo el clic exacto. Anotado en `PASOS-PABLO.md` (seccion «Proyecto nuevo con un solo script»).

Principles: 1 (verdad: lo no comprobado va en Not verified), 3 (fallar en alto: cada caso raro para con su motivo), 4 (una idea, un sitio: ruleset.ps1 y el environment no se duplican; los secretos exigidos los vigila un test contra `revisor.yml`), 5 (lo vigila una maquina), 6 (parar y apuntar).

## Evidence

Produced by `npm run evidence`. HEAD e0d071c; merge-base with origin/main c5e795a.

Filter, applied in code: for `node --test` (run with `--test-reporter=spec`) only lines starting with `ℹ tests`, `ℹ pass`, `ℹ fail` and `✖` are kept, and a duration at the end of a kept line, such as ` (12.3ms)`, is removed so the block is reproducible; every other command is raw. Output is stdout followed by stderr.

```
$ npm run lint

> lint
> eslint . --max-warnings 0
(exit 0)
```

```
$ node --test --test-reporter=spec
ℹ tests 490
ℹ pass 490
ℹ fail 0
(exit 0)
```

```
$ node --test --test-reporter=spec test/proyecto-nuevo.test.js
ℹ tests 4
ℹ pass 4
ℹ fail 0
(exit 0)
```

```
$ node --test --test-reporter=spec test/lib-gh.test.js
ℹ tests 4
ℹ pass 4
ℹ fail 0
(exit 0)
```

```
$ git diff --shortstat origin/main...HEAD
 12 files changed, 641 insertions(+), 15 deletions(-)
(exit 0)
```

Ademas, `node --test test/proyecto-nuevo.test.js` ejecuta `test/proyecto-nuevo.prueba.ps1` en Windows PowerShell 5.1 con un `gh` falso con estado (23 comprobaciones `OK:`, 0 `FALLO:`), que cubre: camino completo, relanzado sin cambios, privado con 403, sin admin, App sin instalar, App en otros repos, App repo a repo con el repo, ficheros que faltan (abre rama, 4 ficheros y PR; no crea ruleset), PR ya abierto, secretos que faltan (por nombre) y check de tests no observado.

## Red before

Los tests son nuevos, asi que «antes» es el script con un defecto puesto a proposito (cada mutacion se deshizo despues):

```
M1 quitar la deteccion del 403 (if ($false) { throw ... }) -> node --test test/proyecto-nuevo.test.js
FALLO: privado en plan gratuito: sale 1 con el motivo
M2 ajustes no idempotentes (nunca devuelve 'ya hecho')
FALLO: relanzado no cambia nada (salvo el PUT idempotente del environment)
M3 crear el ruleset sin esperar al PR ni a las Apps ($bloqueos = @())
FALLO: App en otros repos: dice como anadir este y no crea el ruleset
FALLO: faltan ficheros: no crea el ruleset y sale 1 diciendo que fusione
M4 sacar REVISOR_APP_KEY de $script:SecretosRevisor
✖ proyecto-nuevo.ps1 contra un gh falso ...   ✖ los secretos que el script exige son los que declara el workflow_call de revisor.yml   (pass 2, fail 2)
M5 renombrar el job `tests` de la plantilla a `pruebas`
✖ las plantillas de workflows llaman a los reutilizables de la Fabrica y pasan las reglas de maquina (C4)   (pass 3, fail 1)
```

Con el codigo bueno: `node --test test/proyecto-nuevo.test.js` da 4 de 4. Los errores intermedios de la propia prueba (variable `$R` pisada, `?` de `-like` casando `/`, splat de array) se corrigieron al escribirla.

## Not verified

- **No se ha lanzado contra GitHub real** (homenu-panel es de Pablo). Todo el comportamiento de `gh` es el de un falso escrito por mi: la forma real de las respuestas (`/user/installations`, `repository_selection`, mensaje del 403, `rules/branches/main`) sale de lo ya usado en `lib-gh.ps1`/`ruleset.ps1` y de lo dicho en el encargo, no de una llamada hoy.
- Que fabrica-revisor este instalada en «All repositories»: solo se comprobo fabrica-constructor (`seleccion=all`, 3 repos). El script lo comprobara al lanzarlo.
- Que el check de tests se llame `tests / tests` en el repo llamador (es lo esperado para job que llama / job llamado); por eso el script lo lee de los checks de `main` en vez de fijarlo.
- Que `secrets: inherit` entregue los secretos del *environment* `revisor` al workflow reutilizable (el reutilizable los declara `required: true`; el comentario de `revisor.yml` dice que los define el repo que llama). Hasta un PR real en homenu-panel no se sabe.
- Criterio de hecho del plan: tras lanzarlo Pablo, `gh api repos/factory-am89/homenu-panel/rules/branches/main` debe mostrar `tests / tests` y `revisor`, y un PR de prueba debe fusionarse solo. NO comprobado.
- La prueba del script solo corre en Windows (necesita `powershell.exe` 5.1); en el CI de Linux se salta. Las plantillas, la ficha y la lista de secretos si se comprueban en cualquier sistema.
- Rulesets de organizacion en plan gratuito: no se ha mirado (el script usa ruleset por repo).
- `Principles:` no lo comprueba `pr-body.mjs`; va por el encargo.

Orden que lanza Pablo (dos veces; entre una y otra, fusionar el PR que abre):

`powershell -ExecutionPolicy Bypass -File C:\dev\fabrica\apps\proyecto-nuevo.ps1 -Repo factory-am89/homenu-panel`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
