# Plan: Trabajar solos y acertar, organizado por invariantes, con metas como datos, el lado de los planes y el cableado
Verdict: Veintiocho trozos en veinte olas, sin decisiones pendientes (Pablo eligió A1, B1 y C3); la máquina sigue marcando dos por rutas cerradas (25, `golden.yml`; 26, `CLAUDE.md`), que ya tienen su OK; la matriz destapa dos huecos serios, las preguntas de revisor de `standards/plan.md` sin juez automático (los cierra la pregunta puente C16) y lo periódico sin disparador (lo cierra el arranque de sesión para la parte local, y lo demás se cuenta como deuda); las preguntas nuevas del juez entran al final y, tras ellas, Pablo lanza una pasada del corpus antes de fiarse.

## Invariants
Valores por defecto con excepción declarada (válvula `otro` o `excepción` + motivo, contada), no dogmas. I1 a I4 son los aceptados; los cambios se razonan en «Decisions taken».
- I1 Una cosa, un sitio, y un sitio, una cosa: lo demás la referencia.
- I2 Lo que se repite (valores, reglas, recetas) es dato con vocabulario cerrado y válvula «otro» + motivo.
- I3 Toda regla tiene un lector que falla y un disparador que lo ejecuta sin que nadie se acuerde, y todo fallo se pregunta por su clase; el arreglo es un mecanismo para la clase.
- I4 Lo que el agente necesita está en datos del repo legibles de una vez, y lo que decide queda apuntado con su motivo.
- I5 Todo lector es una hipótesis que se mide: cifra antes y después, tasa de «no» falsos, y «no concluyente» con menos de `MIN_CASES_PER_CELL` casos (`scripts/golden.mjs:24`).

La auditoría periódica (trozos 13 a 22) es, con su nombre, el ciclo frustración/mejora: cada toque de Pablo, cada «no» falso y cada escape a main entra como dato, se agrupa por clase y sale como propuesta de mecanismo por PR.

Esta sección, «Matrix» y la tabla de la validación son la entrada de los trozos 22 y 23; cuando esos trozos estén en main, la fuente es `goals.json` y `test/fixtures/invariants/expected.json`, y este plan deja de valer como copia (I1).

## Wiring
Tres cosas distintas, y qué cubre hoy cada pregunta (comprobado en origin/main `6d24be7`):
1. Se dispara en ESTE PR. C6 lo juzga con el texto del PR (la sección `Red before` es obligatoria si cambia `test/`, `scripts/lib/pr-body.mjs:5`, pero la máquina solo mira que exista); que pase después lo ve una máquina solo a medias: la sección `Evidence` debe nombrar `HEAD <sha>` de la cabeza (`scripts/lib/pr-body.mjs:18-28`), pero es texto pegado, no prueba de que se corriera. P2 juzga el texto de la Done. C12 juzga que haya un lector. Hueco: nada comprueba que la Done pase por el punto de entrada real (`npm test`, el CLI que corre el CI) y no por la función a mano; lo cierran P12 y C17 (juez) y, para tests, el trozo 20 (máquina).
2. Sigue disparándose DESPUÉS. Hoy: C13 (juez) y un canario de máquina, el meta-test de `test/golden-machine.test.js:126` (todo código de todo `*_FAULTS` de `scripts/lib` tiene un caso malo en otro test). Hueco: nada falla si `package.json` deja de ser `node --test`, si `tests.yml` deja de correr `npm test` (`tests.yml:44`), si `golden.yml` deja de mirar `standards/**` o si un test vive fuera de lo que `node --test` recoge. Lo cierra el trozo 20. Regla que generaliza el meta-test: toda lista de fallos nueva de este plan se llama `*_FAULTS` y vive en `scripts/lib`, así el meta-test la cubre sin más código.
3. Lo PERIÓDICO (`audit`, higiene, valores libres, muestreo del juez fuera del corpus): hoy no tiene disparador. El único programado es `golden.yml` (`grep -rln "schedule:" .github/workflows` -> solo ese), y por decisión de Pablo pierde el `schedule` y el `push` (trozo 25): la pasada del corpus la lanza él. El arranque de sesión sí existe: `.claude/settings.json` lanza `scripts/al-arrancar.mjs` y un paso nuevo se añade a `PASOS` (`scripts/al-arrancar.mjs:2,23`), sin tocar `settings.json`; lo que corre solo pide a Pablo según `standards/intervention.md:40`, y Pablo lo autorizó (A1). Así: la parte local de `audit` y la higiene, al arrancar (trozo 21); la parte de GitHub y el corpus, `manual`, contados como deuda (trozos 22 y 28).

Qué recoge `npm test` de verdad (`node --test` sin argumentos, Node 24, probado en una carpeta temporal): cualquier `.js`, `.mjs`, `.cjs` o `.ts` bajo `test/` (también `test/fixtures/f.mjs`, que se ejecutó y sin tests salió verde) y cualquier `*.test.*` en cualquier carpeta (`scripts/b.test.mjs` se ejecutó). Un test nuevo en `test/` se ejecuta; uno en `scripts/x.check.mjs`, no. Efecto lateral: los `test/fixtures/*-falso.mjs` también se ejecutan en cada `npm test`.

Validar el plan con P y el código con C asegura esto, y solo esto: que un juez lea la Done y el texto de «Red before»; la máquina ve que la evidencia nombra la cabeza y que cada código de fallo tiene un caso malo en algún test. No asegura que la Done pase por la entrada real, que el rojo de antes fuera real (es texto del PR) ni que nada periódico corra.

## Matrix
«Lector hoy»: `máquina` (un test o un check falla), `juez` (una pregunta que un juez automático contesta en cada PR), `juez-sin-lector` (pregunta escrita cuyo juez automático no existe), `nadie`. «Disparador»: `ci-test` (lo recoge `npm test` en `tests.yml`), `ci-judge` (el revisor en cada PR), `corpus` (`golden.yml` al cambiar el juez), `manual` (alguien tiene que abrirlo), `arranque` (un paso de `PASOS`), `cron` (workflow programado), `ninguno`. Una celda con `*` tiene lector pero no se dispara sola. Comprobado en origin/main `6d24be7`: `revisor.yml:84` y `revisor.yml:115` juzgan solo contra `.fabrica/standards/code.md`; `git grep -n "plan.md" origin/main -- scripts/veredicto.mjs scripts/lib/questions.mjs .github/workflows/revisor.yml .claude/agents/revisor.md` -> (sin salida).

### Metas
| Meta | Invariantes | Principios | Indicador (trozo) | Lector | Lector hoy | Disparador del indicador |
|---|---|---|---|---|---|---|
| O1 escalabilidad | I1, I2 | 4 | coste del N+1, huecos de base, fallos de adoptado (15, 13, 4) | `test/entities.test.js`, `test/fields.test.js`, `test/adopted.test.js`; C8, C14, P5, P10 | juez (C8) | `arranque` (local), `manual*` (GitHub) |
| O2 HITL como residuo | I4, I5 | 6, 2 | residuo por tipo de falta y escapes (18, 15) | `test/pr-body.test.js`, `check-plan`; C15, P9, P11 | máquina (P9) | `manual*` (GitHub) |
| O3 self-learning | I3, I5 | 5, 2 | efecto de cada lección, reglas sin lector, higiene (17, 13, 19) | `test/lessons.test.js`, `test/skills.test.js`; C6, P2, P12 | juez (C6), máquina parcial | `arranque` (higiene), `manual*` (efecto, GitHub) |
| O4 por y para agentes | I1, I2, I4 | 4, 5 | scripts sin `--json`, ficheros grandes, números a mano, valores libres (13, 16) | `test/contrato.test.js`; C1, C3, C11, C14, C17 | máquina (C1, C3), juez (C11) | `arranque` |

Todos los lectores de tipo test se disparan solos (`ci-test`); ningún indicador se dispara solo hoy. Con A1, la parte local se dispara al arrancar (trozo 21); la de GitHub y el corpus quedan `manual*` y se cuentan como deuda (trozos 22 y 28).

### Principios de CLAUDE.md
| Principio | Invariante | Preguntas | Correcto o hueco |
|---|---|---|---|
| 1 Verdad | ninguno | C9 y P6 en parte | hueco aceptado: «lo desagradable primero» es la forma de responder a Pablo, no de un diff; ningún lector lo mira |
| 2 Evidencia | I5 | C9, P6 | correcto |
| 3 Fallar en alto | ninguno | C5 | correcto como base: protege toda meta y no mide ninguna |
| 4 Una idea, un sitio | I1 (I2 aún no está en ningún principio) | C3, C8, C11, P4, P5, P7 | hueco: I2 sin principio; lo cierra B1 (trozo 26) |
| 5 Máquina | I3 | C1, C2, C6, C12, C13, C17, P2, P8, P12 | hueco parcial: el principio no dice «disparador»; lo cierra B1 (trozo 26) |
| 6 Preguntar antes de un atajo | I4 | P3, P9 | correcto; C15 y P11 lo amplían |

### Preguntas
Categoría `base` = protege a todas las metas sin medir ninguna (vocabulario cerrado del trozo 22).

| Pregunta | Principio | Invariante | Meta | Quién | Lector hoy | Disparador |
|---|---|---|---|---|---|---|
| C1 lint | 5 | I3 | O4 | máquina | máquina | ci-test |
| C2 tests | 5 | I3 | O3 | máquina | máquina | ci-test |
| C3 función de 100 líneas | 4 | I1 (cohesión) | O4 | máquina | máquina | ci-test |
| C4 acciones por SHA y permisos | ninguno | ninguno | base | máquina | máquina | ci-test |
| C5 fallar en alto | 3 | ninguno | base | revisor | juez | ci-judge |
| C6 test visto en rojo y de la regla | 5 | I3 | O3 | revisor | juez (sobre texto del PR) | ci-judge |
| C7 tests deterministas | 5 | I5 (un lector inestable no mide) | base | revisor | juez | ci-judge |
| C8 un dato, un sitio | 4 | I1, I2 | O1 | revisor | juez | ci-judge |
| C9 afirmación con comando | 2 | I5 | O2 | revisor | juez | ci-judge |
| C10 sin secretos | ninguno | ninguno | base | revisor | juez | ci-judge |
| C11 una idea por PR | 4 | I1 (cohesión) | O1, O4 | revisor | juez | ci-judge |
| C12 todo tiene lector y solo el encargo | 5 | I3, I1 | O3 | revisor | juez | ci-judge |
| C13 nada se rebaja | 5 | I3 | O2 | revisor | juez | ci-judge |
| C14 (nueva) lo repetido es tabla o enum | 4 | I2 | O1, O4 | revisor | trozo 12 | ci-judge tras fusionar |
| C15 (nueva) decisión apuntada y que encaja | 6 | I4 | O2 | revisor | trozo 12 | ci-judge tras fusionar |
| C16 (nueva) puente: el plan cumple las de revisor de `plan.md` | 5 | I3 | todas | revisor | trozo 12 | ci-judge tras fusionar |
| C17 (nueva) el check nuevo se dispara por su entrada real, con un caso malo | 5 | I3 | O3, O4 | revisor | trozo 12 | ci-judge tras fusionar |
| P1 forma | 5 | I2 | O4 | máquina | máquina | ci-test (`tests.yml:78-84`) |
| P2 Done prueba el trozo | 5 | I3 | O3 | revisor | juez-sin-lector | `ninguno*` hasta el trozo 12 |
| P3 Not done y dudas escritas | 6 | I4 | O2 | revisor | juez-sin-lector | `ninguno*` hasta el trozo 12 |
| P4 una idea por trozo | 4 | I1 | O1 | revisor | juez-sin-lector | `ninguno*` hasta el trozo 12 |
| P5 Existing con comando | 4 | I1 (¿ya existe?) | O1 | revisor | juez-sin-lector | `ninguno*` hasta el trozo 12 |
| P6 afirmación con prueba | 2 | I5 | O2 | revisor | juez-sin-lector | `ninguno*` hasta el trozo 12 |
| P7 orden y ficheros compartidos | 4 | I1 (cohesión) | O1 | máquina | máquina | ci-test |
| P8 puerta y reparación | 5 | I3 | O2 | revisor | juez-sin-lector | `ninguno*` hasta el trozo 12 |
| P9 lista cerrada | 6 | I4 | O2 | máquina | máquina | ci-test |
| P10 (nueva) campos y entidades clasificados | 4 | I1, I2 | O1 | revisor | trozo 11 | ci-judge vía C16 |
| P11 (nueva) decisiones del plan que encajan | 6 | I4 | O2 | revisor | trozo 11 | ci-judge vía C16 |
| P12 (nueva) regla nueva con lector y disparador, Done por la entrada real, fallo con su clase | 5 | I3 | O3 | revisor | trozo 11 | ci-judge vía C16 |

