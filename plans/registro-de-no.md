# Plan: Registro único de «no» del revisor, con clase del fallo y desenlace, que absorbe no-lesson.json

Verdict: el triaje de los «no» no se hace: `no-lesson.json` tiene 0 filas desde que nació (trozo 7, #112, 2026-10-19) aunque desde entonces ha habido «no» del revisor, porque la regla no tiene disparador (I3); este plan lo sustituye por `reviewer-no.json` (una fila por «no»: PR, pregunta, clase del fallo y desenlace) en seis trozos sin decisión pendiente, más un séptimo (que el juez automático diga la clase) que solo es propuesta y espera a Pablo (A).

Todo lo dicho sobre el repo se comprobó en `origin/main` `97e57eb` (copia con `git archive` en una carpeta aparte), salvo lo que va en «Not verified».

## Por qué un plan nuevo y no editar plans/trabajar-solos.md

`node scripts/check-plan.mjs --file plans/trabajar-solos.md` con el código de `97e57eb` -> 15 líneas `BAD_DECISION_LINE [Decisions taken line N] UNKNOWN_CLASS` (líneas 1-6 y 8-16), salida 1: sus `motivo` llevan texto entre paréntesis después de la clase y `scripts/lib/decision.mjs:29` solo acepta la clase o `decidido`. Arreglarlas obliga a reescribir el motivo de decisiones de Pablo (A1, B1, C3) y a mover ese texto a otro sitio, en un plan que otras sesiones están construyendo (trozos 16 a 28 pendientes). Este plan no lo edita: la sección «Ajustes a plans/trabajar-solos.md» dice qué cambia en sus trozos 7, 17, 19, 21 y 23 y en dos de sus «Doubts»; quien construya esos trozos lee los dos planes. Es el mismo camino que `plans/menuplan-separation.md` (#118), que es el trozo 27 de ese plan y vive aparte.

## Lo que hay hoy (comprobado)

- `no-lesson.json` tiene `entries: []` (`git show origin/main:no-lesson.json`, leído con node -> `entries: 0`).
- Su esquema y su lector viven dentro de `scripts/lib/lessons.mjs:184-251` (`NO_LESSON_FILE`, `NO_LESSON_KEYS`, `NO_LESSON_FIELDS`, `NO_LESSON_REASONS`, `NO_LESSON_FAULTS` con 9 códigos, `readNoLesson`, `noLessonFaults`); el fichero tiene 251 líneas (`wc -l`).
- Quién depende de él: `git grep -n -E "no-lesson|NO_LESSON|noLesson|readNoLesson" origin/main` ->
  - `scripts/lib/fields.mjs:11` y `:66` (`FIELD_SOURCES['no-lesson']`),
  - `test/fields.test.js:9`, `:31-40` (lista exacta de fuentes, incluido `no-lesson`),
  - `test/lessons.test.js:198-329` (mutaciones por código, formas válidas, fichero real verde, fichero ausente lanza),
  - `fields.json:13-17` (5 campos de dueño `no-lesson`),
  - `entities.json:18-23` (entidad `no-lesson`, sin forja propia para no duplicar `OWN_FORGE`),
  - y texto de `plans/trabajar-solos.md` (trozos 7 y 17, «Doubts» 641-642).
- `audit` no lo lee: `git grep -n -E "no-lesson|NO_LESSON|noLesson" origin/main -- scripts/audit.mjs scripts/lib/audit-data.mjs test/audit.test.js test/audit-data.test.js` -> sin salida (código 1).
- Nadie dice que hay que rellenarlo: `git grep -n -i -E "no-lesson|triar|triaje" origin/main -- .claude` -> sin salida (código 1).
- El meta-test `test/golden-machine.test.js:126` exige que cada código de cada `*_FAULTS` exportado en `scripts/lib` salga en otro fichero de test; busca el nombre con `\b`, así que un código con el mismo nombre en dos listas lo cubriría el caso malo de la otra: los códigos nuevos llevan prefijo propio.
- El juez automático solo emite, por PR y ronda, un registro con `answers: {<id>: sí|no|no aplica}` sin motivo (`scripts/lib/record.mjs:31-51`); `git grep -n -i -E "kind|clase|motivo" origin/main -- .github/workflows/revisor.yml scripts/lib/record.mjs` -> sin salida (código 1).
- El arranque ya habla con GitHub una vez por sesión (`scripts/clean.mjs:3`, «una sola consulta REST por pasada», por `scripts/token.mjs`).

## El registro

`reviewer-no.json` en la raíz (no en `lessons/`, que `readLessons` lee entero como lecciones, `scripts/lib/lessons.mjs:96-100`): `{ "$comment", "version": 1, "rows": [...] }`. Una fila por «no»: suceso, no regla. La regla que resume muchos sucesos es la lección; la fila apunta a ella por id y no copia ninguno de sus campos (I1).

| Campo | Valores | Regla |
|---|---|---|
| `source` | `#<n>` del PR (`PR_SOURCE`, `scripts/lib/lessons.mjs:57`) | obligatorio |
| `question` | id de pregunta de `standards/code.md` o `standards/plan.md` (`lessonContext`), nunca `none` | obligatorio |
| `kind` | `afirmacion-sin-prueba`, `vocabulario-copiado`, `cuerpo-de-otro-pr`, `falta-de-rojo-antes`, `error-tragado`, `forma-del-cuerpo`, `otro` | obligatorio |
| `kind_note` | texto no vacío | exactamente cuando `kind` es `otro` |
| `outcome` | id de una lección de `lessons/`, o `pendiente`, `ruido-del-juez`, `caso-unico`, `otro` | obligatorio |
| `outcome_note` | texto no vacío | exactamente cuando `outcome` es `otro` |

Clave de fila: (`source`, `question`, `kind`); dos filas iguales son un fallo. Un mismo PR puede tener dos filas de la misma pregunta si son dos clases de fallo distintas.

`kind` es vocabulario medido, no inventado: sale de los 11 «no» de la sesión que encargó este plan (afirmacion-sin-prueba 5, vocabulario-copiado 2, y 1 de cada uno de los otros cuatro; cifras de esa sesión, que el trozo 4 vuelve a medir sobre los check-runs reales). `otro` + nota es la válvula (I2): un valor nuevo entra por PR cuando dos o más filas `otro` cuentan la misma clase (el trozo 6 las lista); un valor con 0 filas tras el trozo 4 se apunta como duda en ese PR.

`outcome` absorbe los dos campos de `no-lesson.json` que decían lo mismo de dos formas: `reason: ya-cubierta` + `reason_ref: <id>` pasa a ser `outcome: <id>`. Si la fila creó la lección o ya existía no se guarda: se calcula (el PR está o no en `sources` de la lección), y eso da gratis las recaídas que mide el trozo 17 de `trabajar-solos`. `pendiente` es explícito y no un campo ausente (lección `absent-field-read-as-default`): es la deuda que se ve.

## Chunks

### 1. Registro `reviewer-no.json` y su lector único, que absorbe `no-lesson.json` sin rebajar ningún check
Files: `reviewer-no.json`, `no-lesson.json`, `scripts/lib/reviewer-no.mjs`, `test/reviewer-no.test.js`, `scripts/lib/lessons.mjs`, `test/lessons.test.js`, `scripts/lib/fields.mjs`, `test/fields.test.js`, `fields.json`, `entities.json`
Depends on: #119
Blocked by: none
Existing: `git grep -n -E "reviewer-no|REVIEWER_NO|outcome|kind_note" origin/main` -> sin salida (código 1). Lo que se migra es la lista de «Lo que hay hoy» (`git grep -n -E "no-lesson|NO_LESSON|noLesson|readNoLesson" origin/main`).
Not done: `scripts/lib/reviewer-no.mjs` exporta `REVIEWER_NO_FILE`, `REVIEWER_NO_KEYS`, `REVIEWER_NO_FIELDS`, `KINDS` de fallo, `OUTCOME_REASONS`, `REVIEWER_NO_FAULTS`, `readReviewerNo` (lanza si falta el fichero) y `reviewerNoFaults(text, ctx, lessonIds)`. Códigos, todos con prefijo `REVIEWER_NO_` y un caso malo cada uno en `test/reviewer-no.test.js`: `NOT_JSON`, `BAD_FILE`, `BAD_FIELDS`, `BAD_SOURCE`, `UNKNOWN_QUESTION`, `BAD_KIND`, `KIND_NOTE_MISMATCH`, `BAD_OUTCOME`, `OUTCOME_NOTE_MISMATCH`, `DUPLICATE_ROW`, `OUTCOME_AMBIGUOUS` (una lección cuyo id coincide con un valor cerrado de `outcome`). C13, código a código: `NO_LESSON_NOT_JSON`, `_BAD_FILE`, `_BAD_FIELDS`, `_BAD_SOURCE`, `_UNKNOWN_QUESTION` y `_NOTE_MISMATCH` pasan a su par con el mismo caso malo; `_BAD_REASON` y `_UNKNOWN_LESSON` pasan a `BAD_OUTCOME` (un valor que no es ni motivo cerrado ni lección presente); `_REF_MISMATCH` desaparece con su campo, y lo que garantizaba (un «no» cubierto nombra una lección que existe) lo sigue garantizando `BAD_OUTCOME`. Se conservan los tests de clase: cada código tiene fila de mutación y cada fila nombra un código real, las formas válidas cubren todos los valores de `OUTCOME_REASONS` y todos los campos, el fichero escrito a mano en el formato de disco se acepta, el fichero real está verde contra las lecciones reales y fuera de `lessons/`, y el fichero ausente lanza. `scripts/lib/lessons.mjs` pierde las líneas 184-251 y exporta los ayudantes `keysFault` y `noteFault` que el lector nuevo reutiliza (no se copian). `FIELD_SOURCES` cambia `no-lesson` por `reviewer-no`; `fields.json` quita los 5 campos de `no-lesson` y declara los 6 nuevos (`question` reutiliza `lesson.question`; `kind`, `outcome` y `source` nuevos con su motivo; las dos notas `texto` con motivo `otro`). `entities.json` cambia la entidad `no-lesson` por `reviewer-no` con forja propia `scripts/lib/reviewer-no.mjs`: deja de compartir forja con `lesson`, así que desaparece el motivo por el que el trozo 7 la dejó sin forja. Se borra `no-lesson.json` (0 filas; se recupera de git). No rellena filas (trozo 4), no calcula la deuda (trozo 3) ni toca `audit` (trozo 6). Ningún fichero es de la puerta (`GATE_FILES`, `scripts/lib/gate.mjs:14-50`); si rompe main, se revierte el PR desde una rama nueva.
Done:
```sh
node --test test/reviewer-no.test.js test/lessons.test.js test/fields.test.js test/entities.test.js test/golden-machine.test.js && test ! -e no-lesson.json
```

### 2. El constructor apunta una fila por cada «no» al arreglarlo, y el desenlace lo pone otra sesión
Files: `.claude/agents/constructor.md`, `test/principles-and-roles.test.js`
Depends on: 1
Blocked by: none
Existing: `.claude/agents/constructor.md:15` dice «Si el revisor dice no, arregla en la misma rama; no discutas el veredicto» y nada más; `git grep -n -i -E "no-lesson|triar|triaje" origin/main -- .claude` -> sin salida (código 1).
Not done: el paso 6 añade: por cada pregunta con «no», una fila en el registro (lo nombra por `REVIEWER_NO_FILE` y la forma por `REVIEWER_NO_FIELDS`, sin copiar valores) en el mismo commit del arreglo, con `kind` y `outcome: pendiente`; el desenlace final (lección, `ruido-del-juez`, `caso-unico`, `otro`) lo pone otra sesión que no hizo ese PR, porque decir «era ruido del juez» sobre tu propio PR es juzgar tu propio trabajo. Cuando hay dos «no» seguidos y se lanza un revisor independiente para sacar el motivo, ese revisor no escribe ficheros (`.claude/agents/revisor.md`, cabecera sin `Edit` ni `Write`, comprobado por `test/principles-and-roles.test.js:32-38`): dice la clase en su informe y el constructor la apunta. No toca `.claude/agents/revisor.md` (`GATE_FILES`) ni el juez automático (trozo 7). El test nuevo comprueba que `constructor.md` nombra el fichero del registro tomando el nombre de `REVIEWER_NO_FILE`; quitar la instrucción lo pone en rojo. Que la fila la escriba de verdad no lo ve ninguna máquina en el PR: lo ve la deuda del trozo 5 al arrancar.
Done:
```sh
node --test test/principles-and-roles.test.js
```

### 3. Deuda calculada: «no» de PR fusionados sin fila, filas `pendiente` y filas sin «no» que las respalde
Files: `scripts/lib/reviewer-no.mjs`, `test/reviewer-no.test.js`, `scripts/reviewer-no.mjs`, `test/reviewer-no-cli.test.js`, `test/fixtures/reviewer-no/records.json`, `scripts/lib/exit.mjs`, `scripts/lib/exit-codes.json`
Depends on: 1
Blocked by: none
Existing: `git grep -n -i -E "debt|deuda|sin triar" origin/main -- scripts` -> sin salida (código 1). Lo que se reutiliza: `readCheckRuns` (`scripts/lib/record.mjs:100`, que no lanza y devuelve aparte los ilegibles), `readPulls` (`scripts/lib/audit-data.mjs:32`), `collect` (`scripts/collect-records.mjs:52`) y el formato `{pulls, checkRuns}` de `test/fixtures/audit/records.json`.
Not done: `reviewerNoDebt({pulls, checkRuns}, rows, since)` es pura: de los registros del juez saca los pares (PR, pregunta) con respuesta `no` de PR fusionados con `merged_at` desde `DEBT_SINCE`, y devuelve `missing` (par sin ninguna fila), `pending` (filas `pendiente`) y `unmatched` (fila cuyo par no es un «no» en los registros: fila inventada o PR equivocado). Un check-run ilegible para la cifra con error, como `rounds` (`scripts/lib/audit-data.mjs:83-85`); nunca se cuenta alrededor. `DEBT_SINCE` es `2026-10-19`, el día que se fusionó #112 y empezó la regla de triar: lo anterior no se cuenta como deuda y se dice en la salida. CLI `node scripts/reviewer-no.mjs --debt (--records <f> | --repo <owner/name>) [--json]`, con `runCommand`; `--repo` baja con `collect` sin `--since` (que filtra por fecha de creación y perdería PR creados antes y fusionados después) y es solo para uso a mano. Un registro con fallos sale con un código nuevo `REVIEWER_NO_FAULTS` y su fila de recuperación («arregla el fichero y vuelve a correrlo»), generado con `npm run contract`; los demás errores usan `USAGE` y `GH_FAILED`. No añade script a `package.json` (`GATE_FILES`). No corre solo (trozo 5) ni lo cuenta `audit` (trozo 6).
Done:
```sh
node --test test/reviewer-no.test.js test/reviewer-no-cli.test.js test/contrato.test.js && node scripts/reviewer-no.mjs --debt --records test/fixtures/reviewer-no/records.json --json
```

### 4. Primeras filas: los «no» de PR fusionados desde `DEBT_SINCE`, medidos sobre los check-runs reales
Files: `reviewer-no.json`
Depends on: 2, 3
Blocked by: none
Existing: el registro nace vacío en el trozo 1 (como `no-lesson.json`, 0 filas); `node scripts/reviewer-no.mjs --debt --repo factory-am89/fabrica --json` es la lista de lo que falta (trozo 3).
Not done: una fila por cada par de `missing`; `kind` se decide leyendo el texto de hallazgos de cada check-run (`output.text`), no de memoria, y el PR pega la tabla de recuento por `kind` frente a la cifra de la sesión (5, 2, 1, 1, 1, 1): si no coincide, gana la medida y se dice. `outcome` es una lección solo si el PR está en sus `sources` o la lección cubre esa clase; si no se sabe, `pendiente`. Este PR lo hace una sesión que no construyó esos PR (trozo 2). No cambia el vocabulario de `kind` ni de `outcome` (un valor con 0 filas o dos `otro` de la misma clase se apuntan como duda del PR, y el cambio va en otro). La Done necesita red y el token del constructor.
Done:
```sh
node scripts/reviewer-no.mjs --debt --repo factory-am89/fabrica --json | node -e "let s='';process.stdin.on('data',(d)=>{s+=d}).on('end',()=>{const r=JSON.parse(s);process.exit(r.ok&&r.missing.length===0&&r.unmatched.length===0?0:1)})"
```

### 5. Paso de arranque `no-sin-triar`: la deuda de «no» sale en cada sesión, con una bajada de GitHub acotada
Files: `scripts/al-arrancar.mjs`, `test/al-arrancar.test.js`, `scripts/reviewer-no.mjs`, `test/reviewer-no-cli.test.js`, `scripts/collect-records.mjs`, `test/collect-records.test.js`
Depends on: 3
Blocked by: none
Existing: `PASOS` (`scripts/al-arrancar.mjs:23`) es `al-dia`, `limpiar`, `sesiones`, `hora`, y `test/al-arrancar.test.js:61` lo fija; `git grep -n -i -E "reviewer-no|sin-triar" origin/main -- scripts/al-arrancar.mjs` -> sin salida (código 1). `collect` baja todos los PR que lista, sin filtro por número (`scripts/collect-records.mjs:52-75`; `git grep -n -E "only|skip" origin/main -- scripts/collect-records.mjs` -> solo las líneas 1-2 del comentario).
Not done: `collect` acepta un predicado opcional que salta PR ya vistos (por defecto no salta ninguno: `audit --repo` no cambia, y su test lo fija). El paso guarda en `~/.fabrica/reviewer-no-vistos.json` (ruta con la forma `rutaDe...(casa = homedir)` de `scripts/lib/gh-log.mjs:14`) los pares «no» de cada PR fusionado ya bajado: un PR fusionado no recibe más rondas del juez, así que se baja una vez; un fichero roto lanza y sale como fallo del paso, nunca como «sin deuda». Cada sesión: una consulta de la lista de PR más las de los PR fusionados nuevos. Imprime el número de `missing`, `pending` y `unmatched` con los PR, o «sin deuda»; un fallo de red o de token sale en el titular del paso y no frena los demás (`scripts/al-arrancar.mjs:2`). Va como trozo propio y no dentro del trozo 21 de `trabajar-solos`: aquel espera a sus trozos 20, 22 y 28 (la ola 17 de 20), es solo local por la decisión A1 y su idea es otra (la parte local de `audit` e higiene); meter aquí la red lo haría dos ideas. No toca `.claude/settings.json` ni `.claude/hooks/**` (lista cerrada): el paso entra por `PASOS`. Si rompe el arranque, se revierte el PR.
Done:
```sh
node --test test/al-arrancar.test.js test/reviewer-no-cli.test.js test/collect-records.test.js
```

### 6. `audit`: «no» por clase de fallo, por desenlace y por pregunta, y recaídas por lección
Files: `scripts/lib/reviewer-no.mjs`, `test/reviewer-no.test.js`, `scripts/audit.mjs`, `test/audit.test.js`, `entities.json`
Depends on: 3
Blocked by: none
Existing: `INDICATORS` (`scripts/audit.mjs:23-35`) no tiene nada por clase de fallo; `git grep -n -i -E "kind|clase" origin/main -- scripts/audit.mjs scripts/lib/audit-data.mjs` -> sin salida (código 1). `no-per-question` (`scripts/lib/audit-data.mjs:118`) cuenta «no» por pregunta desde los check-runs, sin clase.
Not done: indicador local `no-per-kind` (sin red: el registro es un fichero del repo): filas por `kind`, por `outcome` (lección nueva, lección que ya existía, cada motivo cerrado, `pendiente`), la tabla `kind` x `question`, las notas de las filas `otro` (fuente de un valor nuevo de `kind`) y las recaídas: filas cuyo `outcome` es una lección que no tiene ese PR en `sources`. La cuenta vive en `scripts/lib/reviewer-no.mjs` y `audit` solo la llama (`scripts/audit.mjs` ya tiene 197 líneas, `wc -l`). La entidad `reviewer-no` gana `scripts/audit.mjs` como lector. Sin umbral que falle: es señal. «No» falsos por pregunta, efecto de lección antes y después y la lista de «no» sin fila son del trozo 17 de `trabajar-solos`, que lee esto y la deuda del trozo 3 (ver «Ajustes»).
Done:
```sh
node --test test/reviewer-no.test.js test/audit.test.js && node scripts/audit.mjs --json
```

### 7. Propuesta: el juez automático dice la clase de cada «no» y la fila sale sola
Files: `.github/workflows/revisor.yml`, `scripts/veredicto.mjs`, `scripts/lib/record.mjs`, `test/verdict.test.js`, `test/record.test.js`
Depends on: 4, 6
Blocked by: A
Existing: el registro del juez guarda solo `answers` por id (`scripts/lib/record.mjs:31-51`, `RECORD_VERSION = 1` en la línea 7); `git grep -n -i -E "kind|clase|motivo" origin/main -- .github/workflows/revisor.yml scripts/lib/record.mjs` -> sin salida (código 1).
Not done: solo si Pablo elige la opción 2 de A. El prompt de `revisor.yml` pide, por cada «no», un valor de `KINDS`; `veredicto.mjs` lo lee y el registro pasa a la versión 2 con la clase al lado de la respuesta; el veredicto (sí o no) no cambia. Así `scripts/lib/reviewer-no.mjs` pasaría a ser de la puerta (lo importaría `veredicto.mjs`), y `revisor.yml` lo usan también los otros repos. Tras fusionarlo hay que lanzar el corpus (deuda del juez, trozo 28 de `trabajar-solos`). Si llega a construirse, el arquitecto lo parte antes (juez y registro por un lado, workflow por otro) para que quepa en una revisión. Si rompe, se revierte el PR desde una rama nueva.
Done:
```sh
node --test test/verdict.test.js test/record.test.js test/revisor-workflow.test.js
```

## Build order
Ola 1: trozo 1. Ola 2: trozos 2 y 3 (no comparten fichero). Ola 3: trozos 4, 5 y 6 (no comparten fichero entre ellos). El 7 queda parado por A.

`check-plan` solo ve choques dentro de este plan. Fuera de él: los trozos 16, 17, 18, 19, 22 y 28 de `trabajar-solos` tocan `scripts/audit.mjs` y `test/audit.test.js` como el 6; el 28 toca `scripts/collect-records.mjs` y `test/collect-records.test.js` como el 5; el 21 toca `scripts/al-arrancar.mjs` como el 5. Ninguno de esos se construye a la vez que su par de aquí: quien empiece mira antes `npm run sesiones` y los PR abiertos.

## Ajustes a plans/trabajar-solos.md (sin editarlo)
- Trozo 7: su `no-lesson.json` lo sustituye el trozo 1 de este plan; su texto queda como historia.
- Trozo 17: «Lista los «no» sin entrada en lección ni en `no-lesson.json`» pasa a ser importar `reviewerNoDebt` (trozo 3 de aquí), sin recalcularlo; el `ruido-del-juez` de la tasa de «no» falsos se lee de `outcome` en `reviewer-no.json`; las recaídas por lección las da el trozo 6 de aquí. Depende además de los trozos 3 y 6 de este plan.
- Trozo 19: `MERGE` agrupa por `question`, no por `class` (campo de la v1 que ya no existe: `FIELDS`, `scripts/lib/lessons.mjs:39`); `RETIRE_TEXT` y `REWORK` leen las recaídas del trozo 6 de aquí además del % de «no» por pregunta.
- Trozo 21: su paso `periodico` no repite la deuda de «no»; ya la da el paso `no-sin-triar` (trozo 5 de aquí).
- Trozo 23 y «Abstraction validation»: el caso «"no" del revisor con `reason` fuera del vocabulario» lo caza ahora `REVIEWER_NO_BAD_OUTCOME` (y `REVIEWER_NO_BAD_KIND` para la clase).
- «Doubts» de `plans/trabajar-solos.md:641` (forja compartida que `adopted` cuenta dos veces) y `:642` (`reason` repetido entre `lesson` y `no-lesson`): las dos desaparecen con el trozo 1, porque la entidad tiene forja propia y ya no hay campo `reason` en el registro.

## Decisions taken
- principio 4 | eligió: un plan nuevo plans/registro-de-no.md que dice qué cambia en los trozos 7, 17, 19, 21 y 23 de trabajar-solos | descartó: corregir las 15 líneas de Decisions taken de trabajar-solos para poder editarlo | motivo: decidido
- principio 4 | eligió: outcome con el id de la lección también cuando la lección ya existía | descartó: conservar ya-cubierta con un campo de referencia aparte | motivo: decidido
- principio 4 | eligió: un módulo propio scripts/lib/reviewer-no.mjs con forja propia en entities.json | descartó: seguir dentro de scripts/lib/lessons.mjs | motivo: decidido
- principio 3 | eligió: outcome pendiente como valor explícito | descartó: permitir filas sin outcome | motivo: decidido
- principio 2 | eligió: DEBT_SINCE 2026-10-19, el día de #112 | descartó: contar como deuda todos los PR desde el principio | motivo: decidido
- principio 6 | eligió: que el desenlace final lo ponga una sesión que no hizo el PR | descartó: que lo ponga el constructor del mismo PR | motivo: decidido
- principio 5 | eligió: un paso de arranque propio que baja de GitHub con caché | descartó: ampliar el trozo 21 de trabajar-solos, que es solo local y llega en la ola 17 | motivo: decidido
- principio 6 | eligió: construir el paso de arranque sin preguntar a Pablo | descartó: pedirle permiso como se hizo con A1 | motivo: decidido
- principio 5 | eligió: códigos con prefijo REVIEWER_NO_ | descartó: reutilizar nombres cortos como NOT_JSON | motivo: decidido

## Por qué de cada decisión
En el orden de «Decisions taken»: (1) arreglar las 15 líneas reescribe motivos de decisiones de Pablo en un plan que se está construyendo; (2) si la fila creó la lección se calcula con `sources`, y guardarlo sería una copia; (3) `scripts/lib/lessons.mjs` tiene 251 líneas y la forja compartida era la causa de la duda 641; (4) un campo ausente leído como valor es la lección `absent-field-read-as-default`; (5) antes de #112 no había regla de triar y toda la historia enterraría la deuda de hoy; (6) «Prohibido: juzgar tu propio trabajo» (`CLAUDE.md`); (7) ver Not done del trozo 5; (8) ver «Doubts»; (9) el meta-test busca el nombre del código con `\b` (`test/golden-machine.test.js:126-136`).

## Decisions for Pablo

### A. ¿Debe el juez automático decir también la clase de cada «no» que pone?
Por qué te lo pregunto: toca `.github/workflows/revisor.yml`, que está en la lista cerrada, y cambia lo que el juez escribe en cada PR de todos los repos.
1. Todavía no: la clase la apunta el constructor al arreglar, el arranque avisa de lo que falte, y se vuelve a preguntar cuando haya unas semanas de filas con las que comparar lo que diría el juez (recommended)
2. Sí, ya: el juez dice la clase de cada «no» y la fila sale sola; cuesta cambiar el juez, lanzar el corpus otra vez, y su clasificación sería una hipótesis sin medir
3. Nunca: la clase siempre la pone una persona o un agente al triar

## Doubts
- El paso de arranque corre solo y lee GitHub. No está en la lista cerrada (`standards/intervention.md`: cuatro clases y cinco rutas; `scripts/al-arrancar.mjs` no es ninguna), y por eso lo decido. Pero `plans/trabajar-solos.md` pidió a Pablo el OK para su paso de arranque (A1) leyendo «Only what runs by itself ... needs Pablo first» (`standards/intervention.md:40`) más allá del glob, y apuntó ese hueco de la lista cerrada. Este paso no amplía permisos ni secretos (misma puerta `token.mjs` e identidad que `limpiar`, que ya consulta GitHub en cada arranque); si Pablo quiere que todo lo que corre solo pase por él, el trozo 5 se para y esta línea se vuelve una decisión.
- Que el constructor apunte la fila en el mismo commit del arreglo depende de que lea su rol; ninguna máquina lo comprueba en el PR. Lo cierra la deuda al arrancar, un día tarde como mucho.
- `plans/trabajar-solos.md` falla `check-plan` (15 `BAD_DECISION_LINE`) y fallará la próxima vez que alguien lo edite; arreglarlo pide decidir qué se hace con el texto de los motivos de Pablo. Es otro PR, no de este plan.
- Que el desenlace lo ponga «otra sesión» no lo comprueba nadie: ni el registro ni los PR guardan qué sesión escribió cada fila.

## Not verified
- Los 11 «no» de la sesión que encargó este plan y su reparto por clase (5, 2, 1, 1, 1, 1): me llegan por esa sesión; no bajé los check-runs (pide el token del constructor) y no sé de qué PR son. Lo mide el trozo 4.
- Cuántas consultas a GitHub hace el paso de arranque por sesión: diseño (una por página de la lista de PR más 2 + commits por PR nuevo fusionado), no medido.
- Que `test/adopted.test.js` y sus fixtures no cuenten la forja nueva `scripts/lib/reviewer-no.mjs` como fallo, y que ningún test fije el número de entidades de `entities.json`: no corrí la suite; si rompe, entra en `Files` del trozo 1.
- Que `test/revisor-workflow.test.js` sea el test que fija el prompt de `revisor.yml` (trozo 7): solo leí su nombre.
- Que exportar `keysFault` y `noteFault` de `scripts/lib/lessons.mjs` no salga como duplicación en el indicador `test-duplication` de `audit`: no lo corrí.
- `check-plan` lo corrí sobre este texto con el código de `origin/main` `97e57eb`; el revisor no lo ha juzgado.
