# Plan: puente 1, la Fábrica opera HoMenu (pabloam89/MenuPlan) con su pipeline completo

Verdict: viable, pero hoy no arranca: las tres Apps de la Fábrica son privadas y solo pueden vivir en factory-am89, y en cuanto `revisor` sea obligatorio en `staging` se paran los PR de homenu-sesiones, Dependabot y mercadona-sync si no se cambian antes; la clave del revisor que reciba HoMenu sirve también para falsear el check de la Fábrica, así que HoMenu tiene que quedar igual de cerrado que `main` de la Fábrica (A, B y C son de Pablo).

Fecha: 28 oct 2026. Base leída: Fábrica en `d62c85e` (main); MenuPlan en `origin/staging` = `579627be` (leído con `git show origin/staging:<ruta>`, sin checkout ni pull; ver Not verified sobre el fetch).

Cada trozo dice en el título en qué repo se construye; sus `Files` son relativos a ese repo. Fuera de este plan: el puente 2 (Álvaro usando la Fábrica) y convertir los fallos de las evals de Lola en tests deterministas.

## Lo desagradable primero

- **Las Apps no llegan a HoMenu.** `fabrica-revisor`, `fabrica-constructor` y `fabrica-administrador` son privadas: `curl -s -o /dev/null -w "%{http_code}" https://api.github.com/apps/SLUG` -> `404` para las tres, y `200` para `homenu-sesiones`. El manifiesto lo dice: `"public":false` (`apps/crear-apps.html:13,18,23`). Una App privada solo se instala en la cuenta que la posee (según la documentación de GitHub, https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private; no lo he probado: ver Not verified) (factory-am89); MenuPlan es de la cuenta personal (`gh api repos/pabloam89/MenuPlan --jq .owner.type` -> `User`). Precedente: `homenu-sesiones` es de factory-am89 (`gh api apps/homenu-sesiones --jq .owner.login` -> `factory-am89`), es pública y ya trabaja en MenuPlan.
- **La clave del revisor es de una sola App.** El check `revisor` de la Fábrica lo publica la App 5332150 (`gh api repos/factory-am89/fabrica/rules/branches/main` -> `{"context":"revisor","integration_id":5332150}`), la misma que juzgaría HoMenu. Quien saque `REVISOR_APP_KEY` del environment `revisor` de HoMenu puede pedir un token para la instalación de factory-am89 y poner `revisor` en verde en un PR de la Fábrica. El environment solo protege si nadie puede meter un workflow en `staging` sin pasar el revisor; hoy sí se puede: el ruleset de `staging` solo pide `tests` y deja pasar siempre a una deploy key (`gh api repos/pabloam89/MenuPlan/rulesets/24770007 --jq .bypass_actors` -> `[{"actor_type":"DeployKey","bypass_mode":"always"}]`).
- **Romper el flujo de hoy es el riesgo real.** De los 40 últimos PR fusionados, 36 los abrió y fusionó `homenu-sesiones`, 3 Dependabot (fusionados por `github-actions`) y 1 Pablo (`gh pr list --repo pabloam89/MenuPlan --state merged --limit 40 --json author,mergedBy`). El juez reutilizable solo acepta los bots `fabrica-constructor,fabrica-administrador` (`.github/workflows/revisor.yml:122`), así que un PR de `homenu-sesiones` recibiría «no» siempre; un PR de Dependabot no ve secretos de Actions y el revisor ni llega a publicar; mercadona-sync empuja directo a `staging` con la deploy key (`.github/workflows/mercadona-sync.yml:23-31` de MenuPlan).
- **El estándar de la Fábrica se aplicará a medias.** En HoMenu el check `tests` es el suyo (vitest, lint con línea base, build; `.github/workflows/tests.yml` de MenuPlan), no el de la Fábrica: las preguntas de máquina C1 a C4 de `standards/code.md` no corren allí (MenuPlan usa `actions/checkout@v7` sin fijar por SHA, lo que C4 rechazaría). El revisor solo contesta las preguntas de «Quién: revisor». Cambiar `tests` por el de la Fábrica pondría en rojo todos los PR de hoy; queda fuera.
- **Hoy no fusiona GitHub.** `gh api repos/pabloam89/MenuPlan --jq .allow_auto_merge` -> `false`: fusiona la propia sesión (`CLAUDE.md:21` de MenuPlan, «Ese PR lo fusiona la propia sesión»).

## Estado medido