Lado P por invariante, hoy y tras el plan: I1 lo cubren P4, P5 y P7; I2, solo P1 (forma), y P10 añade los campos; I3, P2 y P8, y faltaban «regla con lector y disparador» y «fallo con clase»: P12; I4, P3 y P9, y P11 añade el encaje de las decisiones; I5, P6 (el «2,5 -> 1» de su «Mal» ya pide cifra medida): no necesita pregunta nueva.

### Trozos
«Vara» = la Done prueba el disparo por el punto de entrada real (no la función a mano) y, si es un check, con un caso malo en rojo. Valores: `sí`, `corregida` (no la cumplía en el v5 y aquí se arregla), `no` (con motivo).

| Trozo | Meta | Invariante | Lector que añade | Disparador | Vara |
|---|---|---|---|---|---|
| 1 entidades | O1, O4 | I1, I4 | `test/entities.test.js` | ci-test | sí: el test lee el registro real y `npm test` lo recoge |
| 2 campos | O1 | I1, I2 | `test/fields.test.js` | ci-test | sí en la Fábrica; no en los proyectos (pide `tests.yml`) |
| 3 recuperación | O2, O4 | I2, I4 | `test/contrato.test.js` | ci-test | sí |
| 4 adoptado | O1 | I1 | `scripts/adopted.mjs` | manual* (sobre homenu-panel y MenuPlan) | corregida: la Done corre el CLI sobre el fixture malo y espera código distinto de 0 |
| 5 lecciones v2 | O3 | I3 | `test/lessons.test.js` | ci-test | corregida: añade `node scripts/lessons.mjs --json` |
| 6 trinquete | O3 | I3, I1 | `test/skills.test.js` | ci-test | sí |
| 7 triaje | O3 | I3 | `test/lessons.test.js` | ci-test | sí |
| 8 marcas | O2 | I2, I4 | `test/intervenciones.test.js` | ci-test (forma); el dato, autodeclarado | corregida: añade `node scripts/hitl.mjs --json` |
| 9 decisiones en PR | O2 | I4 | `scripts/pr-body.mjs` en `tests.yml:69` | ci-test | corregida: la Done corre el CLI con un cuerpo sin «Decisions» y espera rojo |
| 10 decisiones en planes | O2 | I4 | `scripts/check-plan.mjs` en `tests.yml:84` | ci-test | corregida: CLI con el fixture malo |
| 11 P10 a P12 | O1, O2, O3 | I1 a I4 | juez vía C16 | ci-judge tras fusionar | no: el juez corre desde main (`pull_request_target`), así que una pregunta nueva solo se dispara tras fusionar; la primera prueba es la pasada del corpus |
| 12 C14 a C17 | O1, O2, O4 | I2, I3, I4 | juez | ci-judge tras fusionar | no, por lo mismo; la pasada del corpus la lanza Pablo tras el trozo 24 |
| 13 audit local | O1, O3, O4 | I5 | indicador | arranque (trozo 21) | sí (CLI); no es un check |
| 14 recolector | O1, O2 | I5 | `test/collect-records.test.js` | manual* | no: su entrada real pide el token del constructor y red; se prueba con un GitHub falso |
| 15 audit --data | O1, O2 | I5, I1 | indicador | manual* | corregida: CLI sobre registros de fixture |
| 16 valores libres | O1, O4 | I2, I5 | indicador | arranque (trozo 21) | corregida: CLI sobre fixture |
| 17 efecto y «no» falsos | O3 | I5, I3 | indicador | manual* | corregida: CLI sobre fixture |
| 18 audit --hitl | O2 | I5, I4 | indicador | manual* | corregida: CLI sobre fixture |
| 19 higiene | O3 | I5, I3, I1 | candidatos por PR; el revisor juzga | arranque (trozo 21) | sí (CLI) |
| 20 disparadores | todas | I3 | `test/triggers.test.js` | ci-test | sí: corre `node --test` de verdad en una carpeta temporal |
| 21 arranque | todas | I3, I5 | paso de `PASOS` | arranque | sí: la Done corre `scripts/al-arrancar.mjs` |
| 22 metas como datos | todas | todos | `test/goals.test.js` | ci-test | sí |
| 23 validación | todas | I1 a I4 | `test/invariants.test.js` | ci-test | sí: cada caso entra por el CLI o el test real |
| 24 corpus dorado | O3 | I5 | `golden.yml` | manual* (la lanza Pablo; deuda en el trozo 28) | no: la pasada real solo corre en GitHub y cuesta dinero; la Done prueba la puntuación con salidas fijas |
| 25 corpus solo a mano | ninguna | ninguno | ninguno | quita `schedule` y `push` | sí: el test del workflow exige que no estén |
| 26 principios | todas | todos | `test/principles-and-roles.test.js` | ci-test | sí (solo palabras clave) |
| 27 plan de MenuPlan | O1 | I1 | `check-plan` | ci-test | sí |
| 28 juez cambiado sin pasada | O3 | I5, I3 | indicador | arranque (lee el último dato) y manual* (necesita GitHub) | sí: CLI sobre registros de fixture |

### Celdas vacías
- Meta sin comprobación: ninguna tras el plan; hoy O2 no tiene indicador (no existe `audit`) y O3 solo tiene C6 y `REPEATED_WITHOUT_LESSON`. Hueco real; lo cierran los trozos 15, 17 y 18.
- Indicadores con lector y sin disparador: todos los de `audit` e higiene (`manual*`). Hueco real; con A1 lo cierra el trozo 21 para la parte local, y la de GitHub y el corpus se cuentan como deuda (trozos 22 y 28).
- Preguntas sin meta: C4, C5, C7 y C10. Correcto: son `base`; el trozo 22 las declara así en vez de dejarlas vacías.
- Principio sin invariante: 1 y 3. Correcto para el 3 (base); para el 1 es un hueco aceptado, sin lector posible sobre un diff.
- Invariante sin principio: I2, y el «disparador» de I3. Huecos; los cierra B1 (trozo 26).
- Preguntas de revisor del lado P sin juez automático: el hueco más serio. Lo cierra C16 (trozo 12).
- Trozo sin meta: 25. Correcto: es gasto y control de Pablo (A1).
- Corrijo el borrador del encargo: C3 es I1 (cohesión), no higiene; C7 sirve a I5; C2 sirve a O3; P1 es I2 y P7 es I1.

## Chunks
### 1. Registro de entidades con base y forja, legible de una vez
Files: `entities.json`, `scripts/lib/entities.mjs`, `scripts/entities.mjs`, `test/entities.test.js`, `base/entity.md`, `base/standard.md`
Depends on: none
Blocked by: none
Existing: `git ls-tree -r --name-only origin/main | grep -iE '(^|/)entities'` -> (sin salida). `git ls-tree --name-only origin/main base/` -> `base/skill.md` (la única base; su forja `comprobarSkill`, `scripts/lib/skills.mjs:74`). La forma de un estándar ya la leen `readQuestions` (`scripts/lib/questions.mjs`) y `PLAN_FIELDS` (`scripts/lib/plan.mjs:6`), sin base escrita. MenuPlan (solo lectura, `82ee97de`): `ops/entidades.json`, 57 entidades, 44 `horizontal` (node sobre el fichero).
Not done: no porta las 57 de MenuPlan; registra solo las que la Fábrica tiene con esquema en código (proyecto, lección, registro del revisor, intervención, mensaje, sesión, pregunta, plan, skill, rol, estándar, regla; meta e invariante las añade el trozo 22), con los nombres de campo de MenuPlan. Cada `horizontal` lleva `base` y `forge`, o `base: hueco` con motivo cerrado (`sin-forja`, `otro` + texto). El rol queda `hueco`: una base de rol no la necesita ningún mecanismo de este plan y `audit` cuenta el hueco. `base/standard.md` enlaza la forja y no repite sus reglas (C8). El test comprueba la clase: toda ruta de `source_of_truth`, `base`, `forge` y `readers` existe. `node scripts/entities.mjs --json` imprime el registro entero.
Done:
```sh
node --test test/entities.test.js && node scripts/entities.mjs --json
```

### 2. Registro de campos: un campo sin clasificar pone el test en rojo
Files: `fields.json`, `scripts/lib/fields.mjs`, `test/fields.test.js`, `scripts/lib/lessons.mjs`
Depends on: 1
Blocked by: none
Existing: `git grep -l -i -E "fields\.json|campo nuevo|new field" origin/main` -> (sin salida). `FIELDS` de lecciones no se exporta (`scripts/lib/lessons.mjs:25`). MenuPlan tiene `ops/campos-por-entidad.json`, que dice dónde medir y no clasifica cada campo.
Not done: la regla del campo nuevo es la suma de tres invariantes: «¿ya existe?» es I1, «¿entidad, parámetro o atributo, y con qué valores?» es I2, «¿dónde se cablea?» es I3. La máquina recorre solo las fuentes que declara `entities.json`; cada campo lleva `tipo` (entidad, parámetro, atributo_de + `de`), `dueño`, `existente` (id, o `nueva` con motivo cerrado), `valores` (enum, booleano, número, id, fecha, texto; `texto` exige motivo) y `cableado`. Fallos cerrados: sin declarar, nombre repetido (minúsculas, sin acentos), tipo fuera de lista, dueño o existente desconocido, declarado sin uso. Un sinónimo («precio» y «price») y un campo solo en código suelto no los ve: los juzga P10 (trozo 11). Llevarlo a los PR de cada proyecto pide un paso en `tests.yml` (lista cerrada): duda, no trozo.
Done:
```sh
node --test test/fields.test.js
```

### 3. Tabla de recuperación por código de salida
Files: `scripts/lib/exit.mjs`, `scripts/contract.mjs`, `scripts/lib/exit-codes.json`, `test/contrato.test.js`
Depends on: none
Blocked by: none
Existing: `git show origin/main:scripts/lib/exit-codes.json | grep -n -i -E "retry|recover"` -> (sin salida); `EXIT` tiene 17 códigos (`OK` y 16 de fallo).
Not done: cada código lleva `{retry, then}`; el test comprueba la clase (todo código tiene fila y toda fila nombra un código real). Los fallos sin código (los de las skills) quedan fuera; ejecutar la recuperación sola, también.
Done:
```sh
node --test test/contrato.test.js
```

