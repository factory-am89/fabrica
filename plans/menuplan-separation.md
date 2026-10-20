# Plan: separar la Fábrica del producto en MenuPlan (trozo 27 de trabajar-solos)

Verdict: la separación ya va por la mitad en MenuPlan: 7 de los 11 fallos los borró la serie #878 de MenuPlan; quedan 4 skills duplicadas (1password, github, hetzner, tailscale) que no se pueden borrar hasta que la Fábrica reparta sus skills a cualquier PC que abra MenuPlan, y eso lo decide Pablo (A).

Regla de Pablo: un proyecto no lleva forjas, bases, roles ni skills propios. Con C3 el proyecto N+1 es homenu-panel, así que esta serie no corre prisa ni mide escala.

Cada trozo dice en el título en qué repo se construye; sus `Files` son relativos a ese repo. Ningún trozo cambia MenuPlan hasta que Pablo conteste A.

## Inventario

Medido con `scripts/adopted.mjs` de `origin/main` de la Fábrica (`9995316`), copiado con `git archive` a una carpeta aparte; MenuPlan solo se leyó (`git archive` de sus commits, sin fetch ni checkout).

- La rama buena es `staging`: `git -C C:/dev/MenuPlan symbolic-ref refs/remotes/origin/HEAD` -> `refs/remotes/origin/staging`; `git ls-remote origin refs/heads/staging` -> `541ebe96`, igual que el `staging` local. `origin/main` de MenuPlan está parado (`d19642d`, 2026-10-05) y da 0 fallos porque no tiene `.claude/`.
- Baseline de 11, reproducido en el commit anterior al borrado: `node scripts/adopted.mjs --dir` sobre una copia de `3323ec6c^` -> `adopted: 8 roles, 18 skills, 57 entities, 11 faults` (OWN_ROLE 2, OWN_SKILL 4, OWN_FORGE 1, REDEFINED_ENTITY 4), salida 41.
- Hoy: `node scripts/adopted.mjs --dir C:/dev/MenuPlan` -> `adopted: 0 roles, 8 skills, 0 entities, 4 faults`, los cuatro `OWN_SKILL`, salida 41.