- Rama buena `staging`; `main` es producción con dos rulesets propios («main: PR y tests», «main: solo Pablo fusiona»), que este plan no toca.
- Ruleset de `staging` (24770007): solo `required_status_checks` con `tests` (integración 15368), `strict_required_status_checks_policy: false`, sin `pull_request`, con bypass de deploy key. Protección clásica: `enforce_admins` true, sin force push ni borrado. Colaboradores: `pabloam89 admin`, `algbarc-design write`.
- Environments de MenuPlan: `dependabot-auto` (secreto `DEPENDABOT_APP_KEY`), `mercadona-sync` (`MERCADONA_DEPLOY_KEY`), `vigia` y los de Vercel; no hay `revisor` (`gh api repos/pabloam89/MenuPlan/environments`). Deploy key: `165871736 mercadona-sync: cron, push a staging`, `read_only` false.
- Workflows en `staging`: bot-semanal, dependabot-auto, ios-testflight, mercadona-sync, salud-despliegue, tests, vigia-lola (`git ls-tree --name-only origin/staging .github/workflows/`). Sin revisor.
- Ritmo: 100 PR fusionados entre el 12 y el 28 oct, con picos de 29 y 41 en un día (`gh pr list ... --limit 100 --json mergedAt`). Choques: de los runs de `tests` por push a `staging` en ese tramo, 88 success, 5 failure, 7 cancelled; 3 de los 5 rojos son fusiones de PR (#772 y #773, 14 oct; #730, 14 oct) y 2 son empujes directos de mercadona-sync (12 y 26 oct; `gh run list --repo pabloam89/MenuPlan --workflow tests.yml --branch staging --event push --limit 100 --json conclusion,createdAt,displayTitle`) (`gh run list --workflow tests.yml --branch staging --event push --limit 100`).
- Una sesión de la Fábrica puede escribir hoy en la carpeta principal de MenuPlan sin que nada lo niegue: un `Write` en `C:/dev/MenuPlan/prueba.txt` con `cwd` `C:/dev/fabrica`, pasado por stdin a `node .claude/hooks/carpeta-principal.mjs` -> sin salida (no niega); con `C:/dev/fabrica/prueba.txt` -> `deny`. La guardia de MenuPlan (`guardia-minima.mjs`) solo corre en sesiones abiertas en MenuPlan (su `.claude/settings.json`, `PreToolUse`), no en una sesión de la Fábrica.

## Fases para quien trabaja hoy en HoMenu

- Fase 0 (trozos 1 a 9, solo en la Fábrica): nada cambia en HoMenu. Álvaro, `homenu-sesiones`, Dependabot y mercadona-sync siguen igual.
- Fase 1 (trozos 10 a 16 en HoMenu, PR normales con `tests`): el revisor ya corre en cada PR a `staging`, pero aún no es obligatorio; nadie se queda parado. Debe durar lo que tarda Pablo en hacer los pasos 4 a 7 de una sentada, porque mientras dura la clave del revisor está en un repo que acepta fusiones solo con `tests`.
- Fase 2 (paso 6 de Pablo): `staging` exige PR, `tests` y `revisor`, al día. Álvaro sigue con su permiso de escritura y sus PR los juzga el revisor; `homenu-sesiones` sigue abriendo y fusionando PR, ahora con los dos checks; Dependabot y mercadona según la decisión B. Un «no» injusto se anula con el Approve de Pablo (trozos 7 y 12).

## Chunks

### 1. (Fábrica) Medir antes: el juez de la Fábrica sobre los últimos PR fusionados de HoMenu, en local y sin secretos en HoMenu
Files: `scripts/medir-repo.mjs`, `test/medir-repo.test.js`
Depends on: none
Blocked by: none
Existing: `scripts/golden-run.mjs:2` ya juzga en local un corpus de casos (`pr.diff` y `body.md`) con `--corpus DIR --phase collect`, con el mismo prompt y modelo que `revisor.yml`, pero su fase `score` exige `expected.json` y nada construye un corpus desde los PR reales de otro repo: `git grep -n -i "medir-repo\|pabloam89/MenuPlan" -- scripts test` -> sin salida.
Not done: no corre en CI ni toca HoMenu; lee los PR por la API pública (identidad `ninguna`, `scripts/lib/identities.mjs:15`) y llama a `golden-run.mjs` en fase `collect`, sin copiar su forma de llamar a claude. No cambia el estándar ni el juez. La cifra (cuántos de los últimos 20 PR recibirían «no» y en qué preguntas) va al issue de este plan, no a un fichero. No reproduce el checkout de la base que tiene el juez de CI: el espacio de trabajo local solo trae `.fabrica/`, el diff y el cuerpo. Los fallos de las evals de Lola no se tocan. El test usa el claude falso (`GOLDEN_CLAUDE_BIN`, `test/fixtures/claude-falso.mjs`) y una respuesta de GitHub grabada.
Done:
```sh
node --test test/medir-repo.test.js
```

### 2. (Fábrica) `tarea` y `retire` sirven para un repo ajeno: la rama base sale de su ficha y no se le ponen los hooks de git de la Fábrica
Files: `scripts/tarea.mjs`, `scripts/retire.mjs`, `test/tarea-ficha.test.js`
Depends on: none
Blocked by: none
Existing: `scripts/tarea.mjs:17-20` y `scripts/retire.mjs:32-33` fijan `origin/main`; `scripts/tarea.mjs:23` llama siempre a `instalarHooks`, que pone `core.hooksPath .githooks` en el repo (`scripts/install-hooks.mjs:11`) y en MenuPlan apagaría sus hooks de `.git/hooks`. La ficha `.fabrica.json` ya guarda `repo`, `base` e `identidad`, y la lee `clean.mjs` con `--repo <carpeta>` (`scripts/lib/repo-card.mjs:3-6`, `scripts/clean.mjs:6`). `ls test | grep tarea` -> sin salida.
Not done: reutiliza el campo `base` de la ficha y no añade ninguno (comparado con `scripts/lib/repo-card.mjs`: misma idea). La ficha no está en `entities.json` ni en `fields.json`: hueco anotado, no arreglado aquí. Los prefijos de rama siguen siendo `feat/`, `fix/` y `ops/` (MenuPlan los acepta, `CLAUDE.md:23` de MenuPlan). En la Fábrica todo sigue igual (su ficha dice `main`). Sin ficha en el repo, falla en alto como `clean.mjs`.
Done:
```sh
node --test test/tarea-ficha.test.js test/folders.test.js test/principal.test.js
```

### 3. (Fábrica) La identidad `fabrica-constructor` vale también en repos de pabloam89
Files: `scripts/lib/identities.mjs`, `test/identidades-dueno.test.js`
Depends on: none
Blocked by: A
Existing: `scripts/lib/identities.mjs:13` limita `fabrica-constructor` a un solo dueño (factory-am89, sacado de `REPO`), y `leerFicha` rechaza una ficha de `pabloam89/MenuPlan` con esa identidad (`scripts/lib/repo-card.mjs:30-33`). `token.mjs` ya canjea para otro dueño, sin caché (`scripts/token.mjs:215-223`). `ls test | grep -i identit` -> sin salida. Campos nuevos: ninguno en `fields.json`; `dueno` es una clave de la constante `IDENTIDADES` de código, no un campo de entidad, y `git grep -n -i "dueno" -- fields.json entities.json` -> sin salida (ninguna fila equivalente que reutilizar).
Not done: solo si A es la opción 1; con la 2 sobra y no se construye. `dueno` pasa de un texto a una lista cerrada de dueños, nunca a «cualquiera». No añade caché por dueño: hoy cada llamada fuera de factory-am89 lee 1Password, con tope de 60 lecturas por hora (`scripts/token.mjs:152`); si el constructor lo agota, otro trozo.
Done:
```sh
node --test test/identidades-dueno.test.js test/clean.test.js
```

### 4. (Fábrica) `carpeta-principal` niega la carpeta principal de cualquier repo, no solo la del repo de la sesión
Files: `.claude/hooks/carpeta-principal.mjs`, `test/principal.test.js`
Depends on: none
Blocked by: C
Existing: `.claude/hooks/carpeta-principal.mjs:201` saca las carpetas de `entrada.cwd`, así que solo conoce el repo de la sesión; la prueba de «Estado medido» deja pasar un `Write` en `C:/dev/MenuPlan/prueba.txt`. Fallo reproducido por la entrada real del hook (stdin JSON de `PreToolUse`, `cwd` de una carpeta de la Fábrica, `node .claude/hooks/carpeta-principal.mjs`): con `C:/dev/MenuPlan/prueba.txt` -> sin salida (no niega); con `C:/dev/fabrica/prueba.txt` -> `deny`; con la carpeta de la propia sesión -> sin salida. Cifra antes: 1 de 2 carpetas principales protegidas; después (criterio del test): 2 de 2. Quién más lee o escribe la misma regla de carpeta, buscado con `git grep -l "carpeta-principal\|folders.mjs" -- . ":!plans" ":!test"` (14 ficheros): `.claude/settings.json` (dispara el hook), `scripts/clean.mjs`, `scripts/retire.mjs`, `scripts/tarea.mjs`, `scripts/install-hooks.mjs`, `scripts/pull-main.mjs`, `scripts/sesiones.mjs`, `scripts/limpiar-al-terminar.mjs`, `scripts/prejuicio.mjs`, `scripts/lib/can-delete.mjs`, y como texto `CLAUDE.md`, `.claude/skills/github/referencias/subir.md` e `intervenciones.md`; los hooks de git (`.githooks/denegar-principal.sh`) son otra capa, no leen el hook.
Not done: clase: una regla de carpeta que solo mira el repo de la sesión. Calcula la principal desde la ruta tocada (su `git worktree list`), sin lista de repos. Lector: el propio hook; disparador: `PreToolUse` de `.claude/settings.json`; el test lo prueba por la entrada real (stdin del hook) con un caso en rojo sobre otro repo. No toca los hooks de git de `.githooks/` ni la guardia de MenuPlan. Endurece un check (C13); si rompe, se revierte el PR desde una rama nueva.
Done:
```sh
node --test test/principal.test.js
```

### 5. (Fábrica) El constructor sabe trabajar en un repo que la Fábrica opera
Files: `.claude/agents/constructor.md`
Depends on: 2
Blocked by: none
Existing: `.claude/agents/constructor.md` solo habla de `origin/main`, `npm run lint`, `npm test`, `pr-body.mjs` y `prejuicio` de la Fábrica (`grep -n "origin/main\|npm test" .claude/agents/constructor.md` -> líneas 8, 12 y 13); `grep -n -- "--repo" .claude/agents/constructor.md` -> sin salida.
Not done: dice: carpeta hermana del repo con `tarea --repo`; antes de escribir, leer el `CLAUDE.md` y `.claude/rules/` del repo; los tests del repo (en MenuPlan, `npx vitest run` con los ficheros tocados, y la suite solo antes del PR); token con `FABRICA_REPO`; cuerpo del PR con la plantilla de la Fábrica más la línea `Jueces: …, seguridad` cuando el repo la pide (`CLAUDE.md:32` de MenuPlan). `prejuicio` no sirve fuera de la Fábrica (`scripts/prejuicio.mjs:56` juzga `git diff MAIN_REF...HEAD` de su propio checkout): se dice, no se arregla aquí. No toca la skill `github` (tope de 120 líneas; `plans/menuplan-separation.md`, trozo 3).
Done:
```sh
node --test test/principles-and-roles.test.js test/contrato.test.js && git grep -q -- "--repo" .claude/agents/constructor.md
```

### 6. (Fábrica) El juez reutilizable acepta los bots que le pase el repo que lo llama
Files: `.github/workflows/revisor.yml`, `test/revisor-workflow.test.js`
Depends on: none
Blocked by: C
Existing: `allowed_bots` es fijo: `grep -n "allowed_bots\|inputs:" .github/workflows/revisor.yml` -> `122: allowed_bots: fabrica-constructor,fabrica-administrador`, sin `inputs:`. `test/revisor-workflow.test.js:38` ya exige `workflow_call`.
Not done: una entrada `bots` de `workflow_call` que se suma a la lista fija; en la propia Fábrica la lista no cambia. Comparado con `fields.json` y `entities.json` (`git grep -n -i "bots" -- fields.json entities.json` -> sin salida): `bots` es una entrada de `workflow_call`, no un campo de entidad, y no hay otra equivalente que reutilizar. No añade ni quita ninguna pregunta ni paso del juez (C13: amplía quién puede despertar al juez solo en el repo que llama); si rompe, se revierte desde una rama nueva.
Done:
```sh
node --test test/revisor-workflow.test.js test/workflows.test.js test/gate-files.test.js
```

### 7. (Fábrica) La anulación por Pablo también se puede llamar desde otro repo
Files: `.github/workflows/anulacion.yml`, `test/anulacion.test.js`
Depends on: none
Blocked by: C
Existing: `grep -n "workflow_call\|repository: factory-am89" .github/workflows/anulacion.yml` -> sin salida; corre el `veredicto.mjs` del checkout del propio repo, no de `.fabrica/`. `test/anulacion.test.js:124` exige «solo workflow_run».
Not done: añade `workflow_call` y baja el juez de la Fábrica a `.fabrica/` en `job.workflow_sha`, como `revisor.yml`. La regla de `aprobacionDePablo` (`OWNER_LOGIN`, cabeza actual, última review decisiva) no cambia, y el test sigue exigiendo todo lo demás (C13). Si rompe, se revierte desde una rama nueva.
Done:
```sh
node --test test/anulacion.test.js test/workflows.test.js
```

### 8. (Fábrica) El cuerpo del ruleset sirve para la rama buena de HoMenu: strict y nombre como parámetros, y una orden que lo imprime
Files: `scripts/admin/proyecto.mjs`, `scripts/admin/cuerpo-ruleset.mjs`, `test/admin-proyecto.test.js`
Depends on: none
Blocked by: none
Existing: `scripts/admin/proyecto.mjs:80` fija el nombre `main` y `scripts/admin/proyecto.mjs:94` `strict_required_status_checks_policy: false`; la condición ya es `~DEFAULT_BRANCH`, que en MenuPlan es `staging`. `ls scripts/admin` -> `aplicar.mjs crear.mjs humo.mjs leer-plan.mjs proyecto.mjs secretos.mjs`; ninguno imprime el cuerpo.
Not done: por defecto todo queda igual (homenu-panel no cambia). La orden solo imprime JSON; aplicarlo es el paso 6 de Pablo. Sin campos nuevos en `fields.json` ni `entities.json` (`git grep -n -i "strict_required" -- fields.json entities.json` -> sin salida): `strict` y el nombre son parámetros de una función de código, no campos de entidad. Mantiene `bypass_actors` vacío y `enforcement` en `active` (lo siguen vigilando `test/ruleset-never-paused.test.js` y `test/administrador.test.js`). Toca la puerta (`scripts/admin/`, `ADMIN_GATE_FILES` de `scripts/lib/gate.mjs`) sin aflojar nada: solo añade strict donde se pide (C13); si rompe, se revierte desde una rama nueva. No enseña a `administrar.yml` la rama `staging` (si A es 2, otro trozo: `scripts/admin/proyecto.mjs:172` y el PR de humo fijan `main`).
Done:
```sh
node --test test/admin-proyecto.test.js test/ruleset-never-paused.test.js test/administrador.test.js
```

### 9. (Fábrica) `PASOS-PABLO.md` lleva los clics del puente HoMenu
Files: `PASOS-PABLO.md`
Depends on: 8
Blocked by: A
Existing: `grep -n -i "pabloam89/MenuPlan" PASOS-PABLO.md` -> sin salida; su sección de proyectos solo cubre repos de factory-am89 (`PASOS-PABLO.md:10`).
Not done: copia la lista «Pasos de Pablo» de este plan según la respuesta a A y apunta a `scripts/admin/cuerpo-ruleset.mjs`; ningún valor de secreto. Las respuestas a A, B y C van como filas de `intervenciones.md` en el PR que las recoja, no aquí.
Done:
```sh
git grep -q "pabloam89/MenuPlan" -- PASOS-PABLO.md && git grep -q "cuerpo-ruleset" -- PASOS-PABLO.md
```

### 10. (MenuPlan) La ficha `.fabrica.json` de HoMenu
Files: `.fabrica.json`
Depends on: 2, 3
Blocked by: A
Existing: `git show origin/staging:.fabrica.json` -> `fatal: path '.fabrica.json' does not exist in 'origin/staging'`.
Not done: repo `pabloam89/MenuPlan`, base `staging`, identidad `fabrica-constructor`; con A = 2 cambia el dueño de `repo`. No es el PR de humo de `administrar.yml`. El Done se lanza desde una carpeta de la Fábrica (la guardia de MenuPlan no deja ejecutar en `C:/dev/fabrica*`) contra la principal de MenuPlan ya al día.
Done:
```sh
npm run clean -- --ensayo --repo C:/dev/MenuPlan
```

### 11. (MenuPlan) Workflow `revisor.yml` que llama al juez de la Fábrica, solo en PR a `staging`
Files: `.github/workflows/revisor.yml`, `ops/revisor-fabrica.test.js`
Depends on: 6
Blocked by: A, B, C
Existing: `git ls-tree --name-only origin/staging .github/workflows/` -> 7 ficheros, ninguno `revisor.yml`; `git ls-tree --name-only origin/staging ops/` no tiene `revisor-fabrica.test.js`.
Not done: parte de la plantilla `apps/proyecto-nuevo/revisor.yml` de la Fábrica, con `branches: [staging]` y la entrada `bots` con `homenu-sesiones,homenu-dependabot-merge`. No hace el check obligatorio (paso 6 de Pablo) ni crea el environment ni sus secretos (paso 4). A este PR no lo juzga el revisor (corre con `pull_request_target` desde la base, que aún no tiene el fichero); lleva `Jueces: …, seguridad` porque toca un workflow (`CLAUDE.md:32` de MenuPlan). Es puerta (define el check `revisor` de HoMenu): añade un check y no quita ni afloja ninguno (C13); si rompe, se revierte desde una rama nueva.
Done:
```sh
npx vitest run ops/revisor-fabrica.test.js
```

### 12. (MenuPlan) `senal-review.yml` y `anulacion.yml` que llaman a los de la Fábrica
Files: `.github/workflows/senal-review.yml`, `.github/workflows/anulacion.yml`, `ops/anulacion-fabrica.test.js`
Depends on: 7, 11
Blocked by: A, C
Existing: `git ls-tree --name-only origin/staging .github/workflows/ | grep -i "anulacion\|senal"` -> sin salida; `git ls-tree --name-only origin/staging ops/ | grep -i anulacion` -> sin salida (no existe `ops/anulacion-fabrica.test.js`).
Not done: solo los dos que llaman; la regla vive en la Fábrica. El Approve solo vale de `pabloam89` (`OWNER_LOGIN`, `scripts/lib/repo.mjs`); que Álvaro pueda anular es del puente 2. Es puerta (publica `revisor` en verde con el Approve de Pablo): la regla y sus tres condiciones siguen en la Fábrica, sin aflojar (C13); si rompe, se revierte desde una rama nueva.
Done:
```sh
npx vitest run ops/anulacion-fabrica.test.js
```

### 13. (MenuPlan) dependabot-auto despierta al revisor con su App y no fusiona sin `revisor`
Files: `.github/workflows/dependabot-auto.yml`, `scripts/dependabot-auto.mjs`, `scripts/dependabot-auto.test.js`
Depends on: 11
Blocked by: B, C
Existing: el workflow fusiona «con `tests` en verde» (`.github/workflows/dependabot-auto.yml:1-2` de MenuPlan); `git show origin/staging:scripts/dependabot-auto.mjs | grep -c revisor` -> `0`.
Not done: la pasada programada (la que no es evento de Dependabot) toca el PR con el token de `homenu-dependabot-merge` para que `pull_request_target` corra como esa App y vea el environment; los de versión mayor siguen para una sesión. No da secretos de Actions a Dependabot. Con B = 3 este trozo no se construye.
Done:
```sh
npx vitest run scripts/dependabot-auto.test.js
```

### 14. (MenuPlan) mercadona-sync abre un PR en vez de empujar a `staging`
Files: `.github/workflows/mercadona-sync.yml`, `ops/mercadona-pr.test.js`
Depends on: 11
Blocked by: B, C
Existing: `git ls-tree --name-only origin/staging ops/ | grep -i mercadona` -> sin salida (no existe `ops/mercadona-pr.test.js`); `.github/workflows/mercadona-sync.yml:23-31` de MenuPlan empuja con `MERCADONA_DEPLOY_KEY` porque la deploy key es la única excepción del ruleset; 2 de sus empujes dejaron `staging` en rojo (runs del 12 y del 26 oct, «Estado medido»).
Not done: abre el PR con un token de App (según la documentación de GitHub, https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication, los eventos creados con `GITHUB_TOKEN` no lanzan otros workflows; no lo he probado en HoMenu) y arma la fusión automática. Borrar la deploy key y su excepción es el paso 7 de Pablo (irreversible). Con B = 2 o 3 este trozo no se construye.
Done:
```sh
npx vitest run ops/mercadona-pr.test.js ops/workflows.test.js
```

### 15. (MenuPlan) Despertador «al día»: tras cada fusión pone al día solo el PR armado más antiguo
Files: `.github/workflows/al-dia.yml`, `scripts/al-dia.mjs`, `scripts/al-dia.test.js`
Depends on: 11
Blocked by: C
Existing: `git ls-tree -r --name-only origin/staging | grep -i "al-dia"` -> sin salida. Hoy solo pone al día un PR la sesión que lo abrió (`gh pr update-branch` está permitido en `.claude/settings.json` de MenuPlan).
Not done: en cada push a `staging`, llama a `update-branch` del PR abierto a `staging` más antiguo con fusión automática armada y detrás de la base, con el token de `homenu-dependabot-merge` (con `GITHUB_TOKEN` el push no lanzaría `tests`). Uno cada vez: con strict, poner al día a todos repetiría `tests` y `revisor` en cada PR abierto tras cada fusión. Lector: el propio workflow; disparador: `push` a `staging`.
Done:
```sh
npx vitest run scripts/al-dia.test.js ops/workflows.test.js
```

### 16. (MenuPlan) `CLAUDE.md`: el PR a `staging` pasa por `tests` y `revisor`, al día, y lo fusiona GitHub
Files: `CLAUDE.md`
Depends on: 11
Blocked by: A, C
Existing: `git show origin/staging:CLAUDE.md | grep -n "fusiona la propia sesión"` -> línea 21; `git show origin/staging:CLAUDE.md | grep -c revisor` -> `0`.
Not done: solo la sección «Ramas, carpetas y PR»: estándar `standards/code.md` de la Fábrica, `gh pr merge --auto`, arreglar un «no» en la rama, Approve de Pablo como salida. No toca las skills ni el resto. `plans/menuplan-separation.md` (trozo 6) también edita este `CLAUDE.md`: van uno detrás de otro, nunca a la vez.
Done:
```sh
git grep -q "revisor" -- CLAUDE.md && ! git grep -q "fusiona la propia sesión" -- CLAUDE.md
```

## Build order

Ola 1 (Fábrica, sin Pablo): 1, 2 y 8, y 5 tras 2. Ola 2 (Fábrica): 4, 6 y 7 tras C; 3 y 9 tras A. Ola 3 (MenuPlan, tras A, B y C): 10 y 11; luego 12, 13, 14, 15 y 16. Los pasos 4 a 7 de Pablo van de una sentada cuando 11, 13, 14 y 15 estén en `staging`. El 1 va primero: su cifra dice si hay que ajustar algo antes de que el revisor sea obligatorio.

## Pasos de Pablo

Solo lo que la lista cerrada de `standards/intervention.md` le reserva (permisos, secretos, la puerta, lo irreversible). Para la opción recomendada de A:

1. Contestar A, B y C (unos 3 min).
2. En los ajustes de `fabrica-revisor` y de `fabrica-constructor` en GitHub, «Make public» (unos 2 min). Cambia quién puede instalarlas, no sus permisos.
3. Instalarlas en la cuenta pabloam89, «Only select repositories», solo MenuPlan (unos 2 min).
4. Generar una clave nueva de `fabrica-revisor` solo para HoMenu (se puede revocar sin tocar la de la Fábrica), crear el environment `revisor` de MenuPlan limitado a la rama `staging` y guardar los tres secretos `REVISOR_APP_KEY` (leyendo el fichero de la clave por la entrada), `REVISOR_CLIENT_ID` y `CLAUDE_CODE_OAUTH_TOKEN` (de `claude setup-token`) en ese environment; borrar el fichero de la clave (unos 8 min).
5. En MenuPlan, activar «Allow auto-merge» (unos 30 s).
6. Aplicar el ruleset de `staging` con la salida de `node scripts/admin/cuerpo-ruleset.mjs` (trozo 8), con un PUT a `repos/pabloam89/MenuPlan/rulesets/24770007`: PR obligatorio, `tests` y `revisor` (App 5332150), al día y sin excepciones. Luego cerrar la sesión de `gh` (unos 3 min).
7. Con B = 1 y el trozo 14 ya fusionado: borrar la deploy key `mercadona-sync` y el secreto `MERCADONA_DEPLOY_KEY` (irreversible; si hiciera falta se crea otra) y guardar en el environment `mercadona-sync` la clave de la App con la que abrirá el PR (unos 4 min).

Con A = 2 cambian los pasos 2 a 4: transferir el repo, reinstalar en factory-am89 lo que hoy cuelga de pabloam89 (Vercel, `homenu-dependabot-merge`), y los secretos los escribe `administrar.yml` tras enseñarle la rama `staging`.

## Cifras antes y después

- PR fusionados en `staging` juzgados por el revisor: antes, 0 de 100 (12 a 28 oct); después, todos.
- Fusiones que dejan `staging` en rojo: antes, 3 de unas 100 fusiones de PR y 2 empujes directos de mercadona; después, la misma orden (`gh run list --workflow tests.yml --branch staging --event push`) dos semanas tras el paso 6.
- PR de HoMenu que el juez rechazaría: antes, la cifra del trozo 1; después, los checks `revisor` de esas dos semanas.
- PR por día: antes, picos de 41; después, el mismo recuento, para ver lo que cuesta strict.

## Decisions taken
- principio 2 | eligió: medir en local con el juez de la Fábrica cuántos de los últimos PR de HoMenu recibirían «no» antes de hacer obligatorio el revisor | descartó: hacer obligatorio el revisor en HoMenu sin esa cifra | motivo: decidido
- principio 2 | eligió: al día antes de fusionar (strict) con un despertador que pone al día un PR cada vez | descartó: la cola de fusión de GitHub, que el revisor no alimenta porque solo corre con pull_request_target y workflow_call (`.github/workflows/revisor.yml:15-25`): una fusión por cola saldría sin su juicio, sin evidencia | motivo: decidido
- principio 4 | eligió: la rama base de HoMenu sale del campo base de su ficha .fabrica.json, que ya lee clean.mjs | descartó: fijar staging en tarea y retire, o un segundo fichero con la rama | motivo: decidido
- principio 4 | eligió: los bots de HoMenu los pasa su revisor.yml como entrada del juez reutilizable | descartó: añadir homenu-sesiones y homenu-dependabot-merge a la lista fija de la Fábrica | motivo: decidido
- principio 4 | eligió: el cuerpo del ruleset de HoMenu sale de rulesetBody con strict y nombre como parámetros | descartó: un JSON del ruleset escrito a mano para HoMenu | motivo: decidido
- principio 5 | eligió: carpeta-principal calcula la carpeta principal desde la ruta tocada, para cualquier repo | descartó: una frase en el rol del constructor que pida no tocar la carpeta principal de MenuPlan | motivo: decidido
- principio 3 | eligió: el revisor de HoMenu solo corre en PR a staging | descartó: correr también en PR a main, donde el environment limitado a staging lo haría fallar siempre y un rojo fijo taparía los de verdad | motivo: decidido
- principio 2 | eligió: HoMenu conserva su propio tests.yml como check tests | descartó: cambiarlo sin medir por el tests reutilizable de la Fábrica, que hoy rechazaría sus acciones sin fijar por SHA | motivo: decidido
- principio 2 | eligió: el despertador «al día» pone al día un solo PR cada vez (el armado más antiguo y detrás de la base) y el coste de strict se mide con la cifra «PR por día» | descartó: poner al día a todos los PR abiertos tras cada fusión, cuyo coste (repetir `tests` y `revisor` en cada uno) no se mediría | motivo: decidido
- principio 5 | eligió: `carpeta-principal` calcula la principal con `git worktree list` de la ruta tocada, sin lista de repos | descartó: una lista de repos escrita a mano en el hook, que se queda vieja con cada repo nuevo y nada la vigila | motivo: decidido
- principio 4 | eligió: la cifra del trozo 1 va al issue de este plan | descartó: un fichero nuevo en el repo con la cifra, que quedaría viejo en cuanto cambie el corpus | motivo: decidido
- principio 4 | eligió: `scripts/admin/cuerpo-ruleset.mjs`, una orden que solo imprime el cuerpo del ruleset a partir de `rulesetBody` | descartó: aplicarlo desde el propio plan o escribir el JSON a mano en `PASOS-PABLO.md` | motivo: decidido

## Decisions for Pablo

Las respuestas de Pablo a A, B y C están en `intervenciones.md` (filas del 2026-10-28), no aquí.

### A. ¿Dónde vive HoMenu para que la Fábrica lo opere?
Por qué te lo pregunto: las Apps de la Fábrica son privadas y solo viven en factory-am89; llevarlas a HoMenu es tocar permisos de Apps o mudar el repo, y las dos cosas son tuyas.
1. Se queda en tu cuenta pabloam89; haces públicas fabrica-revisor y fabrica-constructor y las instalas solo en MenuPlan. Coste: unos 15 minutos de clics y nada de producción se toca; administrar.yml no lo gestiona y nadie vigila que el ruleset no cambie (recommended)
2. Se muda a factory-am89: las Apps lo ven solas y administrar.yml lo puede gestionar. Coste: riesgo en producción al mudar (Vercel, la App de Dependabot y la deploy key cuelgan hoy de tu cuenta), Álvaro pasa a colaborador externo de la org y hay que enseñar a administrar.yml la rama staging
3. Se muda a una org nueva de HoMenu, con Álvaro de codueño: separa la empresa de la Fábrica. Coste: lo de la opción 2 y además hacer públicas las Apps como en la 1

### B. Cuando revisor sea obligatorio, ¿qué pasa con los que hoy fusionan en staging sin él?
Por qué te lo pregunto: mantener una excepción es saltarse la puerta, y cambiar qué App despierta al juez toca secretos y permisos.
1. Nadie se lo salta: el juez acepta a homenu-sesiones y a la App de Dependabot, Dependabot espera al revisor y mercadona-sync abre PR; se borran la deploy key y su excepción (recommended)
2. Lo mismo, pero mercadona-sync sigue empujando directo con su deploy key: los datos semanales entran sin revisor, y quien tenga esa clave puede meter en staging un workflow que lea la clave del revisor
3. Dependabot y mercadona dejan de fusionar solos: sus PR esperan a que una sesión los lleve, sin tocar sus workflows ahora

### C. ¿Das el OK a los trozos que tocan rutas cerradas (workflows de los dos repos, el hook de carpetas de la Fábrica y el CLAUDE.md de HoMenu)?
Por qué te lo pregunto: son rutas de la lista cerrada; el revisor sigue juzgando cada PR.
1. Sí, OK al plan entero (recommended)
2. Sí, pero trozo a trozo
3. No, plan aparcado

## Not verified

- Que la cola de fusión no exista para repos de una cuenta personal: lo dice la documentación de GitHub, no lo he probado. No cambia la recomendación: el revisor no corre en `merge_group` (`.github/workflows/revisor.yml:15-25`).
- Que `claude-code-action` rechace un PR de `homenu-sesiones` por no estar en `allowed_bots`: es el mismo mecanismo que obligó a añadir `fabrica-administrador` (`plans/app-admin.md`, Not verified 4); no lo he visto en HoMenu.
- Que un PR tocado por la App `homenu-dependabot-merge` dispare `pull_request_target` con los secretos del environment, y que esa App pueda hacer `update-branch` y abrir PR: `gh api apps/homenu-dependabot-merge` -> 404 (no sé su dueño ni sus permisos). Si le falta un permiso, ampliarlo es de Pablo.
- Que un PR de Dependabot no vea los secretos del environment `revisor`: es lo que dice la documentación de GitHub para eventos de Dependabot (el comentario de `.github/workflows/dependabot-auto.yml` de MenuPlan duda de lo mismo); no lo he probado.
- Que Vercel despliegue la vista previa de un commit de `fabrica-constructor[bot]` sin pedir autorización.
- Que la fase 1 (clave del revisor en HoMenu sin el check obligatorio) dure solo una sentada depende de Pablo; mientras dure, quien fusione en `staging` con solo `tests` podría leer la clave.
- Los 3 rojos de `staging` tras fusiones de PR los cuento como choques entre PR sin haber leído sus logs.
- La cifra del trozo 1 es del juez en local, sin el checkout de la base que tiene en CI; puede diferir.
- Hice un `git fetch` en `C:\dev\MenuPlan` (solo mueve las ramas remotas, sin checkout ni pull): `origin/staging` pasó de `b7ba2ff2` a `579627be` (con nuevos PR de `homenu-sesiones` encima); la rama local `staging` sigue en `541ebe96`, 93 commits detrás.
- Con A = 2: qué secretos, environments, deploy keys e integraciones (Vercel, Supabase, TestFlight) sobreviven a la transferencia. No lo he mirado.
- Cuánto gasta de la suscripción juzgar HoMenu (picos de 41 PR al día, y strict repite juicios). El revisor usa `CLAUDE_CODE_OAUTH_TOKEN`, no la `ANTHROPIC_API_KEY` de HoMenu; las evals de Lola (`scripts/bot-evals.mjs`) no las toca ningún trozo.
- Que una App privada solo se pueda instalar en la cuenta que la posee, y que un PR abierto con `GITHUB_TOKEN` no lance `tests` ni `revisor`: lo dice la documentación de GitHub (enlaces en el texto), no lo he probado.