### 4. Comprobación de proyecto adoptado: nada propio de lo que hereda
Files: `scripts/adopted.mjs`, `scripts/lib/adopted.mjs`, `test/adopted.test.js`, `test/fixtures/adopted/mezclado/.claude/agents/constructor.md`, `scripts/lib/exit.mjs`, `scripts/lib/exit-codes.json`
Depends on: 1, 3
Blocked by: none
Existing: `git grep -l -i "adopted" origin/main` -> solo `test/admin-proyecto.test.js` (una aserción de texto). Lo que hereda un proyecto es `PROJECT_FILES` (`scripts/admin/proyecto.mjs:21`). MenuPlan (solo lectura): 8 roles en `.claude/agents/`, 18 skills, 57 entidades (`ls` y node sobre su copia local).
Not done: vocabulario cerrado `OWN_ROLE`, `OWN_SKILL`, `OWN_FORGE`, `OWN_BASE`, `OWN_TEMPLATE`, `REDEFINED_ENTITY` (por id y también por `name` o `term` normalizados); código nuevo `ADOPTED_FAULTS` con su fila de recuperación («parar y apuntar»). En el PR se pega la salida sobre la copia local de homenu-panel (el proyecto N+1, decisión C3; `proyectos/homenu-panel.json:2-4` lo declara «repo existente que la Fábrica adopta») y sobre MenuPlan, como cifras de partida, sin umbral y sin afirmar el estado de ninguno. No arregla MenuPlan (trozo 27) ni corre en el CI del proyecto (`tests.yml`, lista cerrada).
Done:
```sh
node --test test/adopted.test.js && ! node scripts/adopted.mjs --dir test/fixtures/adopted/mezclado --json
```

### 5. Lecciones v2: pregunta obligatoria, señal o motivo cerrado, casos de la clase y escape
Files: `scripts/lib/lessons.mjs`, `scripts/lessons.mjs`, `test/lessons.test.js`, `test/lessons-cli.test.js`, `lessons/convertir-consumes-code-before-prechecks.json`, `fields.json`
Depends on: 2
Blocked by: none
Existing: esquema `v, class, source, mechanism, origin` (`scripts/lib/lessons.mjs:25`); `source` admite un `#n` (`PR_SOURCE`, línea 30); `class: none` sin motivo (`NO_CLASS`, línea 27), y `grep -h "\"class\"" lessons/*.json | sort | uniq -c` -> 1 `C5`, 5 `none`.
Not done: `v: 2`; `question` obligatoria; `signal` es `machine` (mecanismo = test con su marca) o `none` (con `reason` cerrado: `pregunta-pendiente`, `conducta-sin-pregunta`, `otro` + texto); `sources` es una lista, y con un solo caso exige `reason: caso-unico`, porque «test del caso y no de la clase» empieza por no nombrar otros casos; `escaped` (booleano: el fallo llegó a main antes de verse), fuente de la tasa de escapes (trozo 15). La máquina no sabe si el test cubre la clase (lo juzga C6). Se migran las 6 en el PR (aquí se lista la primera); `fields.json` se actualiza con los campos nuevos. Las 34 viñetas, en el trozo 6 y un PR por skill.
Done:
```sh
node --test test/lessons.test.js test/lessons-cli.test.js test/fields.test.js && node scripts/lessons.mjs --json
```

### 6. Sin lector no hay regla: trinquete por skill y prosa que copia un test
Files: `scripts/lib/skills.mjs`, `test/skills.test.js`, `base/skill.md`, `rules-without-reader.json`, `entities.json`
Depends on: 1, 5
Blocked by: none
Existing: `scripts/lib/skills.mjs:83-85` solo exige la sección «## Lo que falló» y al menos una viñeta con formato; las 4 skills suman 13 + 11 + 8 + 2 = 34 viñetas (awk sobre cada `SKILL.md` de origin/main) y `git grep -c "lessons/" origin/main -- .claude/skills` -> (sin salida). `git grep -l "rules-without-reader" origin/main` -> (sin salida); el único trinquete hoy es `scripts/lib/gh-quota.mjs:5`, cuya forma se sigue.
Not done: la entidad «regla» de `entities.json` nombra cada fuente de reglas y su lector (lección -> `mechanism`; pregunta -> `Quién`; viñeta -> `lessons/<id>.json`; principio -> `test/principles-and-roles.test.js`, que solo mira palabras clave, y se dice). Presupuesto por skill que solo baja: el test falla si las viñetas sin lección de una skill pasan de su número en `rules-without-reader.json` (hoy 13, 11, 8 y 2); subirlo es rebajar un check (C13). Fallo `PROSE_DUPLICATES_TEST`: una viñeta que enlaza una lección `signal: machine` sobra (el test ya es la memoria) y se borra. El trinquete va en la raíz y no en `lessons/`, porque `scripts/lib/lessons.mjs:67` lee esa carpeta entera como lecciones. Migrar las 34 viñetas, después y un PR por skill.
Done:
```sh
node --test test/skills.test.js test/entities.test.js
```

### 7. Triaje: cada «no» del revisor tiene lección o «sin lección» con motivo cerrado
Files: `scripts/lib/lessons.mjs`, `test/lessons.test.js`, `no-lesson.json`, `fields.json`, `entities.json`
Depends on: 5, 6
Blocked by: none
Existing: la única regla de «este fallo pide lección» es `REPEATED_WITHOUT_LESSON` (`scripts/lib/lessons.mjs:103`), solo sobre filas «repetida: sí» de `intervenciones.md`; `git grep -l "no-lesson" origin/main` -> (sin salida).
Not done: listar los «no» sin triar es del trozo 17. `no-lesson.json` es `{source, question, reason}` con `reason` cerrado (`ruido-del-juez`, `ya-cubierta` + id, `caso-unico`, `otro` + texto); va en la raíz por la misma razón que el trinquete. `ruido-del-juez` es la fuente de la tasa de «no» falsos por pregunta (trozo 17) y candidato al corpus dorado (trozo 24). Obligarlo dentro del PR pediría tocar el veredicto: no va.
Done:
```sh
node --test test/lessons.test.js test/fields.test.js test/entities.test.js
```

### 8. Marcas de intervención con «qué faltaba» y su camino de delegación
Files: `scripts/lib/intervention-log.mjs`, `scripts/hitl.mjs`, `test/intervenciones.test.js`, `intervenciones.md`
Depends on: none
Blocked by: none
Existing: `CLASES` (`scripts/lib/intervention-log.mjs:10`) dice qué hizo Pablo (`aprobar-puerta`, `alta-de-credencial`, `ampliar-permisos`, `traspaso-de-propiedad`, `aviso-de-permiso`, `decision-de-proceso`, `decision-de-producto`, `desatasco`, `correccion-de-agente`, `sin-clasificar`) y `CAMPOS` es `t, clase, origen`; nada dice qué le faltaba al sistema: `git grep -n -i -E "falta|delegar|contexto-aportado|fuera-de-lista" origin/main -- scripts/lib/intervention-log.mjs scripts/hitl.mjs` -> (sin salida, código 1).
Not done: Campo nuevo `falta`, vocabulario cerrado: `intencion` (solo Pablo sabe qué quiere), `autoridad` (las cuatro clases de `standards/intervention.md`), `conocimiento` (un dato que existía y no estaba legible), `verificacion` (juicio de calidad), `acceso` (clic, credencial), `memoria` (repetir una orden o recordar algo), `otro` + motivo. Tabla `CAMINOS` en el mismo fichero: conocimiento -> datos legibles; verificacion -> máquina u otro agente; acceso -> automatizar; memoria -> lección, skill o check; intencion y autoridad -> residuo legítimo. Tabla clase -> falta solo donde es unívoca; si no (`aviso-de-permiso` puede ser acceso o autoridad) se apunta `sin-clasificar` y se cuenta, sin valor inventado (principio 3). Clases nuevas `contexto-aportado`, `pregunta-fuera-de-lista`, `revision-de-diff`; origen `agente`; `node scripts/hitl.mjs marcar <clase> <falta>`. Una fila nueva en `intervenciones.md` con la decisión de Pablo (el HITL es el residuo no delegable y se minimiza con equilibrio; cuánto residuo vale lo fija él), citada como la aporta la sesión coordinadora. Las filas viejas no se migran. Autodeclarado, y la salida lo dice.
Done:
```sh
node --test test/intervenciones.test.js && node scripts/hitl.mjs --json
```

### 9. Decisiones y excepciones apuntadas en el PR: un lector de citas común y la sección «Decisions»
Files: `scripts/lib/decision.mjs`, `test/decision.test.js`, `scripts/lib/pr-body.mjs`, `scripts/lib/intervention.mjs`, `scripts/lib/gate.mjs`, `.github/pull_request_template.md`, `test/pr-body.test.js`, `test/fixtures/pr-body/good.md`, `test/fixtures/pr-body/no-decisions.md`, `test/fixtures/pr-body/no-files.txt`
Depends on: none
Blocked by: none
Existing: `SECTIONS` (`scripts/lib/pr-body.mjs:2-7`) tiene `What changes`, `Evidence`, `Red before`, `Not verified`; `git grep -n -i -E "invariant|decisions|principio [0-9]" origin/main -- scripts/lib/pr-body.mjs .github/pull_request_template.md scripts/lib/intervention.mjs` -> (sin salida, código 1); `git ls-tree -r --name-only origin/main scripts/lib | grep -c decision` -> 0. La comprobación ya corre en cada PR (`tests.yml:69`) desde `.fabrica`, copia entera de la Fábrica (`tests.yml:48-50`), así que `CLAUDE.md` está a mano. `scripts/lib/intervention.mjs` solo lee el bloque de rutas cerradas; las cuatro clases de la lista cerrada son viñetas en negrita (`standards/intervention.md:21-24`) que nadie lee. `test/gate-files.test.js:1-2` exige que `GATE_FILES` siga los imports de lo que corren los workflows.
Not done: `scripts/lib/decision.mjs` es el único lector de una línea de decisión (lo usará también el trozo 10, I1): `- principio <n> | eligió: <x> | descartó: <y> | motivo: <clase de la lista cerrada> o decidido`, o `- excepción a principio <n> | motivo: <texto> | coste: <texto>`. Comprueba existencia y forma: `<n>` es un principio numerado de `CLAUDE.md` (hoy 1 a 6), la clase es una de las cuatro (se exportan de `intervention.mjs`), `descartó` no está vacío ni es igual a `eligió`, y una excepción lleva motivo y coste. Sección nueva `Decisions` en `SECTIONS`, siempre obligatoria; vale `None`. `decision.mjs` entra en `GATE_FILES` porque lo importa `pr-body.mjs`. No comprueba el encaje (C15, trozo 12) ni que `None` esconda una decisión. Cita principios y no ids I1 a I5 porque B decide si los principios pasan a ser los invariantes. Toca GATE_FILES: añade fallos y no quita ninguno (C13 más estricto); si rompe `tests`, se revierte el PR desde una rama nueva.
Done:
```sh
node --test test/decision.test.js test/pr-body.test.js test/gate-files.test.js && ! node scripts/pr-body.mjs --body-file test/fixtures/pr-body/no-decisions.md --files-file test/fixtures/pr-body/no-files.txt
```

