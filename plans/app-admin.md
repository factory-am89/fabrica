# Plan: App «fabrica-administrador» (tercera App) y proyecto nuevo sin Pablo

Fecha: 16 oct 2026. Base leída: `origin/main` en b7f5c46 (incluye #52 y #63); los «Existing:» se volvieron a comprobar con `git grep` sobre esa base.
Estado: plan; el trozo T2 ya está fusionado (#57), el resto sin código. Ningún valor de secreto se ha leído ni impreso.

Verdict: viable y recomendable, pero la clave administradora es un superpoder (puede borrar repos y quitar protecciones); su única frontera real es lo que entra en `main` de fabrica, así que la «ventana» (pausar el ruleset) deja de ser un riesgo menor y pasa a ser el agujero principal: con esta App, la ventana debe desaparecer, no automatizarse.

---

## 1. Permisos mínimos

Manifiesto (mismo formato que `apps/crear-apps.html`), `public: false`, `default_events: []`.

### De repositorio

| Permiso | Nivel | Por qué |
|---|---|---|
| `administration` | write | Crear repos en la org (`POST /orgs/factory-am89/repos`), ajustes (`allow_auto_merge`, `delete_branch_on_merge`), crear el environment `revisor` y su política de ramas, crear el ruleset de `main`. Es el permiso peligroso: también permite borrar el repo y quitar rulesets; no se puede partir. |
| `contents` | write | Subir los ficheros iniciales directo a `main` ANTES de proteger (en un repo recién creado no hay PR posible con revisor). Y abrir la rama del PR de humo. |
| `workflows` | write | Los ficheros iniciales incluyen `.github/workflows/*.yml`; sin él GitHub rechaza el commit entero (pasó el 15 oct, skill github). |
| `environments` | write | Escribir los secretos del environment `revisor` del repo destino (y leer su clave pública para cifrarlos). SIN COMPROBAR si la API de secretos de environment pide `environments` o `secrets`; se comprueba en el trozo 5 y se pide solo el que haga falta. |
| `pull_requests` | write | Abrir el PR de humo y armar su fusión automática. |
| `checks` | read | Leer el nombre real del check de tests y el resultado del PR de humo. |
| `actions` | read | Leer el run de `tests` en `main` del repo nuevo. |
| `metadata` | read | Obligatorio en toda App. |

### De organización

Ninguno en la primera versión.

### Lo que NO debe tener (y por qué)

- `organization_secrets` (secretos de organización): no se usan (ver punto 4); tenerlo sería una vía para sacar secretos a todos los repos.
- `organization_administration`: solo haría falta para rulesets de organización, que no se usan (y en plan gratuito, sin comprobar si existen).
- `members`, `organization_user_blocking`, `organization_hooks`, `repository_hooks`, `pages`, `deployments`, `issues`, `secrets` (de repo, salvo que el trozo 5 demuestre que hace falta): nada del flujo los usa.
- Ningún evento (webhook): la App no escucha; solo la usa el workflow.
- No puede (ninguna App puede): crear Apps, ampliar sus propios permisos, generar claves privadas, instalar Apps. Eso sigue siendo de Pablo, a propósito.

Instalación: «All repositories» de factory-am89. Motivo: un repo que la App crea tiene que quedar dentro de su instalación;
SIN COMPROBAR si con «Only select repositories» un repo creado por la App se añade solo. Consecuencia honesta: la clave
también tiene poder sobre `fabrica` y `fabrica-privado`.

## 2. Dónde vive la clave y cómo se impide que un agente o un PR la use

- **Dónde**: secretos `ADMIN_APP_KEY` y `ADMIN_CLIENT_ID` en el environment `administrador` de `factory-am89/fabrica`,
  política de despliegue: solo la rama `main` (igual que `revisor`). Nunca en 1Password ni en un PC: ningún agente local la tiene.
- **Un solo workflow la usa**: `.github/workflows/administrar.yml`. Disparadores permitidos, cerrados:
  `push` a `main` con `paths: [proyectos/**, scripts/admin/**]` y `schedule` (solo comprobar, ver trozo 9).
  Prohibidos: `pull_request`, `pull_request_target` (corre en contexto de `main`: el environment lo aceptaría),
  `workflow_dispatch` (lo podría lanzar cualquiera con `actions: write`), `workflow_call`, `issues`, `issue_comment`.
  El constructor tiene `actions: read`, así que hoy tampoco podría lanzar un dispatch; no se le amplía.
- **Por qué un PR no la alcanza**: el código de una rama no puede desplegar en `administrador` (política de ramas);
  un workflow nuevo que pidiera `environment: administrador` solo funcionaría tras fusionarse, es decir, tras pasar `tests` y `revisor`.
- **Ficheros que pasan a ser «puerta»** (a `GATE_FILES` de `scripts/lib/gate.mjs` y a los caminos cerrados de
  `standards/intervention.md` donde aún no estén): `.github/workflows/administrar.yml`, `scripts/admin/**`,
  `test/administrador.test.js`. NO `proyectos/**`: añadir un proyecto es justo lo que debe hacer un agente sin Pablo.
- **Check de máquina (principio 5)**, en `tests`: solo `administrar.yml` puede nombrar `administrador`/`ADMIN_APP_KEY`;
  sus disparadores son exactamente los de arriba; el token se pide con la lista `permission-*` igual a la del manifiesto;
  el código de `scripts/admin/` solo hace llamadas de una lista permitida (nunca `DELETE /repos`, nunca `bypass_actors` no vacío,
  nunca un ruleset sin `tests` y `revisor`, nunca `enforcement` distinto de `active`).
- **Si alguien cambia el workflow administrador**: pasa por PR → `tests` (con el check anterior) y `revisor` (C13). Quitar o
  aflojar el check de máquina es «debilitar un check» (lista cerrada) → para y pregunta a Pablo antes de construir.
  Verdad incómoda: si un PR engaña a la vez al test y al revisor, el workflow fusionado corre con la clave. La frontera real es
  el `main` de fabrica, igual que hoy para el juez.
- **Agujero principal: la ventana.** Con el ruleset pausado, cualquiera con escritura (el constructor) puede empujar directo a
  `main`, y ese push dispara `administrar.yml` con código suyo y la clave al alcance. Ningún paso del propio workflow lo puede
  impedir (correría el código empujado). Por eso: la App administradora NUNCA pausa ni relaja un ruleset, y mientras exista
  `npm run ventana abrir` la clave queda expuesta en cada apertura. Ver la decisión A.

## 3. Flujo «proyecto nuevo» sin Pablo

- **Quién lo dispara**: un agente abre en fabrica un PR que añade `proyectos/<nombre>.json`
  (`{ "repo": "factory-am89/<nombre>", "visibilidad": "publico", "descripcion": "..." }`). `tests` valida el esquema;
  `revisor` lo juzga; GitHub lo fusiona; el push a `main` dispara `administrar.yml`. Descartados: issue con etiqueta
  (contenido que no pasa por revisor), `workflow_dispatch` (ver punto 2).
- **Qué hace**, idempotente (relanzado no cambia nada), en este orden:
  1. Lee el estado real; si el repo no existe, lo crea (público; privado → para en alto: plan gratuito sin rulesets).
  2. Sube directo a `main`, antes de proteger: `.github/workflows/tests.yml` y `revisor.yml`, `CLAUDE.md`
     (plantillas de `apps/proyecto-nuevo/`), y para un repo vacío un `package.json` con script `test` y su `package-lock.json`
     (`tests.yml` los exige; hoy no hay plantilla). `.fabrica.json` NO va aquí: es el PR de humo.
  3. Ajustes: fusión automática y borrado de ramas.
  4. Environment `revisor` limitado a `main` y sus tres secretos (punto 4).
  5. Ruleset de `main`: mismo cuerpo que `Cuerpo-Ruleset` (`tests / tests` de Actions 15368 y `revisor` de la App revisora,
     sin bypass). El nombre `tests / tests` sale de la plantilla, no hace falta esperar a que corra.
  6. Humo: rama `ops/fabrica-ficha` con `.fabrica.json`, PR, fusión automática armada.
- **Cómo se verifica** (en el mismo workflow, y falla en alto si no):
  `gh api repos/<repo>/rules/branches/main` contiene `tests / tests` y `revisor`; el PR de humo acaba `merged` con los
  dos checks `success` en su SHA. Si el revisor dice «no», el workflow falla y el resumen lo dice.
- **Repos existentes** (`homenu-panel`): mismo fichero en `proyectos/`; el paso 1 no crea, adopta. Sustituye las dos
  ejecuciones manuales de `proyecto-nuevo.ps1` y la fusión a mano del PR inicial.

## 4. Secretos del revisor

- **Secretos de organización: NO para `REVISOR_APP_KEY`.** Un secreto de organización no se puede atar a un environment:
  lo lee cualquier workflow del repo en cualquier rama. El constructor tiene `workflows: write`: le bastaría empujar una rama
  con un workflow `on: push` que use la clave para publicar un check `revisor` verde a su gusto. Con `pull_request_target`
  el workflow es el de `main`, pero eso no cierra la puerta: el riesgo es cualquier otro workflow de rama.
- `CLAUDE_CODE_OAUTH_TOKEN` como secreto de organización: mismo problema (robo del token de la suscripción), menor daño. Tampoco.
- **Recomendado: por repo, en su environment `revisor`, escrito por la App administradora.** Los valores viven una vez en el
  environment `administrador` de fabrica (`REVISOR_APP_KEY`, `REVISOR_CLIENT_ID`, `CLAUDE_CODE_OAUTH_TOKEN`) y el workflow
  los copia, cifrados, al repo destino. Riesgo añadido: casi nulo, porque quien tiene la clave administradora ya puede
  todo lo que esos secretos permiten.
- La App administradora NO recibe `organization_secrets`.
- Como los secretos no se pueden leer de vuelta, la `REVISOR_APP_KEY` de fabrica no se puede copiar: Pablo genera una
  segunda clave privada de `fabrica-revisor` (las dos valen a la vez) y la guarda en `administrador`.

## 5. Qué intervenciones elimina y cuáles no, a propósito

Elimina:
- Lanzar `proyecto-nuevo.ps1` (dos veces) con su sesión de admin.
- Fusionar a mano el PR inicial de cada proyecto.
- Crear a mano los secretos `revisor` de cada repo.
- Crear el repo, el environment, los ajustes y el ruleset de cada proyecto.
- Proteger `homenu-panel` (hoy público sin proteger).

NO elimina, a propósito (fronteras):
- Crear Apps, ampliar sus permisos, generar o rotar claves privadas (ninguna App puede, y está prohibido a agentes).
- Pausar o relajar un ruleset («ventana») y arreglar un juez roto que no puede juzgar su propio arreglo: es saltarse la
  puerta; si lo hiciera una máquina, cualquiera que la engañe se la salta. Queda de Pablo hasta que la decisión A lo elimine.
- Borrar repos; cambiar el plan de pago; repos privados (sin ruleset en plan gratuito: `fabrica-privado` queda fuera).
- El OK previo de Pablo a trozos que tocan caminos cerrados (`apps/**`, `.github/workflows/**`): casi todos los de este plan.
  Recomendación: un solo OK para el plan entero, apuntado en `intervenciones.md`.
- «Aprobar cambios al árbitro»: ya eliminada el 15 oct (decide `revisor`); esta App no la cambia.

## 6. Lo que queda de Pablo, una sola vez (unos 15 minutos)

1. Abrir la página (botón «Crear fabrica-administrador»), pulsar «Create GitHub App», copiar el `code=` y lanzar
   `node apps/convertir.mjs <code>`: crea el environment `administrador` (solo `main`) y guarda `ADMIN_APP_KEY` y
   `ADMIN_CLIENT_ID` sin imprimirlos. ~4 min.
2. Instalar la App en factory-am89, «All repositories» (el script le da el enlace). ~1 min.
3. Generar una clave nueva de `fabrica-revisor` y guardarla con `gh secret set REVISOR_APP_KEY --env administrador --repo factory-am89/fabrica` leyendo el .pem por la entrada, y borrar el .pem. ~4 min.
4. `claude setup-token` y guardar `CLAUDE_CODE_OAUTH_TOKEN` igual en `administrador`; `REVISOR_CLIENT_ID` igual. ~4 min.
5. Un OK al plan (caminos cerrados) y decisión A. ~2 min.

## Chunks

Reutilización: se REESCRIBE en Node la orquestación (`proyecto-nuevo.ps1` y `lib-proyecto.ps1` dependen de `gh.exe`,
login interactivo, `/user/installations` (API de usuario, no de App) y de Windows PowerShell). Se REUTILIZAN tal cual
las plantillas `apps/proyecto-nuevo/*`, la lista de secretos, la lista de ficheros, el cuerpo del ruleset
(`Cuerpo-Ruleset`) y la comprobación final (`Comprobar-Reglas-De-Main`), portados a un módulo JS que pasa a ser la única
fuente; `test/proyecto-nuevo.test.js` ya ata la lista de secretos a `revisor.yml` y se extiende.

Todos salvo el 2 (ya fusionado) tocan caminos cerrados (`apps/**`, `.github/workflows/**`): necesitan el OK de Pablo antes
de construirse (`standards/intervention.md`), por eso llevan `Blocked by: B`. Los pasos 1 a 4 de Pablo (punto 6) no son
una decisión y no caben en `Blocked by`: donde un trozo los necesita, lo dice en su texto.

### 1. Manifiesto y guardado de la clave
Hace: botón 3 en `apps/crear-apps.html` con los permisos del punto 1; `apps/convertir.mjs` acepta `fabrica-administrador`
y guarda en el environment `administrador` (lo crea limitado a `main` si falta).
Files: `apps/crear-apps.html`, `apps/convertir.mjs`, `test/convertir.test.js`
Depends on: none
Blocked by: B
Existing: `test/apps.test.js` ya prueba `convertir.mjs` para las dos Apps actuales (líneas 9 y 33); de la App administradora no hay rastro en el repo.
```
$ git grep -l "fabrica-administrador"          (salida vacía)
$ ls test | grep convertir                     (salida vacía)
```
Not done: crear la App, instalarla, ningún workflow.
Done: `node --test test/convertir.test.js` verde con casos nuevos: destino de `fabrica-administrador` es `administrador`; los argumentos de `gh secret set` llevan `--env administrador`; el JSON del manifiesto del HTML tiene EXACTAMENTE la lista de permisos del punto 1 (igualdad, no inclusión).
```
node --test test/convertir.test.js
```

### 2. Guardia de máquina (antes de que exista el workflow)
Hace: `test/administrador.test.js` con las reglas del punto 2, probadas contra ficheros de ejemplo malos (uno por
disparador prohibido, uno con permiso de más, uno con `bypass_actors`); añade los ficheros nuevos a `GATE_FILES`.
Ya fusionado como pieza 2 en #57; queda en el plan como registro y para que los trozos 4 en adelante dependan de él.
Files: `test/administrador.test.js`, `scripts/lib/gate.mjs`
Depends on: #57
Blocked by: none
Existing: ya existe; es el resultado de este trozo.
```
$ git grep -l "administrar.yml"
scripts/lib/gate.mjs
test/administrador.test.js
```
Not done: el workflow ni la lógica.
Done: `node --test test/administrador.test.js` verde y cada ejemplo malo da rojo con su motivo; `node --test test/gate-files.test.js` verde.
```
node --test test/administrador.test.js test/gate-files.test.js
```

### 3. Lógica pura en Node
Hace: `scripts/admin/proyecto.mjs`: de (estado real, `proyectos/<x>.json`) a una lista de llamadas de la lista permitida;
cuerpo del ruleset en un solo módulo; esquema de `proyectos/*.json` validado (falla en alto ante clave desconocida,
privado, dueño distinto de factory-am89).
Files: `scripts/admin/proyecto.mjs`, `test/admin-proyecto.test.js`
Depends on: none
Blocked by: B
Existing: ni la carpeta `scripts/admin/` ni el test existen (el guardia del trozo 2 solo los nombra).
```
$ git grep -l "test/admin-proyecto"            (salida vacía)
$ ls scripts/admin                             ls: cannot access 'scripts/admin'
```
Not done: llamar a GitHub de verdad; borrar `proyecto-nuevo.ps1`.
Done: `node --test test/admin-proyecto.test.js` verde con: repo nuevo; repo existente sin proteger (caso homenu-panel); privado da error con «plan gratuito»; segunda pasada sobre estado completo da 0 escrituras; ninguna salida contiene `DELETE` ni `bypass_actors` no vacío (propiedad comprobada sobre todas las entradas de prueba).
```
node --test test/admin-proyecto.test.js
```

### 4. Workflow en modo solo lectura
Hace: `.github/workflows/administrar.yml` (push a main con paths, environment `administrador`, token con permisos de
SOLO LECTURA) que imprime el plan sin aplicarlo. Necesita los pasos 1 y 2 de Pablo hechos.
Files: `.github/workflows/administrar.yml`, `proyectos/homenu-panel.json`
Depends on: 1, 2, 3
Blocked by: A, B
Existing: ni el workflow ni la carpeta `proyectos/` existen.
```
$ git grep -l "administrar.yml" -- .github     (salida vacía)
$ ls proyectos                                 ls: cannot access 'proyectos'
```
Not done: ninguna escritura.
Done: tras fusionar con `proyectos/homenu-panel.json`, el último run de `administrar.yml` acaba en `success` y su resumen lista lo que falta en homenu-panel; `node --test test/administrador.test.js` verde sobre el fichero real.
```
gh run list --repo factory-am89/fabrica --workflow administrar.yml --limit 1 --json conclusion
node --test test/administrador.test.js
```

### 5. Secretos del revisor por repo
Hace: environment `revisor` limitado a `main` y copia cifrada de los tres secretos desde `administrador`; comprueba qué
permiso pide la API (punto 1); si pide uno que la App no tiene, para: ampliar la App es de Pablo. Va antes que el ruleset
(proteger homenu-panel sin secretos dejaría sus PR bloqueados). Necesita los pasos 3 y 4 de Pablo hechos.
Files: `.github/workflows/administrar.yml`, `scripts/admin/secretos.mjs`
Depends on: 4
Blocked by: A, B
Existing: no hay código que escriba secretos de environment desde Node.
```
$ git grep -l "environments/revisor/secrets" -- scripts .github     (salida vacía)
```
Not done: secretos de organización; imprimir ningún valor.
Done: el environment `revisor` de homenu-panel lista los tres nombres de secreto y el log del run no contiene `PRIVATE KEY` (lo comprueba un paso del propio workflow).
```
gh api repos/factory-am89/homenu-panel/environments/revisor/secrets
```

### 6. Escrituras: ajustes, ficheros directos y ruleset (repo existente)
Hace: el workflow pide los permisos de escritura y aplica el resto del plan a homenu-panel.
Files: `.github/workflows/administrar.yml`
Depends on: 5
Blocked by: A, B
Existing: el ruleset de homenu-panel hoy lo crean a mano los scripts de PowerShell; en Node solo `scripts/ventana.mjs` lo pausa y lo rearma (no lo crea); `.github/workflows/anulacion.yml` solo lo nombra en un comentario.
```
$ git grep -il "ruleset" -- apps scripts .github
.github/workflows/anulacion.yml
apps/arranque.ps1
apps/lib-gh.ps1
apps/lib-proyecto.ps1
apps/proyecto-nuevo.ps1
apps/proyecto-nuevo/tests.yml
apps/ruleset.ps1
scripts/lib/pause-window.mjs
scripts/ventana.mjs
```
Not done: PR de humo, crear repos.
Done: el ruleset de `main` de homenu-panel incluye `required_status_checks` con los contextos `tests / tests` y `revisor`, sin faltar ninguna regla del cuerpo del ruleset; un segundo run del workflow informa «0 cambios».
```
gh api repos/factory-am89/homenu-panel/rules/branches/main
```

### 7. PR de humo y allowed_bots
Hace: el workflow abre el PR de `.fabrica.json` y arma la fusión; `revisor.yml` añade `fabrica-administrador` a
`allowed_bots` (amplía a quién juzga el revisor: C13 lo mira; no rebaja ninguna comprobación; si rompe, se revierte el PR desde una rama nueva).
Files: `.github/workflows/administrar.yml`, `.github/workflows/revisor.yml`
Depends on: 6
Blocked by: A, B
Existing: `allowed_bots` solo nombra a `fabrica-constructor`.
```
$ git grep -n "allowed_bots" -- .github
.github/workflows/revisor.yml:81:          allowed_bots: fabrica-constructor
```
Not done: crear repos.
Done: hay un PR fusionado de la rama `ops/fabrica-ficha` en homenu-panel y el último commit de `main` tiene `tests / tests` y `revisor` con conclusión `success`.
```
gh pr list --repo factory-am89/homenu-panel --head ops/fabrica-ficha --state merged --json number
gh api repos/factory-am89/homenu-panel/commits/main/check-runs --jq ".check_runs[] | [.name, .conclusion] | @tsv"
```

### 8. Crear repos nuevos
Hace: `POST /orgs/factory-am89/repos` y plantillas `package.json`/`package-lock.json` mínimas; se prueba con un repo real.
Falta el nombre del primer proyecto nuevo (duda D3) y comprobar que una App puede crear repos en esta org gratuita
(punto 1 de «Not verified»); mientras no, `NOMBRE-NUEVO` en el comando de abajo es el sitio del nombre.
Files: `.github/workflows/administrar.yml`, `scripts/admin/proyecto.mjs`, `apps/proyecto-nuevo/package.json`
Depends on: 7, 3
Blocked by: A, B
Existing: hoy ningún código crea repos por API; `proyecto-nuevo.ps1` adopta uno ya creado.
```
$ git grep -n "orgs/factory-am89/repos"        (salida vacía)
```
Not done: repos privados.
Done: tras fusionar `proyectos/NOMBRE-NUEVO.json`, el repo existe y es público; reglas como en el trozo 6; humo como en el 7.
```
gh api repos/factory-am89/NOMBRE-NUEVO --jq .visibility
```

### 9. Vigilancia de deriva (solo avisar)
Hace: `schedule` cada hora que compara el estado real con `proyectos/*` y falla en alto si un ruleset falta, está en
`evaluate`/`disabled` o perdió un check. No re-aplica (pelearía con una intervención legítima de Pablo como dueño).
Files: `.github/workflows/administrar.yml`, `scripts/admin/deriva.mjs`, `test/admin-deriva.test.js`
Depends on: 8
Blocked by: A, B
Existing: nada vigila hoy el estado de los rulesets.
```
$ git grep -l "admin-deriva"                   (salida vacía)
```
Not done: tocar fabrica ni reparar.
Done: `node --test test/admin-deriva.test.js` verde, con un estado de prueba alterado que da rojo con su motivo; en real, el run programado acaba `success`.
```
node --test test/admin-deriva.test.js
```

### 10. Retirar el camino manual
Hace: `PASOS-PABLO.md` («Proyecto nuevo») apunta al fichero en `proyectos/`; `proyecto-nuevo.ps1` y `lib-proyecto.ps1`
se borran (o quedan como plan B, duda D4); la skill `github` dice que hay tres Apps; una línea en `intervenciones.md`.
Files: `PASOS-PABLO.md`, `apps/proyecto-nuevo.ps1`, `apps/lib-proyecto.ps1`, `.claude/skills/github/SKILL.md`, `intervenciones.md`
Depends on: 9
Blocked by: B
Existing: los dos `.ps1` existen y son los que se retiran.
```
$ ls apps | grep proyecto
lib-proyecto.ps1
proyecto-nuevo
proyecto-nuevo.ps1
```
Not done: tocar `arranque.ps1`.
Done: `proyecto-nuevo.ps1` ya no se nombra fuera de `intervenciones.md`, y `npm test` verde.
```
git grep -n "proyecto-nuevo.ps1"
npm test
```

## Decisions for Pablo

### A. Con esta App, cada ventana (pausar el ruleset) expone la clave administradora: ¿qué se hace con la ventana? (antes D1)
Decidida solo en parte, y no con estas opciones: `intervenciones.md:26` (16 oct 2026; la tomó la sesión coordinadora con la delegación de Pablo, no una frase suya) prohíbe pausar el ruleset «como práctica», pero deja `npm run ventana` para emergencias. Así que la ventana sigue existiendo y el agujero principal del punto 2 sigue abierto mientras haya una emergencia posible. Con la anulación de #61 (ya en `main`, b7f5c46), un juez roto ya no necesita la ventana, porque basta el Approve de Pablo. Queda por decidir qué pasa con la clave en una emergencia; hasta entonces, ningún trozo que instale la clave empieza.
1. Prohibir la ventana: un juez roto se arregla con un PR que el juez viejo pueda aprobar, y si no puede, Pablo hace el arreglo como dueño sin pausar el ruleset para todos (recommended)
2. Mantener la ventana pero desactivar antes el environment `administrador` (un clic más de Pablo cada vez)
3. Aceptar el riesgo y apuntarlo

### B. ¿Das el OK a todo el plan, que toca caminos cerrados (`apps/**`, `.github/workflows/**`)?
Un solo OK para el plan entero, apuntado en `intervenciones.md`.
1. Sí, OK al plan entero (recommended)
2. Sí, pero trozo a trozo
3. No, plan aparcado

## Not verified

1. Si una App puede crear repos en una org con plan gratuito, y con qué permiso exacto (trozo 8).
2. Si un repo creado por la App entra solo en su instalación con «Only select repositories» (decidiría no usar «All») (trozo 8).
3. Qué permiso pide escribir un secreto de environment: `environments` o `secrets` (trozo 5).
4. Si `claude-code-action` rechaza un PR abierto por un bot no listado en `allowed_bots` (trozo 7).
5. Si existen rulesets de organización en plan gratuito para repos públicos (no se usan; solo cambiaría el diseño a futuro).
6. Que `tests / tests` sea el nombre del check en un repo creado desde las plantillas (PASOS-PABLO.md lo da por visto en homenu-panel; yo no lo he visto).
7. `gh` no tiene sesión en este PC: no he mirado nada en GitHub en vivo (rulesets, instalaciones, secretos).
8. `npm run ventana` existe ya en `origin/main` (#53); el plan original no lo leyó y esta versión tampoco.

## Dudas del arquitecto (no son decisiones de Pablo)

- **D2.** Proteger homenu-panel sin secretos dejaría sus PR bloqueados; por eso el trozo 5 (secretos) va antes que el 6 (ruleset).
- **D3.** Nombre del primer proyecto nuevo real para el trozo 8.
- **D4.** ¿Se borra `proyecto-nuevo.ps1` o queda como plan B manual? Recomendado borrar (una idea, un sitio).
- **D5.** `fabrica-constructor` en «All repositories» ya tiene `contents: write` sobre `fabrica-privado` (valores de
  settings de usuario). Fuera de este encargo; apuntado.