| Fallo (baseline) | Hoy en `staging` | Clase | Por qué y con qué se comprueba |
|---|---|---|---|
| OWN_ROLE `.claude/agents/constructor.md` | borrado | se borra: la Fábrica ya lo tiene | `3323ec6c` (PR 2 de #878) lo borró; la Fábrica tiene `.claude/agents/constructor.md`. `git ls-tree -r staging -- .claude/agents` -> vacío |
| OWN_ROLE `.claude/agents/revisor.md` | borrado | se borra: la Fábrica ya lo tiene | igual; `.claude/agents/revisor.md` en la Fábrica |
| OWN_FORGE `scripts/lib/skills.mjs` | borrado | se borra: la Fábrica ya lo tiene | forja de la entidad `skill` en `entities.json` de la Fábrica; `git ls-tree staging -- scripts/lib/skills.mjs` -> vacío |
| REDEFINED_ENTITY `ops/entidades.json#session` | borrado | se borra: la Fábrica ya lo tiene | `ops/entidades.json` salió en `3323ec6c`; `session` está en `entities.json` de la Fábrica |
| REDEFINED_ENTITY `#skill` | borrado | se borra: la Fábrica ya lo tiene | igual |
| REDEFINED_ENTITY `#standard` | borrado | se borra: la Fábrica ya lo tiene | igual |
| REDEFINED_ENTITY `#project` | borrado | se borra: la Fábrica ya lo tiene | igual |
| OWN_SKILL `1password` | sigue | se sube antes una lección, lo propio queda como vertical, y luego se borra | 11 lecciones en MenuPlan y 11 en la Fábrica; 10 tienen pareja por fecha y tema; falta «2026-10-08 · no se encuentra Importar» (`git grep -i importar origin/main -- .claude/skills/1password` -> sin salida). Lo propio (bóveda de sesiones #328, `referencias/boveda-sesiones.md`, `ssh-sin-aprobar.md`) queda como vertical |
| OWN_SKILL `github` | sigue | se suben antes dos lecciones, lo propio queda como vertical, y luego se borra | 13 y 13; faltan «2026-10-11 · tres workflows publicaban en el primer issue» y «2026-10-08 · la carpeta de trabajo recién creada desaparece sola» (`git grep -i "primer issue"` y `"desaparece"` sobre la skill de la Fábrica -> sin salida). Lo propio (App `homenu-sesiones`, `referencias/app-sesiones.md`, `duenos-de-codigo.md`) queda como vertical |
| OWN_SKILL `hetzner` | sigue | nada que subir; lo propio queda como vertical, y luego se borra | 8 y 8, todas con pareja. Lo propio: la copia nocturna de la base de MenuPlan (`referencias/copias-base.md`) y el servidor del panel (`referencias/panel.md`) |
| OWN_SKILL `tailscale` | sigue | nada que subir; lo propio queda como vertical, y luego se borra | 2 y 2, idénticas. Lo propio: invitar a Álvaro y a Manu (`casos.json`, caso `invitar-alvaro`) |

Lo desagradable: borrar hoy esas cuatro carpetas dejaría sin skills a las sesiones de MenuPlan. Claude Code solo carga las skills de la carpeta del proyecto y las del usuario; `ls C:/Users/pablo/.claude/skills` -> `nucleo-customize`, `nucleo-icons`, `synced` (ninguna de la Fábrica), e `install-pc` solo copia `usuario/` a `~/.claude/`. Además Álvaro abre sesiones de MenuPlan desde otro PC (`98160f2b`, «las dos reglas del vigilante que frenaban a Álvaro», 2026-10-19), así que nada instalado en el PC de Pablo le llega.

## Chunks

### 1. (Fábrica) `adopted` cuenta como fallo toda skill propia del proyecto, no solo las repetidas
Files: `scripts/lib/adopted.mjs`, `test/adopted.test.js`, `test/fixtures/adopted/mezclado/.claude/skills/solo-del-proyecto/SKILL.md`
Depends on: none
Blocked by: none
Existing: `scripts/lib/adopted.mjs:69-70` marca una skill solo si la Fábrica tiene otra con el mismo nombre (`.filter((s) => inherited.skills.includes(s))`); `git grep -n PROJECT_SKILL origin/main` -> sin salida. Sobre `staging` de MenuPlan salen `8 skills, 4 faults`: las otras cuatro (`alta-de-secreto`, `supabase`, `telegram`, `vercel`) no las ve nadie, y la regla de Pablo también las prohíbe. homenu-panel no tiene `.claude/` (`ls C:/dev/homenu-panel/.claude` -> no existe) y da `0 faults`, así que el endurecimiento no lo pone en rojo.
Not done: el código nuevo `PROJECT_SKILL` entra en `ADOPTED_FAULTS` y la salida 41 no cambia. No toca MenuPlan ni decide qué hacer con esas cuatro skills (ampliación de este plan tras medir). No quita el `OWN_FORGE` repetido que apunta `plans/trabajar-solos.md:641` (otro PR pequeño sobre el mismo fichero: va antes o después de este, nunca a la vez). Endurece un check; no rebaja ninguno.
Done:
```sh
node --test test/adopted.test.js
```

### 2. (Fábrica) Las skills de la Fábrica se publican como plugin que lee `.claude/skills`, sin copiarlas
Files: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `test/plugin.test.js`
Depends on: none
Blocked by: A
Existing: `git grep -n -i "claude-plugin\|marketplace\|enabledPlugins" origin/main` -> solo `scripts/lib/settings-widening.mjs:36,142-143`, `test/fixtures/settings-base.json:38` y `test/settings-widening.test.js:34` (la Fábrica ya trata activar un plugin como ampliar permisos); no hay manifiesto. En la raíz no hay `agents/`, `skills/`, `commands/` ni `hooks/` (`git ls-tree --name-only origin/main` filtrado -> sin salida), y `.claude/hooks/` solo tiene `carpeta-principal.mjs`, sin `hooks.json`: el plugin no arrastra hooks. El repo es público: `git -c credential.helper= ls-remote https://github.com/factory-am89/fabrica refs/heads/main` -> `9995316`. `claude --version` -> `2.1.304`, con `claude plugin validate`.
Not done: publica solo skills, no roles (`.claude/agents`) ni hooks; si las sesiones de MenuPlan necesitan los roles de la Fábrica es otra pregunta. El test exige que la ruta de skills del plugin sea la `source_of_truth` de la entidad `skill` de `entities.json` (`.claude/skills`): un solo sitio. No lo activa en ningún proyecto (trozo 5).
Done:
```sh
node --test test/plugin.test.js && claude plugin validate --strict .
```

### 3. (Fábrica) Las tres lecciones genéricas que solo tiene MenuPlan suben, cada una con su lección, y cada skill apunta a los datos del proyecto
Files: `.claude/skills/1password/SKILL.md`, `.claude/skills/github/SKILL.md`, `.claude/skills/github/referencias/operaciones.md`, `.claude/skills/hetzner/SKILL.md`, `.claude/skills/tailscale/SKILL.md`, `lessons/issue-search-by-title-fuzzy.json`, `lessons/work-folder-vanishes.json`, `lessons/op-web-import-hidden.json`
Depends on: none
Blocked by: none
Existing: las tres entradas sin pareja del inventario (greps de arriba, sin salida). El trinquete de `rules-without-reader.json` (`budget`: 1password 11, github 13, hetzner 8, tailscale 2) lo lee `faltasDeReglasSinLector` (`scripts/lib/skills.mjs:121-151`) desde `test/skills.test.js`: una viñeta sin lección sube la cuenta y da `BUDGET_EXCEEDED` (`scripts/lib/skills.mjs:145-146`). `.claude/skills/github/SKILL.md` tiene 118 líneas (`wc -l`) y el tope es 120 (`scripts/lib/skills.mjs:23,162`). `git grep -n "ops/servicios" origin/main -- .claude/skills` -> sin salida.
Not done: cada viñeta nueva enlaza su fichero de `lessons/` (forma v2, la lee `scripts/lib/lessons.mjs`), así que el presupuesto no se toca; subirlo sería rebajar un check. Para no pasar de 120 líneas en github sale a `referencias/operaciones.md` texto de «Operaciones habituales», nunca viñetas de «Lo que falló» (fuera de esa sección el trinquete no las ve). Cada una de las cuatro skills gana una línea: los datos de un proyecto (sus máquinas, Apps, bóvedas, personas) viven en `ops/servicios/` de ese proyecto. No sube los `casos.json` de MenuPlan (la Fábrica no tiene evals de skills; duda abierta). No compara línea a línea los otros apartados.
Done:
```sh
node --test test/skills.test.js test/lessons.test.js && git grep -q -i "primer issue" -- .claude/skills/github/SKILL.md && git grep -q -i "desaparece" -- .claude/skills/github/SKILL.md && git grep -q -i "importar" -- .claude/skills/1password/SKILL.md && test "$(git grep -l "ops/servicios" -- .claude/skills | wc -l)" -eq 4
```

### 4. (MenuPlan) Lo propio de MenuPlan de esas cuatro skills pasa a `ops/servicios/`
Files: `ops/servicios/1password.md`, `ops/servicios/github.md`, `ops/servicios/hetzner.md`, `ops/servicios/tailscale.md`
Depends on: 3
Blocked by: A
Existing: `git -C C:/dev/MenuPlan ls-tree --name-only staging ops/servicios` -> sin salida. `ops/` ya guarda los datos de operación de MenuPlan (`ops/INVENTARIO.md`, `ops/DECISIONES.md`, `ops/copias`). Las cuatro carpetas suman 14 ficheros (`git ls-tree -r --name-only staging` sobre ellas, `wc -l` -> 14).
Not done: copia los hechos de MenuPlan (App `homenu-sesiones`, bóveda de sesiones, copia nocturna de su base, invitar a Álvaro y Manu) y no borra las skills (trozo 6); entre los dos PR esos hechos están dos veces. Los del servidor del panel (`hetzner/referencias/panel.md`) se quedan en `ops/servicios/hetzner.md` con un título que dice que son del panel: su sitio es homenu-panel, pero las sesiones de MenuPlan no pueden escribir allí (`CLAUDE.md:47` de MenuPlan) y eso va en el plan de homenu-panel.
Done:
```sh
test "$(git ls-files ops/servicios | wc -l)" -eq 4 && git grep -q "homenu-sesiones" -- ops/servicios/github.md && git grep -q -i "copia" -- ops/servicios/hetzner.md && git grep -q -i "lvaro" -- ops/servicios/tailscale.md
```

### 5. (MenuPlan) Activar el plugin de la Fábrica en `.claude/settings.json`
Files: `.claude/settings.json`, `ops/plugin-fabrica.test.js`
Depends on: 2
Blocked by: A
Existing: `git -C C:/dev/MenuPlan grep -n "enabledPlugins\|extraKnownMarketplaces" staging -- .claude` -> sin salida. MenuPlan corre sus tests con vitest (`package.json:15`, `"test": "vitest run"`).
Not done: solo añade el marketplace `factory-am89/fabrica` y activa su plugin; no borra las copias (trozo 6), así que durante un PR cada skill está dos veces y se comprueba en una sesión que las del plugin cargan. No cambia ningún otro permiso. Es ampliar permisos (`scripts/lib/settings-widening.mjs:36` de la Fábrica lo trata así): no se construye sin A. Si rompe, se revierte el PR desde una rama nueva.
Done:
```sh
npx vitest run ops/plugin-fabrica.test.js
```

### 6. (MenuPlan) Borrar las cuatro skills duplicadas y que `CLAUDE.md` las nombre como de la Fábrica
Files: `.claude/skills/1password/`, `.claude/skills/github/`, `.claude/skills/hetzner/`, `.claude/skills/tailscale/`, `CLAUDE.md`
Depends on: 4, 5
Blocked by: A
Existing: `CLAUDE.md` de MenuPlan nombra estas skills como suyas en las líneas 14, 40, 45 y 59 (`git show staging:CLAUDE.md | grep -n -i skill`); la 59 las lista bajo «Skills (`.claude/skills/`)». `adopted` sobre `staging` -> los cuatro `OWN_SKILL`.
Not done: no toca `alta-de-secreto`, `supabase`, `telegram` ni `vercel` (fuera del inventario de 11; ver Not verified). El borrado se recupera de git. `CLAUDE.md` es ruta cerrada. El Done se corre desde una carpeta de la Fábrica contra la carpeta principal de MenuPlan ya al día, porque el vigilante de MenuPlan no deja ejecutar en `C:/dev/fabrica*` (`CLAUDE.md:47` de MenuPlan).
Done:
```sh
node scripts/adopted.mjs --dir C:/dev/MenuPlan --json | grep -q -F "\"OWN_SKILL\":0,"
```

## Build order
Ola 1: trozos 1, 2 y 3 a la vez (no comparten fichero). Ola 2: 4 y 5 (MenuPlan, tras A). Ola 3: 6. El 1 no bloquea a ninguno; va primero para que la cifra de después cuente también las skills que hoy no ve.

## Decisions taken
- principio 2 | eligió: inventario sobre staging de MenuPlan, su rama por defecto, que hoy da 4 fallos | descartó: el baseline de 11 medido antes de 3323ec6c y origin/main de MenuPlan, parado el 2026-10-05 | motivo: decidido
- principio 4 | eligió: el plugin lee .claude/skills de la Fábrica, la source_of_truth de la entidad skill | descartó: una carpeta de plugin con copia de las skills | motivo: decidido
- principio 4 | eligió: lo propio de MenuPlan de cada skill va a ops/servicios de MenuPlan y la skill de la Fábrica apunta a ese sitio | descartó: dejarlo en una skill propia de MenuPlan | motivo: decidido
- principio 5 | eligió: adopted cuenta toda skill propia del proyecto con el código nuevo PROJECT_SKILL | descartó: contar solo las que repiten el nombre de una de la Fábrica | motivo: decidido
- principio 5 | eligió: las tres lecciones sin pareja suben con su fichero en lessons | descartó: subirlas sin lección y subir el presupuesto de rules-without-reader.json | motivo: decidido
- principio 6 | eligió: los datos del servidor del panel se quedan en ops/servicios/hetzner.md de MenuPlan, marcados como del panel | descartó: llevarlos ya a homenu-panel desde esta serie | motivo: decidido

## Decisions for Pablo

### A. ¿Cómo reciben las sesiones de MenuPlan las skills de la Fábrica antes de borrar sus cuatro copias?
Por qué te lo pregunto: activar un plugin en MenuPlan es ampliar permisos (la Fábrica lo trata así en `scripts/lib/settings-widening.mjs:36`) y toca `.claude/settings.json` y `CLAUDE.md` de MenuPlan, dos rutas cerradas.
1. Activar en MenuPlan el plugin de la Fábrica: sus skills llegan a cualquier PC que abra MenuPlan, también al de Álvaro, y luego se borran las cuatro copias (recommended)
2. Copiar las skills solo al PC de Pablo con `install-pc`: en el PC de Álvaro las sesiones de MenuPlan se quedan sin estas cuatro skills
3. No tocar MenuPlan por ahora: las cuatro copias siguen y `adopted` sigue en rojo hasta que homenu-panel necesite lo mismo

## Not verified
- El issue #878 de MenuPlan no se pudo leer: `gh issue view 878` -> «To get started with GitHub CLI, please run: gh auth login». Lo que se sabe de la serie sale de `git log --grep=878 staging` (PR #880, PR 2 `3323ec6c`, paso 3 `e0b3bf23`); si #878 tiene pasos pendientes que pisan estos trozos, no lo sé.
- Que un plugin con la ruta de skills en `./.claude/skills/` cargue de verdad, que sus skills se invoquen por su nombre sin el prefijo del plugin, y que el PC de Álvaro instale el marketplace al confiar en la carpeta: no probado. `claude plugin validate .` sobre la Fábrica sin manifiesto -> «Validation passed» (solo valida componentes); el trozo 2 con `--strict` y una sesión real tras el trozo 5 lo dirán.
- El emparejado de lecciones se hizo a mano por fecha y tema (los primeros 70 a 90 caracteres de cada viñeta). «Operaciones habituales», «Qué requiere el OK de Pablo», «Coste y límites» y «Fuentes y comprobación» no se compararon línea a línea; los `casos.json` de MenuPlan (evals) no tienen sitio en la Fábrica y no está decidido si suben.
- Los 7 fallos ya resueltos los borró #878 sin que aquí se comprobara si algo de su contenido faltaba en la Fábrica (el `constructor.md` de MenuPlan tenía 299 líneas). Se recupera de `3323ec6c^` si hace falta.
- Las otras cuatro skills de MenuPlan (`alta-de-secreto`, `supabase`, `telegram`, `vercel`) no están en el inventario de 11 y la Fábrica no tiene ninguna parecida (`git grep -l -i "vercel\|supabase\|telegram\|alta-de-secreto" origin/main -- .claude/skills` -> sin salida). La regla de Pablo también las prohíbe; tras el trozo 1 este plan se amplía con un trozo por skill (parte genérica a la Fábrica, datos a `ops/servicios/`). Ojo: la skill `1password` de la Fábrica dice que crear o rotar un secreto lo hace Pablo, y `alta-de-secreto` es justo ese runbook.
- La carpeta principal de la Fábrica va detrás de `origin/main` (`bba19eb` frente a `9995316`): el Done del trozo 6 necesita la Fábrica al día y la carpeta principal de MenuPlan en `staging` al día; quién la pone al día (una sesión de MenuPlan o Pablo) no está decidido.
- Apliqué la lista cerrada de la Fábrica a las rutas de MenuPlan; la de MenuPlan, si la tiene, no la miré, ni si su vigilante (`guardia-minima.mjs`) deja editar `.claude/settings.json`.