### 10. Decisiones de los planes: sección «Decisions taken» que check-plan comprueba
Files: `scripts/lib/plan.mjs`, `test/check-plan.test.js`, `test/fixtures/plans/good.md`, `test/fixtures/plans/no-decisions-taken.md`, `standards/plan.md`
Depends on: 9
Blocked by: none
Existing: `parsePlan` solo mira las secciones `Chunks`, `Decisions for Pablo` y `Not verified` (`scripts/lib/plan.mjs:111,138,153`); `git grep -n -i "decisions taken" origin/main` -> (sin salida). `test/check-plan.test.js:1` exige que cada código de `PLAN_FAULTS` tenga una mutación del fixture verde que lo levante.
Not done: sección `Decisions taken`, obligatoria (vale `None`), con las mismas líneas que el trozo 9, leídas por `scripts/lib/decision.mjs` (no se copia el lector). Códigos nuevos en `PLAN_FAULTS`: `MISSING_DECISIONS_TAKEN` y `BAD_DECISION_LINE`, cada uno con su mutación del fixture. `standards/plan.md` («Shape») nombra la sección y enlaza el lector. Los planes viejos (`plans/app-admin.md`) no se tocan: `tests.yml:78-84` solo comprueba el plan que cambia, así que fallarán cuando alguien los edite, y se dice. El encaje lo juzga P11 (trozo 11). Toca GATE_FILES (`plan.mjs`): añade fallos (C13); si rompe, se revierte el PR.
Done:
```sh
node --test test/check-plan.test.js && node scripts/check-plan.mjs --file test/fixtures/plans/good.md && ! node scripts/check-plan.mjs --file test/fixtures/plans/no-decisions-taken.md
```

### 11. Preguntas P10, P11 y P12: campos, encaje de las decisiones y regla con lector en los planes
Files: `standards/plan.md`, `test/plan-standard.test.js`, `goals.json`
Depends on: 10, 2, 22, 26
Blocked by: none
Existing: `standards/plan.md` llega a P9 (`grep -n "^### P"`); `test/plan-standard.test.js:19-20` fija la lista de preguntas y su «Quién». Ninguna P pregunta por campos, por el encaje de una decisión ni por el lector de una regla nueva.
Not done: P10 (I1, I2): ¿cada campo o entidad nueva del plan está clasificada y comparada con `entities.json` y `fields.json`? P11 (I4): ¿cada línea de «Decisions taken» aplica el principio que cita (la alternativa descartada lo incumpliría), y cada decisión del plan que no impone el encargo está ahí? P12 (I3): ¿cada regla nueva del plan nombra su lector y su disparador (`ci-test`, `ci-judge`, `corpus`, `arranque`; `manual` solo declarado como deuda), la Done de cada check lo prueba por su punto de entrada real con un caso malo en rojo, y cada trozo que nace de un fallo nombra su clase? Las tres son de revisor y no tienen juez automático hasta el trozo 12 (C16). Cada una lleva su fila en `goals.json` (lo exige el test del trozo 22). Va al final por decisión de Pablo: las preguntas nuevas del juez entran después del resto («Build order»). `standards/plan.md` no es GATE_FILES hoy; pasa a serlo en el trozo 12.
Done:
```sh
node --test test/plan-standard.test.js test/goals.test.js
```

### 12. Preguntas C14, C15, C17 y la puente C16, y `standards/plan.md` como fichero de la puerta
Files: `standards/code.md`, `scripts/lib/gate.mjs`, `test/gate-files.test.js`, `test/questions.test.js`, `goals.json`, `scripts/lib/triggers.mjs`, `test/triggers.test.js`
Depends on: 9, 11, 20, 22
Blocked by: none
Existing: `grep -n "^### C" standards/code.md` (copia de origin/main) -> C1 a C13; `test/questions.test.js:46` pide `>= 13`. `revisor.yml:84` y `revisor.yml:115` juzgan solo contra `standards/code.md`, y `git grep -n "plan.md" origin/main -- scripts/veredicto.mjs scripts/lib/questions.mjs .github/workflows/revisor.yml .claude/agents/revisor.md` -> (sin salida): las P de revisor no tienen juez automático. `standards/plan.md` no está en `GATE_FILES` (`scripts/lib/gate.mjs:14-36`).
Not done: C14 (I2): ¿lo que se repite (un umbral, un valor de pocos casos, una receta) es una tabla o un enum que un lector usa, o una excepción apuntada, y cada campo nuevo está en `fields.json`? C15 (I4): ¿cada decisión que no impone el encargo está en «Decisions», y la alternativa descartada incumpliría el principio citado? C16 (I3): si el PR cambia un `plans/<slug>.md`, ¿el plan cumple cada pregunta de revisor de `.fabrica/standards/plan.md`? (la prueba nombra la P que falla; si no hay plan, «no aplica»). C17 (I3): ¿cada check nuevo se dispara por su entrada real (lo recoge `npm test`, lo corre `tests.yml` o lo lee el revisor) y el PR muestra un caso malo que lo pone en rojo por esa entrada, no llamando a la función? C16 da juez a P2 a P6, P8 y P10 a P12 sin tocar `revisor.yml`; el registro guarda solo «C16», no la P, y se dice. `standards/plan.md` entra en `GATE_FILES` en una lista aparte de lo que lee el juez y no derivan los workflows, como `ADMIN_GATE_FILES` (`scripts/lib/gate.mjs:43`), y el test la exige. Son preguntas de juicio: entran como hipótesis con su tasa de «no» falsos (trozo 17). Cada pregunta lleva su fila en `goals.json`, y `triggers.mjs` gana el fallo «pregunta de revisor de `plan.md` sin C16», que antes de este trozo sería rojo seguro. Toca GATE_FILES: añade y no quita (C13). Ya no dispara la pasada del corpus (el trozo 25 quita el `push`): C14 a C16 salen «no concluyente» hasta el trozo 24 y la pasada que lanza Pablo; C17 sigue sin casos. Una pregunta nueva solo se dispara tras fusionar: el juez corre desde main (`pull_request_target`), así que este PR no puede probar su propio disparo. Si rompe, se revierte el PR.
Done:
```sh
node --test test/questions.test.js test/gate-files.test.js test/triggers.test.js test/goals.test.js
```

### 13. npm run audit con las fuentes locales y su lista cerrada de indicadores
Files: `scripts/audit.mjs`, `test/audit.test.js`, `scripts/lib/lessons.mjs`, `package.json`, `.claude/agents/constructor.md`
Depends on: 2, 6, 7
Blocked by: none
Existing: `git ls-tree -r --name-only origin/main | grep -iE audit` -> (sin salida). `DATED_ROW` sin exportar (`scripts/lib/lessons.mjs:33`). Hoy 26 `.mjs` en la raíz de `scripts/` y 10 ficheros de `scripts/` citan `--json`; el mayor es `scripts/lib/plan.mjs` con 323 líneas (`wc -l`). `git grep -n "no-magic-numbers" origin/main` -> (sin salida, código 1).
Not done: `audit` exporta `INDICATORS`, la lista cerrada de ids de lo que mide (la leerán los trozos 20 y 22); cada trozo de `audit` posterior añade los suyos. Indicadores de este trozo: preguntas, lecciones por `signal` y `reason`, reglas sin lector (lee el número del trozo 6, no lo recalcula), hitl «autodeclarado», scripts sin `--json`, ficheros de más de 200 líneas, números escritos en comparaciones (regla `no-magic-numbers` de ESLint corrida desde `audit` y no en el lint, donde pondría todo en rojo) y huecos de base del registro. Son señales, no puertas: ningún umbral falla. Toca `package.json` (GATE_FILES): solo añade el script `audit` (C13); si rompe, se revierte el PR.
Done:
```sh
node --test test/audit.test.js && node scripts/audit.mjs --json
```

### 14. El recolector baja también los ficheros y la rama de cada PR
Files: `scripts/collect-records.mjs`, `test/collect-records.test.js`
Depends on: none
Blocked by: none
Existing: `git grep -n -E "/files|head\.ref" origin/main -- scripts/collect-records.mjs` -> (sin salida, código 1); guarda `{number, state, created_at, merged_at, commits}` (`scripts/collect-records.mjs:68`).
Not done: la rama (`head.ref`) dice si un PR es `fix/`, fuente de la tasa de escapes (trozo 15). Ficheros por commit, no. No cambia `check-runs.json`.
Done:
```sh
node --test test/collect-records.test.js
```

### 15. audit --data: rondas, «no» por pregunta, minutos, anulaciones, mensajes, retrabajo, choques y escapes
Files: `scripts/audit.mjs`, `test/audit.test.js`, `test/fixtures/audit/records.json`
Depends on: 13, 14
Blocked by: none
Existing: `git grep -n -i -E "minut|merged_at|area|escape" origin/main -- scripts/records.mjs scripts/lib/record.mjs` -> (sin salida, código 1). `scripts/records.mjs:10` ya cuenta `overrides`.
Not done: choques (PR abiertos a la vez sobre el mismo fichero) y retrabajo (PR que toca un fichero de otro fusionado en 48 h) son la cifra de I1-cohesión; el retrabajo mezcla errores y cambios de idea, y se dice. Tasa de escapes, contrapeso del HITL: PR `fix/` que tocan ficheros de un PR fusionado en los 14 días anteriores, más lecciones con `escaped: true`, entre PR fusionados; cota inferior (un defecto que nadie vio no cuenta). Rondas «cota inferior», mensajes «cota superior». Coste del proyecto N+1 = las mismas cifras con `--repo factory-am89/homenu-panel` (decisión C3; el recolector ya acepta `--repo`): PR hasta el primero fusionado, rondas y marcas de Pablo. No se crea ningún repo ni se amplía ningún permiso; si el token del constructor no puede leer ese repo, falla en alto y se dice (no está comprobado). Sin tendencias entre semanas.
Done:
```sh
node --test test/audit.test.js && node scripts/audit.mjs --data --records test/fixtures/audit/records.json --json
```

### 16. audit: valores repetidos en campos de texto, con propuesta de enum
Files: `scripts/lib/free-values.mjs`, `test/free-values.test.js`, `scripts/audit.mjs`, `test/audit.test.js`
Depends on: 15
Blocked by: none
Existing: `git grep -l -i "free-values" origin/main` -> (sin salida). MenuPlan lo hace contra su base de datos (`scripts/columnas-pocos-valores.mjs`), no contra ficheros.
Not done: recorre los campos que `fields.json` marca `texto` y propone; el enum lo decide otro PR. Programarlo sería un workflow (lista cerrada): lo corre quien abre `audit`.
Done:
```sh
node --test test/free-values.test.js test/audit.test.js && node scripts/audit.mjs --json
```

### 17. audit: efecto de cada lección, «no» sin triar y «no» falsos por pregunta
Files: `scripts/audit.mjs`, `test/audit.test.js`, `test/fixtures/audit/records.json`
Depends on: 16, 7
Blocked by: none
Existing: ninguna lección tiene fecha propia (`scripts/lib/lessons.mjs:25`); la fecha sale del `merged_at` de su PR origen (`scripts/collect-records.mjs:68`). `git grep -l -i -E "relapse|recaida|false-no|falsos" origin/main -- scripts` -> `scripts/admin/proyecto.mjs`, `scripts/golden.mjs`, `scripts/lib/golden-guard.mjs`: los dos últimos cuentan `falsosNo` solo sobre el corpus dorado; nada lo cuenta sobre los PR reales. La varianza entre pasadas del juez ya la calcula `scripts/golden-run.mjs:147-160`, solo sobre el corpus.
Not done: por lección, % de «no» de su pregunta antes y después; con menos de 5 casos por lado (`MIN_CASES_PER_CELL`, se importa), «no concluyente». Lista los «no» sin entrada en lección ni en `no-lesson.json`. Cada pregunta de juez como hipótesis: tasa de «no» falsos = (`ruido-del-juez` + anulaciones de Pablo) / «no» de esa pregunta, y las preguntas que `golden-run` marca inestables; C16 sale agregada (no por P). Sin umbral que falle: es el dato con el que Pablo decidiría cambiar cómo responde el juez («Doubts»).
Done:
```sh
node --test test/audit.test.js && node scripts/audit.mjs --data --records test/fixtures/audit/records.json --json
```

### 18. audit --hitl: residuo por tipo de lo que faltaba, tendencia y «¿se puede delegar ya?», junto a los escapes
Files: `scripts/audit.mjs`, `test/audit.test.js`, `test/fixtures/audit/records.json`
Depends on: 17, 8
Blocked by: none
Existing: `npm run hitl -- --json` cuenta por clase y por origen (`scripts/lib/intervention-log.mjs:10-16`), sin tipo de falta ni semanas; `contarMensajes` (`scripts/lib/message-log.mjs`) cuenta los mensajes de Pablo por sesión sin texto; `git grep -l -i "delegar" origin/main -- scripts` -> (sin salida, código 1).
Not done: por semana y por `falta`, recuento y mensajes de Pablo (aproximación a su atención: no se mide tiempo, y se dice), con tendencia y «no concluyente» por debajo de 5. Por cada tipo delegable (conocimiento, verificacion, acceso, memoria), las clases que más pesan con su camino de `CAMINOS` y la pregunta «¿se puede delegar ya?», que el agente que corre `audit` contesta con un PR o con «no, porque» apuntado en «Decisions». Al lado, la tasa de escapes del trozo 15: bajar marcas de `verificacion` subiendo escapes es el desequilibrio que hay que ver. Ningún objetivo de cero ni umbral: cuánto residuo vale lo fija Pablo cuando haya cifra de partida.
Done:
```sh
node --test test/audit.test.js && node scripts/audit.mjs --hitl --records test/fixtures/audit/records.json --json
```

### 19. Higiene de lecciones: la máquina calcula candidatos a fusionar, podar y promover; un agente lo propone por PR
Files: `scripts/hygiene.mjs`, `scripts/lib/hygiene.mjs`, `test/hygiene.test.js`, `scripts/audit.mjs`, `test/audit.test.js`, `package.json`, `.claude/agents/constructor.md`
Depends on: 18
Blocked by: none
Existing: `git ls-tree -r --name-only origin/main | grep -i -E "hygiene|higiene"` -> (sin salida, código 1). Lo más cercano es `npm run stale-skills` (`package.json:16`; `REVISAR_DIAS = 90`, `scripts/lib/skills.mjs:7`), que solo mira fechas. MenuPlan (solo lectura) tiene `.claude/skills/higiene-de-skills` (149 líneas) y `scripts/lib/higieneSkills.mjs`: mira forma, caducidad, rutas y comandos muertos, solape de descripciones (`solape-cercano`) y tamaño, y su propia regla de poda (más de la mitad de avisos falsos en tres revisiones, o 90 días sin uso); no agrupa ni poda lecciones por clase ni por efecto.
Not done: `npm run hygiene -- --json` lista candidatos de un vocabulario cerrado, sin cambiar nada: `MERGE` (misma `class` o mismo `mechanism`), `PROMOTE` (viñeta o lección `signal: none` cuya clase ya tiene un test: se promueve y se borra la prosa), `RETIRE_TEXT` (lección `signal: machine` cuya pregunta no tuvo «no» en 5 casos o más tras ella: se quita el texto y se queda el test), `REWORK` (pregunta que no baja su % de «no» con 5 casos por lado: el mecanismo no sirve y se rehace, no se borra), `OVERLAP` (dos lecciones o skills que citan los mismos ficheros), `DEAD_REF` (ruta o comando citado que no existe, idea heredada de MenuPlan). `audit` cuenta los candidatos por código (indicador). Cada candidato lo redacta un agente en un PR propio y lo juzga el revisor; nadie juzga su trabajo. No se copia la skill de MenuPlan (I1: la Fábrica no tiene forja de tipos de skill). Contradicciones entre lecciones y «lección que dispara donde no toca» no las ve la máquina: C8 cuando llegan en el PR; medir el disparo de una skill cuesta tokens (MenuPlan, `npm run skills-prueba`) y no va. Programarlo sería un workflow (lista cerrada). Toca `package.json` (GATE_FILES): solo añade el script (C13).
Done:
```sh
node --test test/hygiene.test.js test/audit.test.js && node scripts/hygiene.mjs --json
```

### 20. Disparadores calculados: cada lector resuelve a un disparador, y el cableado no se puede quitar sin rojo
Files: `scripts/lib/triggers.mjs`, `test/triggers.test.js`
Depends on: 5, 19
Blocked by: none
Existing: `git grep -l -i -E "trigger|disparador" origin/main -- scripts test` -> `scripts/lib/gate.mjs` (un comentario) y `test/administrador.test.js`, cuya función `disparadores` (línea 59) lee los `on:` de un workflow; no se mueve aquí porque ese test es GATE_FILES (`scripts/lib/gate.mjs:46`), y el solape se dice en el PR. Lo que hay: `package.json:26` es `node --test`; `tests.yml:44` corre `npm test`; `golden.yml:22-28` se dispara con `push` en `standards/**` y el juez; `revisor.yml:115` fija `STANDARD`; `PASOS` (`scripts/al-arrancar.mjs:23`) tiene `al-dia`, `limpiar`, `sesiones` y `hora`; el meta-test de `*_FAULTS` (`test/golden-machine.test.js:126`). Qué recoge `node --test`: probado en una carpeta temporal con Node 24 (sección «Wiring»).
Not done: el disparador no se guarda donde se puede calcular (guardarlo sería una copia, I1): `TRIGGERS` es la lista cerrada (`ci-test`, `ci-judge`, `corpus`, `manual`, `arranque`, `cron`), y `triggerOf(lector)` lo calcula. Una ruta da `ci-test` si `node --test` la recoge y `tests.yml` corre `npm test`; un id de pregunta da `ci-judge` si su «Quién» es revisor y está en `standards/code.md`, o en `standards/plan.md` con C16 presente; un comando de `package.json` da `arranque` si está en `PASOS` y si no, `manual`; `cron` solo si un workflow con `schedule` lo corre. Los patrones de `node --test` se copian de la documentación de Node, y el test ata la copia a lo real: crea una carpeta temporal, corre `node --test` de verdad y compara qué ficheros se ejecutaron (C8: copia con test que la compara). `TRIGGER_FAULTS` (el meta-test lo cubre): lector sin disparador, test fuera de lo que recoge `node --test`, mecanismo de una lección que no se dispara, `package.json` sin `node --test`, `tests.yml` sin `npm test`, workflow que deja de disparar un lector que se declara `ci-test` o `ci-judge`. El fallo «pregunta de revisor de `plan.md` sin C16» lo añade el trozo 12: hoy sería rojo seguro. Leer los workflows no es tocarlos (lista cerrada). Lo que no ve: un `if` que salte un paso del workflow en ciertos PR; para eso sigue C13. Lo usan `audit` (trozo 22) y la regla de las lecciones.
Done:
```sh
node --test test/triggers.test.js test/golden-machine.test.js
```

### 21. Paso de arranque «periódico»: `audit` e higiene locales al abrir una sesión, y deuda de lo que no corrió
Files: `scripts/al-arrancar.mjs`, `test/al-arrancar.test.js`
Depends on: 20, 22, 28
Blocked by: none
Existing: `PASOS` (`scripts/al-arrancar.mjs:23`) no tiene ningún paso de medida; `git grep -n -i -E "audit|hygiene" origin/main -- scripts/al-arrancar.mjs` -> (sin salida, código 1). Un paso que falla se dice y no frena los demás (`scripts/al-arrancar.mjs:2`). No toca `.claude/settings.json` ni `.claude/hooks/**`.
Not done: paso `periodico`: corre la parte local de `audit` (sin red) y cuenta los candidatos de higiene, y escribe en el contexto de la sesión solo lo que cambió y los lectores `manual` que llevan más de 7 días sin correr (lee la hora de la última pasada que apunta `audit`, trozo 22; va después de él aunque su número sea menor). La parte de GitHub (`--data`, `--hitl`) no corre al arrancar (pide token y red): se lista como deuda. Autorizado por Pablo (A1): `standards/intervention.md:40` dice que lo que corre solo pide a Pablo primero, y este paso corre solo aunque el glob de la lista cerrada no lo marque. Muestra también la deuda del trozo 28 (cambio del juez sin pasada posterior) con el último dato que dejó `audit --data`. Opción nueva `--solo <paso>` para probarlo por la entrada real sin correr `al-dia` ni `limpiar`, que tocan la carpeta principal. Si rompe el arranque, el paso falla sin frenar los demás y se revierte el PR.
Done:
```sh
node --test test/al-arrancar.test.js && node scripts/al-arrancar.mjs --solo periodico
```

### 22. Metas e invariantes como datos: `goals.json`, su test y `audit` que lista metas sin indicador y lectores sin disparador
Files: `goals.json`, `scripts/lib/goals.mjs`, `test/goals.test.js`, `entities.json`, `fields.json`, `scripts/audit.mjs`, `test/audit.test.js`
Depends on: 20
Blocked by: none
Existing: `git ls-tree -r --name-only origin/main | grep -i -E "goals|metas|invariant"` -> (sin salida). Hoy las metas solo están en la conversación con Pablo y en planes (prosa); los principios, en `CLAUDE.md:7-12`; las preguntas, en `standards/code.md` y `standards/plan.md`, leídas por `readQuestions`.
Not done: trozo propio y no dentro del trozo 1, porque su test necesita los indicadores de `audit` (trozos 13 a 19) y los disparadores (20); las preguntas nuevas (11 y 12) van después y añaden su fila; en el trozo 1 sería un registro sin lector (I3). `goals.json` tiene tres listas: `goals` (`id`, `name`, `invariants`, `principles`, `indicators` como ids de `INDICATORS` de `audit` o `hueco` con motivo cerrado, `readers` como rutas de test, ids de pregunta o comandos, `check`: `máquina`, `juez` o `nadie`), `invariants` (`id`, `text`, `goals`, `principles`, `questions`) y `questions` (cada id con sus `goals`, o `base` con motivo cerrado: `seguridad`, `fallo-visible`, `tests-fiables`, `otro` + texto). No se guardan ni el disparador (lo calcula `triggerOf`, trozo 20) ni el estado «no concluyente» (lo calcula `audit` con los casos de cada indicador): guardarlos sería una copia que caduca (I1). El test: toda meta tiene indicador existente o `hueco`; todo invariante sirve a una meta y está en un principio o una pregunta; toda pregunta de `readQuestions` tiene fila y ninguna fila nombra una pregunta que no existe; todo principio citado existe en `CLAUDE.md`; todo lector existe y resuelve a un disparador. `audit` apunta la hora de cada pasada en `~/.fabrica/` y lista las metas con `hueco`, cada indicador «no concluyente» y cada lector `manual` como deuda, con los días desde que corrió: nunca dice que corre si nadie lo abre. Las entidades «meta» e «invariante» entran en `entities.json` y sus campos en `fields.json`. Los trozos no van en el fichero: viven en planes que caducan.
Done:
```sh
node --test test/goals.test.js test/audit.test.js test/entities.test.js test/fields.test.js && node scripts/audit.mjs --json
```

### 23. Validación de la abstracción: casos malos nuevos que los mecanismos deben cazar
Files: `test/invariants.test.js`, `test/fixtures/invariants/expected.json`, `test/fixtures/invariants/i2-estado-texto-libre/data.json`
Depends on: 4, 10, 18, 20, 22
Blocked by: none
Existing: `git ls-tree -r --name-only origin/main test/fixtures | grep -i -c invariant` -> 0. Ya existen canarios de máquina (`test/golden-machine.test.js:1-3`, «machine canaries: caught/total», falla con un fallo) y un juez que no ve los esperados (`golden.yml:16-18`); este trozo sigue la forma del primero y deja los de juez al trozo 24.
Not done: el conjunto está en «Abstraction validation». Cada caso lleva `invariant`, `detector` (`machine`, `juez`, `ninguno`) y, si es `machine`, el fallo esperado; aquí se lista el primer fichero y los demás van en el PR. Los `machine` entran por el punto de entrada real (el CLI o `node --test` sobre una carpeta temporal), no llamando a la función; el test falla si uno no se caza e imprime cazados/total por invariante con «no concluyente» por debajo de 5. «Reservado» solo en el tiempo: lo escribe una sesión que no construyó los mecanismos, cuando ya están en main, y el PR no toca código de mecanismo; si un caso `machine` no se caza, pasa a `ninguno` con motivo en el mismo PR (se ve en el diff) y abre una lección.
Done:
```sh
node --test test/invariants.test.js
```

### 24. Corpus dorado: C5, C9, C14, C15 y C16 a 5 casos, con los casos de juez de la validación
Files: `test/fixtures/golden/review/expected.json`, `test/fixtures/golden/review/caso-10/pr.diff`, `test/fixtures/golden/review/caso-10/body.md`, `test/golden-score.test.js`
Depends on: 12
Blocked by: none
Existing: `expected.json` tiene 9 casos (`grep -c caso- expected.json` -> 9), uno por pregunta; `test/golden-score.test.js:38` fija `cases.length, 9` y la línea 39 la lista de seis preguntas. Un caso nuevo no es rebaja (`scripts/lib/golden-guard.mjs:7`).
Not done: 23 casos, caso-10 a caso-32 (aquí la primera carpeta): 4 más para C5 y para C9, y 5 para C14, C15 y C16 (los de C16 son PR que cambian un plan y fallan una P). Los de C14 y C15 son los de juez de «Abstraction validation». C17, cada P por separado (C16 las agrega), el resto de preguntas y el suelo (`floor.json`, que no existe), no. Se actualiza la cifra del test, no se quita la aserción. La Done prueba la puntuación con salidas fijas. La pasada real la lanza Pablo (`workflow_dispatch`) justo después de este trozo y antes de fiarse de C14 a C16; coste estimado unos 15 dólares de API con 23 casos más los 9 de hoy, dentro de su cupo Max (cifra suya, no medida).
Done:
```sh
node --test test/golden-machine.test.js test/golden-score.test.js
```

### 25. El corpus dorado solo corre cuando Pablo lo lanza: fuera `schedule` y `push`
Files: `.github/workflows/golden.yml`, `test/golden-workflow.test.js`, `intervenciones.md`
Depends on: 8
Blocked by: A
Existing: `.github/workflows/golden.yml:20-29` tiene `schedule` (`cron: 17 5 * * 1`), `push` a `main` con `paths` `.claude/agents/revisor.md`, `standards/**`, `.github/workflows/revisor.yml`, `scripts/veredicto.mjs`, y `workflow_dispatch`; `test/golden-workflow.test.js:27-31` exige justo esos tres.
Not done: queda solo `workflow_dispatch`. El test pasa a exigir `on` igual a `[workflow_dispatch]`, sin `schedule` ni `push`: cambia una aserción por otra igual de estricta sobre la decisión nueva. Quitar dos disparadores de una medida es rebajar un check (lista cerrada): lo decidió Pablo (A1 y su ampliación), y el PR añade su fila en `intervenciones.md`. La lista de rutas del juez que hoy vive en el `push` pasa al trozo 28 (un solo sitio), que cuenta como deuda el cambio del juez sin pasada posterior. Si rompe, se revierte el PR desde una rama nueva.
Done:
```sh
node --test test/golden-workflow.test.js
```

### 26. Los principios de CLAUDE.md pasan a decir los invariantes y el residuo, sin lista de casos
Files: `CLAUDE.md`, `test/principles-and-roles.test.js`, `goals.json`
Depends on: 9, 22
Blocked by: B
Existing: `test/principles-and-roles.test.js:7-15` exige 6 principios por su palabra clave y como mucho 20 líneas con texto; hoy `CLAUDE.md` tiene 13 (`grep -c .`). `git grep -n -E "0 ?%" origin/main -- CLAUDE.md standards` -> solo `CLAUDE.md:3` («el 100% de la verdad»): el rótulo «0 % HITL» no está ni en `CLAUDE.md` ni en la lista cerrada, sino en citas de `intervenciones.md` y en un comentario de `scripts/lib/golden-guard.mjs:7`.
Not done: B1, decidida por Pablo: se mantiene la numeración de 1 a 6 (las citas de los trozos 9 y 10 siguen valiendo); I2 entra en el principio 4 y el disparador en el 5 (celdas vacías de «Matrix»); los invariantes se escriben como valor por defecto con excepción apuntada, y el principio 6 dice que lo que se pregunta a Pablo es el residuo de intención y autoridad; `goals.json` se actualiza si cambia qué principio sirve a qué invariante (el test del trozo 22 lo exige). El test de principios se endurece con las palabras clave nuevas y conserva las obligaciones del principio 6 (C13). Ningún ejemplo entra en `CLAUDE.md`. No cambia la lista cerrada: sus cuatro clases son la `autoridad` del trozo 8.
Done:
```sh
node --test test/principles-and-roles.test.js test/goals.test.js
```

### 27. Plan de la serie que separa la factoría del producto en MenuPlan
Files: `plans/menuplan-separation.md`
Depends on: 4, 10
Blocked by: none
Existing: `git ls-tree --name-only origin/main plans/` -> `plans/app-admin.md` (ningún plan de MenuPlan).
Not done: solo el plan de la serie (con su «Decisions taken», trozo 10), con la salida del trozo 4 como inventario: qué se borra porque la Fábrica ya lo tiene, qué se sube antes y qué queda como vertical. Ningún cambio en MenuPlan. Con C3 el proyecto N+1 es homenu-panel, así que esta serie no mide la escala ni corre prisa; sigue haciendo falta por la regla de Pablo (un proyecto no lleva forjas, bases, roles ni skills propios).
Done:
```sh
node scripts/check-plan.mjs --file plans/menuplan-separation.md
```

### 28. Deuda del juez: cambios de revisor o estándar sin pasada del corpus posterior
Files: `scripts/golden.mjs`, `scripts/collect-records.mjs`, `test/collect-records.test.js`, `scripts/audit.mjs`, `test/audit.test.js`, `test/fixtures/audit/records.json`
Depends on: 25, 22
Blocked by: none
Existing: hoy la regla vive solo como `paths` del `push` de `golden.yml` (líneas 22-28), que el trozo 25 quita; `git grep -n -i -E "JUDGE_PATHS|workflows/golden.yml/runs" origin/main -- scripts` -> (sin salida). El recolector baja PR y check-runs (`scripts/collect-records.mjs:68`), no ejecuciones de workflows.
Not done: `JUDGE_PATHS` en `scripts/golden.mjs` (las cuatro rutas que hoy tiene el `push`; un solo sitio). El recolector baja también las ejecuciones de `golden.yml` (fecha, `head_sha`, conclusión). `audit --data` cuenta la deuda: commits de `main` que tocan `JUDGE_PATHS` después del `head_sha` de la última pasada que terminó bien, con los días desde el primero. Es calculable con el token del constructor y red; sin ellos sale «no calculado», en alto, nunca 0. El paso de arranque (trozo 21) muestra el último dato que dejó `audit --data`, sin red. No lanza la pasada: la lanza Pablo.
Done:
```sh
node --test test/collect-records.test.js test/audit.test.js && node scripts/audit.mjs --data --records test/fixtures/audit/records.json --json
```

## Build order
Veinte olas. Dentro de una ola los trozos se construyen a la vez: ninguno comparte un fichero de `Files` con otro de su ola, y todos sus `Depends on` están en olas anteriores (comprobado con un script sobre los `Files` y `Depends on` de este plan; `check-plan` no da ningún `SHARED_FILE`). Los trozos que tocan la puerta (`gate=true` en `check-plan`: 9, 10, 12, 13 y 19) van solos en su ola, porque al fusionarse cambian las comprobaciones que verían los PR de al lado. Las preguntas nuevas del juez van al final, por decisión de Pablo.

| Ola | Trozos | Nota |
|---|---|---|
| 1 | 1, 3, 8, 14 | |
| 2 | 2, 4, 25 | 25 toca `golden.yml` (ruta cerrada, OK de Pablo con A1) |
| 3 | 5 | |
| 4 | 6 | |
| 5 | 7 | |
| 6 | 9 | puerta |
| 7 | 10 | puerta |
| 8 | 13 | puerta (`package.json`) |
| 9 | 15, 27 | |
| 10 | 16 | |
| 11 | 17 | |
| 12 | 18 | |
| 13 | 19 | puerta (`package.json`) |
| 14 | 20 | |
| 15 | 22 | |
| 16 | 23, 26, 28 | 26 toca `CLAUDE.md` (ruta cerrada, OK de Pablo con B1) |
| 17 | 21 | |
| 18 | 11 | preguntas P10 a P12 |
| 19 | 12 | puerta; preguntas C14 a C17 |
| 20 | 24 | casos del corpus; después, Pablo lanza la pasada (`workflow_dispatch`) |

Entre la ola 19 y la pasada de Pablo no se fusiona nada más: el revisor ya aplica C14 a C17 y aún no están medidas. Si la pasada da un «no» falso alto en una pregunta nueva, se trata como un fallo de clase (trozo 7, `ruido-del-juez`), no se relaja a mano.

## Abstraction validation
Casos malos nuevos, ninguno de los 40 ejemplos. Celda = invariante x detector; conclusiva con 5 casos o más.

| Caso | Inv. | Detector | Qué lo caza |
|---|---|---|---|
| campo `Estado` y `estado` en dos entidades | I1 | machine | trozo 2, nombre repetido |
| rol `builder.md` en un proyecto adoptado (el constructor con otro nombre) | I1 | machine | trozo 4, `OWN_ROLE` |
| entidad `household` en un proyecto con `term` igual a la horizontal `hogar` | I1 | machine | trozo 4, `REDEFINED_ENTITY` |
| `base/entity.md` copiada en un proyecto | I1 | machine | trozo 4, `OWN_BASE` |
| entidad horizontal nueva sin `base` ni `hueco` | I1 | machine | trozo 1 |
| viñeta que repite una lección con test | I1 | machine | trozo 6, `PROSE_DUPLICATES_TEST` |
| campo `estado` de texto libre en una fuente declarada, sin entrada en `fields.json` | I2 | machine | trozo 2 |
| campo declarado `valores: texto` sin motivo | I2 | machine | trozo 2 |
| código de salida nuevo en `EXIT` sin fila de recuperación | I2 | machine | trozo 3 |
| marca con `falta: urgencia` (fuera del vocabulario) | I2 | machine | trozo 8 |
| campo de texto con tres valores que se repiten en 20 filas | I2 | machine | trozo 16, propuesta de enum |
| pregunta marcada `base` con un motivo fuera de la lista | I2 | machine | trozo 22 |
| lección con un solo caso y sin `reason: caso-unico` | I3 | machine | trozo 5 |
| lección `signal: none` sin pregunta | I3 | machine | trozo 5 |
| viñeta nueva que pasa el presupuesto de su skill | I3 | machine | trozo 6 |
| viñeta que enlaza `lessons/<id>.json` inexistente | I3 | machine | trozo 6 |
| «no» del revisor con `reason` fuera del vocabulario | I3 | machine | trozo 7 |
| dos lecciones con el mismo `mechanism` | I3 | machine | trozo 19, `MERGE` |
| pregunta nueva C18 sin fila en `goals.json` | I3 | machine | trozo 22 |
| invariante que no sirve a ninguna meta | I3 | machine | trozo 22 |
| test nuevo en `scripts/x.check.mjs`, que `node --test` no recoge | I3 | machine | trozo 20 |
| lección cuyo mecanismo es un test que no se dispara | I3 | machine | trozo 20 |
| `package.json` con `node --test test/a.test.js` (deja fuera el resto) | I3 | machine | trozo 20 |
| comando de indicador que nadie dispara y no sale como deuda | I3 | machine | trozo 22 |
| `golden.yml` con un `schedule` o un `push` de vuelta | I3 | machine | trozo 25 |
| commit que toca `standards/code.md` después de la última pasada, sin deuda contada | I3 | machine | trozo 28 |
| decisión de PR que cita el principio 9 | I4 | machine | trozo 9 |
| decisión sin `descartó`, o igual a `eligió` | I4 | machine | trozo 9 |
| decisión con un motivo de lista cerrada que no existe | I4 | machine | trozo 9 |
| excepción a un principio sin coste | I4 | machine | trozo 9 |
| PR sin sección «Decisions» | I4 | machine | trozo 9 |
| plan sin «Decisions taken» | I4 | machine | trozo 10 |
| plan con una decisión que cita el principio 7 | I4 | machine | trozo 10 |
| `if (rondas > 3)` con el umbral escrito a mano | I2 | juez | C14; `audit` solo lo cuenta |
| lista de 4 valores escrita como `switch` en vez de tabla | I2 | juez | C14 |
| decisión que cita el principio 4 para algo que no va de sitios (cita de rutina) | I4 | juez | C15 |
| «Decisions: None» en un PR que elige una librería | I4 | juez | C15 |
| plan cuyo trozo tiene `Done: npm test` | I3 | juez | C16 (P2) |
| plan con una regla nueva sin lector | I3 | juez | C16 (P12) |
| Done que llama a la función a mano en vez de al CLI | I3 | juez | C16 (P12) y C17 |
| paso de `tests.yml` con un `if` que salta los tests en ciertos PR | I3 | juez | C13; el trozo 20 no lo ve |
| sinónimo entre idiomas (`importe` frente a `price`) en un plan | I1 | juez | C16 (P10) |
| rol duplicado con otro nombre dentro de la Fábrica | I1 | juez | C8, un solo caso hoy |
| lección con dos casos cuyo test solo cubre uno | I3 | juez | C6, un solo caso hoy |
| dos lecciones que se contradicen | I3 | juez | C8, sin caso hoy |
| marca `memoria` que en realidad era `autoridad` | I2 | ninguno | autodeclarado, nadie lo revisa |
| meta con un indicador que existe pero no mide lo que dice | I3 | ninguno | el test del trozo 22 solo ve que existe |
| lector `manual` que figura como deuda y nadie abre nunca | I3 | ninguno | se cuenta, no se fuerza (A) |
| nota en la memoria privada de un agente con una decisión | I4 | ninguno | fuera del repo |
| Pablo revisa un diff y no lo marca | I4 | ninguno | solo se ve si se marca (trozo 8) |
| umbral en una constante con nombre que debía ser fila de una tabla | I2 | ninguno | ni la regla de ESLint ni C14 lo distinguen con fiabilidad |
| defecto en main que nadie llega a ver | I5 | ninguno | la tasa de escapes es cota inferior |

Cifras esperadas: máquina 33 casos (I1 6, I2 6, I3 14, I4 7): las cuatro celdas concluyentes si se cazan. Juez: C14, C15 y C16 llegan a 5 con el trozo 24; C17, C13, C8 y C6 se quedan en 0 a 2 casos y su tasa dice «no concluyente»; cada P por separado no se mide (C16 las agrega). Ninguno: 7, dichos.

## Citing an invariant
Forma (trozos 9 y 10, un solo lector `scripts/lib/decision.mjs`): `- principio <n> | eligió: <x> | descartó: <y> | motivo: <clase> o decidido`, o `- excepción a principio <n> | motivo: <texto> | coste: <texto>`. Hoy en origin/main: la comprobación del cuerpo del PR (`tests.yml:69`) y de los planes (`tests.yml:78-84`) en cada PR, los principios numerados (`CLAUDE.md:7-12`), las cuatro clases (`standards/intervention.md:21-24`), las marcas automáticas de permiso y `!` (`npm run hitl -- --json`), los mensajes de Pablo (`scripts/lib/message-log.mjs`), las filas de `intervenciones.md`, `overrides` (`scripts/records.mjs:10`) y la varianza del juez en el corpus (`scripts/golden-run.mjs:147`). No existe: sección de decisiones en PR ni en planes, lector de citas, tipo de falta, origen `agente`, tasa de escapes, ningún `audit`, ni juez automático para las P de revisor.
- Máquina: existencia y forma (trozos 9 y 10). No sabe si la cita encaja.
- Juez: C15 en cada PR y P11 en cada plan (vía C16); al juez se le mide con 5 casos de C15 y 5 de C16 (trozo 24), y su tasa de «no» falsos en PR reales sale del trozo 17.
- Indicador de resultado (trozo 18): por semana y tipo de falta, marcas `pregunta-fuera-de-lista`, `contexto-aportado`, `correccion-de-agente` y `revision-de-diff`, mensajes de Pablo y `overrides`, antes y después de los trozos 9 y 10, con la tasa de escapes al lado; con menos de 5 por lado, «no concluyente». Si las citas son de rutina, las marcas de `conocimiento` y `memoria` no bajan aunque la forma pase.

## Lineage
Un solo sitio para de dónde viene cada trozo. v4, v5 y v6 fueron borradores de este plan, no publicados.

| v7 | v6 | Cambio |
|---|---|---|
| 11, 12 | 11, 12 | van al final; añaden su fila en `goals.json`; 12 gana el fallo de C16 en `triggers.mjs` |
| 21 | 21 | autorizado por A1; depende de 22 y 28 |
| 24 | 24 | sin bloqueo; la pasada la lanza Pablo |
| 25 | 25 | quita también el `push` |
| 28 | nuevo | deuda del juez sin pasada |

Linaje anterior:

| v6 | v5 | v4 | Cambio |
|---|---|---|---|
| 1 | 1 | 8, 9, 10 | fusión; meta e invariante, en el 22 |
| 2 | 2 | 12 | igual |
| 3 | 3 | 3 | igual |
| 4 | 4 | 13 | compara también `name` y `term` |
| 5 | 5 | 2 | `caso-unico`, `escaped` |
| 6 | 6 | 16 | presupuesto por skill, `PROSE_DUPLICATES_TEST` |
| 7 | 7 | 17 (datos) | en la raíz, no en `lessons/` |
| 8 | 8 | 7 | `falta` y `CAMINOS` |
| 9 | 9 | nuevo | lector común `decision.mjs` y `gate.mjs` |
| 10 | nuevo | nuevo | decisiones de los planes |
| 11 | 10 (P10) | 18 (P10) | más P11 y P12 |
| 12 | 10 (C14, C15) | 18 (C14) | más C16, C17 y `plan.md` en la puerta |
| 13 | 11 | 1 | `INDICATORS` |
| 14 | 12 | 5 | más la rama |
| 15 | 13 | 4, 6 | escapes |
| 16 | 14 | 14 | igual |
| 17 | 15 | 15, 17 (audit) | «no» falsos por pregunta |
| 18 | 16 | nuevo | igual |
| 19 | 17 | nuevo | `DEAD_REF`; `audit` cuenta candidatos |
| 20 | nuevo | nuevo | disparadores calculados |
| 21 | nuevo | nuevo | paso de arranque, bloqueado por A |
| 22 | nuevo | nuevo | metas como datos y deuda de lo manual |
| 23 | 18 | nuevo | casos de planes, metas y disparadores |
| 24 | 19 | 21 | más C16, 23 casos |
| 25 | 20 | 20 | igual |
| 26 | 21 | 19 | I2 al principio 4 y disparador al 5; actualiza `goals.json` |
| 27 | 22 | 22 | con «Decisions taken» |
| sobra | sobra | 11 | base de rol: hueco que `audit` cuenta |
| 28 | nuevo | nuevo | deuda del juez sin pasada (v7) |

## Decisions taken
- principio 6 | eligió: A1, quitar la pasada semanal, ampliar el corpus a 5 casos en C5, C9, C14, C15 y C16 y disparar `audit` e higiene locales al arrancar | descartó: un workflow programado, o todo a mano | motivo: Weaken a check (la medida semanal del juez se quita; lo decidió Pablo en su mensaje del 19 oct 2026, que me llega por la sesión coordinadora)
- principio 6 | eligió: ampliar el trozo 25 y quitar también el `push` de `golden.yml`, dejando solo `workflow_dispatch` | descartó: dejar la pasada al cambiar el juez | motivo: Weaken a check (decidido por Pablo el mismo día: quiere lanzarla él; lo perdido se cuenta como deuda en el trozo 28)
- principio 6 | eligió: B1, reescribir los principios 2, 4, 5 y 6 sin lista de casos | descartó: principios nuevos al final, o no tocar `CLAUDE.md` | motivo: decidido (por Pablo; toca `CLAUDE.md`, ruta cerrada)
- principio 2 | eligió: C3, homenu-panel como proyecto N+1 | descartó: un proyecto nuevo creado desde cero, o traspasar MenuPlan | motivo: decidido (por Pablo; no se crea repo ni se amplían permisos)
- principio 6 | eligió: dejar A y B en «Decisions for Pablo», marcadas como decididas, y los trozos 25 y 26 con su `Blocked by` | descartó: quitar esos `Blocked by` como pedía el encargo | motivo: decidido (`check-plan` da `CLOSED_WITHOUT_DECISION` a todo trozo con ruta cerrada sin `Blocked by`, `scripts/lib/plan.mjs:262`, y no tiene estado «decidida»)
- principio 5 | eligió: dar juez a las P de revisor con una pregunta puente C16 en `standards/code.md` | descartó: cambiar `revisor.yml` para juzgar los planes contra `standards/plan.md` | motivo: decidido (la descartada toca `.github/workflows/**`, sería una cuarta decisión, y C16 cierra el hueco hoy; su coste, el registro guarda C16 y no la P, se dice en el trozo 12)
- principio 4 | eligió: un solo lector de decisiones `scripts/lib/decision.mjs` para PR y planes | descartó: parsear en `pr-body.mjs` y otra vez en `plan.mjs` | motivo: decidido
- principio 4 | eligió: calcular el disparador de cada lector con `triggerOf` y atar la copia de los patrones de `node --test` con una ejecución real | descartó: un campo `trigger` guardado en el registro, como pedía el encargo | motivo: decidido (un disparador guardado se queda viejo cuando cambia `package.json` o un workflow; solo se guarda donde no se puede calcular, que hoy no pasa)
- principio 6 | eligió: pedir el OK de Pablo para el paso de arranque antes de construirlo (llegó con A1) | descartó: construirlo sin preguntar porque el glob de la lista cerrada no lo marca | motivo: decidido (lo que corre solo pide a Pablo según `standards/intervention.md:40`; tomarlo por la letra del glob sería un atajo; ninguna de las cuatro clases lo nombra, y es un hueco de la lista cerrada que se dice en «Doubts»)
- principio 6 | eligió: meter los disparadores periódicos en A junto al gasto del corpus | descartó: una cuarta decisión | motivo: decidido (las dos preguntan qué medidas corren solas y cuánto cuestan; el máximo es 3)
- principio 5 | eligió: `goals.json` como trozo propio después de `audit` | descartó: meterlo en el registro del trozo 1 | motivo: decidido (en el trozo 1 no existiría ningún indicador y el test no tendría qué comprobar)
- principio 4 | eligió: que «no concluyente» lo calcule `audit` | descartó: guardar el estado en `goals.json` como pedía el encargo | motivo: decidido (un estado guardado caduca: es una copia)
- principio 4 | eligió: que una meta sin indicador declare `hueco` con motivo y `audit` la liste | descartó: test que exige indicador a toda meta | motivo: decidido (las dos cosas que pedía el encargo se contradicen: si el test lo exige, `audit` nunca tendría qué listar)
- principio 2 | eligió: I5 como invariante | descartó: dejar la medida como «extra» dentro de I3 | motivo: decidido («anular a mano un no que era ruido» no lo explica ningún otro invariante)
- principio 4 | eligió: I1 con «un sitio, una cosa» | descartó: un invariante aparte de cohesión | motivo: decidido (su lector, tamaño y choques, es el de I1)
- principio 5 | eligió: no proponer ahora mayoría de pasadas ni niveles en el juez | descartó: un trozo que cambie `revisor.yml` | motivo: Weaken a check (los niveles convierten un no en aviso) y lista cerrada; primero se mide (trozos 17 y 22)

## Self-application
Lo que encontré al pasarle los invariantes a este plan, y qué hice:
- I1, copia: el v5 repetía el invariante de cada trozo en su título y en la tabla, y el linaje en cada «Not done». Ahora el invariante solo está en «Matrix» y el linaje solo en «Lineage».
- I1, copia que caduca: «Matrix» y la tabla de validación son la entrada de los trozos 22 y 23; cuando estén, la fuente es el fichero y el plan deja de valer (lo dice «Invariants»).
- I2, texto libre: la columna «Lector hoy» y la de «Detector» usan valores cerrados (`máquina`, `juez`, `juez-sin-lector`, `nadie`; `machine`, `juez`, `ninguno`); las preguntas sin meta llevan `base` y no una celda vacía.
- I3, reglas sin lector: P10 a P12 no tendrían lector sin C16, y por eso el trozo 12 va antes que nada que dependa de ellas. Este plan no tiene lector automático de sus propias P de revisor hasta el trozo 12, y se dice.
- I3, disparador: «Lo que corre en cada PR» y «lo periódico» eran la misma frase en el v5 («señales, no puertas»); ahora cada lector tiene su disparador en «Matrix», y los `manual*` se ven.
- I3, Done: con la vara nueva, 9 trozos se corrigen (4, 5, 8, 9, 10, 15, 16, 17, 18) y 4 no pueden probar su disparo en el PR (11, 12, 14, 24), con motivo en la columna «Vara».
- P7: el trozo 21 depende del 22 y del 28 aunque su número sea menor; el orden real está en «Build order».
- I4: las decisiones de este plan van en «Decisions taken» con la forma que pide el trozo 10, aunque el check de hoy no la lea.
- Ejemplos sin trozo: en «Examples not covered».

## Examples not covered
De los 40, los que ningún trozo hace cumplir:
- «Nota en memoria privada de un agente» (aprender, malo 2): fuera del repo; ninguna máquina de la Fábrica la ve.
- «Que Pablo tenga que recordar algo importante» (trabajar solos, malo 3): solo se cuenta si se marca como `memoria` (trozo 8); no se previene.
- «Reexplicar lo que quiere por pérdida de contexto» (trabajar solos, malo 1): se cuenta como `contexto-aportado`, autodeclarado; el registro (trozo 1) reduce la causa, pero no se mide si basta.
- «PR fusionado con tests y revisor verdes sin que Pablo pulse nada» (trabajar solos, bueno 3): no es un invariante sino el resultado; lo miden los trozos 15 y 18.
- «Proyecto cuyo funcionamiento solo se entiende leyendo código» (agentes, malo 5): el registro lo reduce, pero «entender» no lo comprueba nadie.
- «La auditoría mensual detecta un texto libre» (escalar, bueno 4): la detección sí (trozo 16); lo de mensual no, porque programarlo es un workflow (lista cerrada).

## Decisions for Pablo
Las dos están decididas por Pablo (mensaje del 19 oct 2026). Siguen aquí solo porque `check-plan` exige que un trozo con ruta cerrada apunte a una decisión (`CLOSED_WITHOUT_DECISION`) y no tiene estado «decidida»; la elegida es la primera.

### A. ¿Qué medidas corren solas, y cuánto se gasta en ellas? Decidida: 1, y el trozo 25 quita también el push
1. Quitar la pasada semanal del corpus, ampliar C5, C9, C14, C15 y C16 a 5 casos (23 casos) y que la parte local de `audit` y la higiene corran al abrir cada sesión, sin workflow nuevo (recommended)
2. Un workflow programado cada semana para `audit`, higiene y el corpus
3. Dejar el corpus como está y todo lo periódico a mano, contado como deuda en `audit`

### B. ¿Cómo entran los invariantes y el residuo no delegable en CLAUDE.md? Decidida: 1
1. Reescribir los principios 2, 4, 5 y 6 para que digan los invariantes (I2 en el 4, el disparador en el 5) con excepción apuntada, y que el 6 diga que lo que queda para Pablo es la intención y la autoridad, en la medida que él fije; siguen siendo 6 (recommended)
2. Añadir los invariantes y el residuo como principios nuevos al final
3. No tocar CLAUDE.md

## Doubts
- `check-plan` no sabe que una decisión ya está tomada: un trozo con ruta cerrada tiene que seguir apuntando a ella. Es un hueco de I2 (el estado de una decisión debería ser un dato) que sale al aplicar el plan; arreglarlo es otro trozo y toca `scripts/lib/plan.mjs` (GATE_FILES).
- Entre el trozo 12 y la pasada que lanza Pablo, el revisor ya aplica C14 a C17 a cada PR sin medir: por eso nada más se fusiona en esa ventana («Build order»).
- El arranque como disparador solo corre cuando alguien abre una sesión de Claude Code en la carpeta principal, no si nadie trabaja.
- Hueco de la lista cerrada: `standards/intervention.md:40` dice que lo que corre solo pide a Pablo, pero sus rutas cerradas no cubren `scripts/al-arrancar.mjs`, que corre en cada sesión. P9 no lo ve. Cerrarlo es cambiar la lista cerrada, y eso es de Pablo.
- `node --test` ejecuta también `test/fixtures/*-falso.mjs` y `test/apoyo/*.mjs` en cada `npm test`; hoy no falla nada, pero un fixture con efectos se ejecutaría.
- Cambiar cómo responde el juez (mayoría de 3 pasadas en las preguntas de juicio) costaría unas 3 veces el juez por PR y toca `.github/workflows/revisor.yml` (lista cerrada) y `scripts/veredicto.mjs`; «niveles» o «aviso» en vez de «no» es convertir un no en aviso (lista cerrada). Primero se mide la tasa de «no» falsos (trozos 17 y 24).
- La forja de skills exige al menos una viñeta en «Lo que falló» (`scripts/lib/skills.mjs:85`), lo que empuja a escribir anécdotas en una skill nueva; quitarlo es rebajar un check y se preguntará cuando el trozo 19 dé cifra.
- C16 da juez a las P, pero el registro guarda C16 y no cuál P falló.
- Llevar los trozos 2 y 4 al CI de cada proyecto, también de homenu-panel, pide un paso en `.github/workflows/tests.yml` (lista cerrada).
- Las decisiones de Pablo (A1, B1, C3, la ampliación del 25 y el residuo no delegable) me llegan por la sesión coordinadora, no de él; las filas de `intervenciones.md` de los trozos 8 y 25 lo dicen así.
- Si las sesiones lanzadas por otro agente disparan `UserPromptSubmit` y `SessionStart`: si lo hacen, inflan los mensajes por PR y el paso de arranque corre más veces de las que parece.

## Not verified
- El estado de homenu-panel: solo sé que `proyectos/homenu-panel.json` lo declara y que hay una copia local; no miré si el token del constructor puede leerlo ni en qué estado está.
- El coste de 15 dólares de una pasada con 23 casos más los 9 de hoy: cifra que me llega, no medida; el plan3 citaba unos 10 dólares para 9 casos.
- Que los cinco invariantes y la matriz cubran los 40 ejemplos y las 29 preguntas: lo comprobé leyendo cada pregunta (`grep "^### C\|^Quién"` sobre los dos estándares) contra los invariantes, a mano; la asignación de meta a cada pregunta es juicio mío, y el trozo 22 la vuelve dato con test.
- La lista exacta de patrones de `node --test` en Node 24: probé cuatro ficheros (`test/fixtures/f.mjs`, `test/sub/a.check.js`, `scripts/b.test.mjs`, `test/c.spec.ts`) y se ejecutaron los cuatro; no probé `.cjs` ni los patrones `*-test.*` y `test-*.*`.
- Que `--solo <paso>` y `--records <fichero>` se puedan añadir sin romper los usos actuales de `scripts/al-arrancar.mjs` y `scripts/audit.mjs`: diseño, no probado.
- El ruido sí/no del juez en C5, C8 y C9 y la inestabilidad de caso-07: me llega por la sesión coordinadora; no encontré la salida de esa pasada.
- Que `no-magic-numbers` de ESLint 9 corra desde `audit` con la API: no lo corrí.
- Que añadir la sección `Decisions` no rompa `test/evidence.test.js` ni `test/golden-machine.test.js`, y que `Decisions taken` no rompa los fixtures de `test/fixtures/golden/machine/`: no lo corrí; si rompen, entran en `Files` de los trozos 9 y 10.
- Que las citas de principio, el registro o la higiene cambien la conducta: hipótesis hasta que el trozo 18 tenga 5 casos por lado.
- Que la tasa de escapes por PR `fix/` refleje defectos y no cambios de idea: no medido; es cota inferior.
- Las cifras de #91 (1,475 rondas por PR, 82 check-runs sin registro): leídas por el plan3 de su cuerpo.
- Las 34 viñetas: awk sobre líneas que empiezan por «- » en la sección; una viñeta puede llevar varios fallos.
- Las cifras de MenuPlan son de su copia local (`82ee97de`), no de su remoto.
