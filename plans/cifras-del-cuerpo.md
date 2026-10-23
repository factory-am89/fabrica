# Plan: Cifras sin comando en el cuerpo del PR (check de máquina) y una fila por ronda en reviewer-no.json

Verdict: se puede construir sin preguntar a Pablo (ningún trozo toca una ruta de la lista cerrada ni el ruleset): cinco trozos en tres olas de como mucho dos constructores; el check de cifras solo se enchufa (trozo 2) si la medida del trozo 1 cumple el listón fijado aquí, y lo honesto es esperar que cace 2 o 3 de los 4 «no» seguros, no los 4.

Todo lo dicho sobre el repo se comprobó en `main` `ad5de15`, salvo lo que va en «Not verified».

## Lo que hay hoy (comprobado)

- El check del cuerpo existe y ya tiene disparador: el paso «PR body has the template sections» de `.github/workflows/tests.yml:64-75` corre `scripts/pr-body.mjs` en cada `pull_request` (también `edited`, `tests.yml:21-23`). Las reglas viven en `prBodyFaults` (`scripts/lib/pr-body.mjs:61-86`): secciones, bloque de código cerrado en Evidence, `HEAD <sha>` y líneas de Decisions. Ninguna mira cifras: `git grep -n -i -E "pr-figures|unbacked|cifra-sin-comando|FIGURE_" -- scripts test standards` -> sin salida (código 1).
- `tests.yml` corre en `pull_request`, así que en este repo usa el `pr-body.mjs` de la rama del PR (`scripts/lib/gate.mjs:12-13`): un PR que arregla el check se juzga con su propio arreglo.
- `scripts/pr-body.mjs`, `scripts/lib/pr-body.mjs` y `scripts/lib/decision.mjs` son de la puerta (`scripts/lib/gate.mjs:29-31`); `test/gate-files.test.js` deriva la lista de los imports relativos, así que un módulo nuevo importado por `pr-body.mjs` entra en `GATE_FILES`.
- `parseSections` no se exporta (`git grep -n parseSections -- scripts test` -> solo `scripts/lib/pr-body.mjs:34` y `:63`).
- La plantilla `.github/pull_request_template.md` sale de `SECTIONS` (`scripts/lib/pr-body.mjs:4-10`).
- Registro: `reviewer-no.json` tiene `version: 1` y 26 filas (leído con node); la clave de fila es (`source`, `question`, `kind`) (`scripts/lib/reviewer-no.mjs:87-89`), así que dos rondas «no» de la misma pregunta con la misma clase dan `REVIEWER_NO_DUPLICATE_ROW`. Prueba: la segunda fila C9 de #143 es `kind: otro` con la nota «la clave (PR, pregunta, kind) no admite repetirla».
- `#142` no tiene ninguna fila (lista de `source` de las 26 filas, leída con node).
- El registro del juez ya trae la ronda: cada registro tiene `run: {id, attempt}` (`scripts/lib/record.mjs:49`) desde #45 (2026-10-16, `git log -S"isPosInt(r.run.id)"`). En la copia de registros del 21 oct (`rec.json` del scratchpad de la sesión que encarga, PR hasta #138), leída con `readCheckRuns`: 138 registros, 0 con `run` nulo, 0 con `attempt` mayor que 1, 0 `run.id` repetidos; en PR fusionados desde `DEBT_SINCE` hay 31 «no» por ronda frente a 21 pares (PR, pregunta).
- Lectores del registro (`git grep -n -E "reviewerNoRows|REVIEWER_NO_KEYS|reviewerNoDebt|noPerKind|readReviewerNo"`): `scripts/audit.mjs:114` (`noPerKind`), `scripts/reviewer-no.mjs:68` (`reviewerNoDebt`), `scripts/lib/lesson-effect.mjs:26-29` (`readTriagedNo`), `scripts/lib/free-values.mjs:32` (solo las notas), y los tests `test/reviewer-no.test.js`, `test/reviewer-no-cli.test.js`, `test/lesson-effect.test.js`, `test/free-values.test.js`, `test/audit-no-per-kind.test.js`, `test/apoyo/audit-raiz.mjs`.
- La deuda se calcula por par: `noPairs` y `covered` usan `pairKey(pr, question)` (`scripts/lib/reviewer-no.mjs:144` y `:178-188`). `falseNo` (`scripts/lib/lesson-effect.mjs:115-129`) cuenta los «no» por ronda (`aggregate`) pero el ruido por fila: hoy mezcla dos unidades.
- Nada corre la deuda solo: `git grep -n -i "reviewerNoDebt\|reviewer-no\|sin-triar" -- scripts/al-arrancar.mjs` -> sin salida; `PASOS` (`scripts/al-arrancar.mjs:28`) no tiene el paso `no-sin-triar` del trozo 5 de `plans/registro-de-no.md`.

## Los «no» medidos

Fuente: los logs del juez en el scratchpad de la sesión que encarga; el nombre de cada fichero es el `run.id` del juez (comprobado: 39373379503, 39374124069 y 39375106702 son las tres rondas de #117 en `rec.json`).

| Ronda | Pregunta | Dónde está la cifra | ¿La ve un check del cuerpo? |
|---|---|---|---|
| #117 r1 (39373379503) | C9 | «Not verified»: «`scripts/audit.mjs` itself is over 200 lines» (eran 178) | solo si se mira «Not verified» |
| #143 r3 (39792269026) | C9 | cuerpo: «22 to 6 pending» | sí |
| #143 r4 (39800431474) | C9 | dato: `lessons/vocabulary-retyped-not-imported.json:20`, «87 cadenas hoy» | no: está en un fichero del diff |
| #144 (39622399143) | C9 | cuerpo: «los 2.4-2.6 GiB libres que el PC suele tener» | sí |

Los dos dudosos: el recuento del título de #143 (39631900243; `pr-body.mjs` no recibe el título) e identificadores copiados (#116, run ids en `subir.md`, dentro del diff). Techo del check del cuerpo: 3 de 4 seguros con «Not verified», 2 de 4 sin él; 0 de los 2 dudosos. Los otros 4 «no» (contradicción interna, causa deducida, cuerpo de otro PR, cobertura de test afirmada) no los caza.

## El check de cifras

Lector único `scripts/lib/pr-figures.mjs`, función pura sobre el texto de una sección:
- Cifra: un número en prosa (fuera de bloques de código y de código en línea) que no sea `#<n>`, un sha, una fecha, una hora, un id de pregunta (`C9`, `P3`), «principio <n>», el número de un punto de lista ni parte de una ruta; más las palabras de hábito de una lista cerrada `HABITUAL` (hoy, today, suele, usually, currently, actualmente).
- Respaldada si: en la misma línea hay código en línea que empieza por una orden de la lista cerrada `COMMAND_HEADS` (node, npm, npx, git, gh, grep, rg, wc, ls, test, curl, jq), o el párrafo está pegado (antes o después) a un bloque de código cerrado y no vacío, o la línea lleva una marca de la lista cerrada `UNMEASURED_MARKS` (sin medir, no medido, no comprobado, not measured, not verified, inferido, inferred). La marca es la válvula y es lo que pide C9: lo no comprobado se dice.
- Secciones: What changes y Evidence; «Not verified» solo si la medida del trozo 1 lo permite.
- Listón para enchufarlo (trozo 2), fijado antes de medir: caza al menos 2 de los 3 seguros que están en el cuerpo y marca como mucho 2 de los 20 últimos PR fusionados (sus cuerpos finales, que el juez aceptó). Con «Not verified» si sigue dentro del listón; si no, sin él.
- Coste declarado: cada cifra del cuerpo lleva su orden, su bloque o su marca; un falso positivo cuesta editar el cuerpo (el evento `edited` vuelve a correr `tests`, el job entero); una vez dentro, aflojarlo es «debilitar un check» y pasa por Pablo (`standards/intervention.md`, «Classes»). El tiempo de máquina es una expresión regular sobre unas decenas de líneas.

## El registro por ronda

Campo nuevo `run`: el `run.id` del registro del juez de esa ronda (entero positivo). Clave de fila: (`source`, `run`, `question`, `kind`). `version` pasa a 2 y `run` es obligatorio (sin filas viejas sin ronda: un campo ausente leído como valor es la lección `absent-field-read-as-default`).
- Deuda (`reviewerNoDebt`): los «no» se cuentan por (PR, run, pregunta); `missing` y `unmatched` usan esa terna (una fila con un `run` que no es una ronda «no» de esa pregunta sale en `unmatched`). La salida humana y `--json` llevan el `run`.
- `audit no-per-kind` (`noPerKind`): el código no cambia; las cifras pasan de filas por par a filas por ronda (con la copia del 21 oct, 21 pares frente a 31 rondas en el tramo de la deuda). Una recaída cuenta una vez por ronda.
- `lesson-effect`: `readTriagedNo` no cambia; `falseNo` pasa a contar el ruido por ronda, la misma unidad que sus «no»; `unsortedNo` sigue por par (cubre si hay alguna fila del par).
- Lecciones: `sources` sigue siendo una lista de PR y no cambia; recaída y lección nueva se siguen calculando con `sources.includes(pr)`.
- Comparado con lo que hay (P10): `fields.json` no declara los campos del registro del juez (entidad `review-record`, `entities.json:26-30`); `run` entra como campo nuevo de `reviewer-no` con valor `id` y la nota «mismo número que `run.id` del registro del juez (`scripts/lib/record.mjs:49`); sin `attempt`, que vale 1 en los 138 registros medidos».

## Chunks

### 1. Detector de cifras sin respaldo y su medida sobre cuerpos reales, sin enchufarlo
Files: `scripts/lib/pr-figures.mjs`, `test/pr-figures.test.js`, `test/fixtures/pr-figures/`, `scripts/lib/pr-body.mjs`
Depends on: none
Blocked by: none
Existing: `git grep -n -i -E "pr-figures|unbacked|cifra-sin-comando|FIGURE_" -- scripts test standards` -> sin salida (código 1); `parseSections` existe pero no se exporta (`scripts/lib/pr-body.mjs:34`).
Not done: `scripts/lib/pr-figures.mjs` exporta `HABITUAL`, `COMMAND_HEADS`, `UNMEASURED_MARKS` y `unbackedFigures(sectionText)`, que devuelve la lista de línea y cifra; `scripts/lib/pr-body.mjs` solo exporta `parseSections` (ninguna regla cambia; C13 se mantiene). Corpus en `test/fixtures/pr-figures/`: `malos/` con los 3 seguros del cuerpo, escritos como cuerpos mínimos con la frase literal que cita el juez en `SALIDA` (fuente y run id en la cabecera de cada fichero), y `buenos/` con los cuerpos finales de los 20 últimos PR fusionados, bajados en una llamada con el token del constructor (`gh api "repos/factory-am89/fabrica/pulls?state=closed&per_page=30"`). El test fija la medida como hecho de máquina: la lista exacta de malos cazados y de buenos marcados, en las dos variantes (con y sin «Not verified»), y que la variante elegida cumple el listón. El PR pega la tabla antes y después (antes: 0 de 3 cazados, porque el check no existe). Si ninguna variante cumple el listón, el PR se fusiona igual como medida y el trozo 2 no se construye; se dice en el PR. No enchufa nada en `prBodyFaults` (trozo 2), no mira el título ni los ficheros del diff (#143 r4 queda fuera) ni números escritos en letra («dos lecciones»). Toca un fichero de la puerta (`scripts/lib/pr-body.mjs`) solo para exportar; si rompe main, se revierte el PR desde una rama nueva.
Done:
```sh
node --test test/pr-figures.test.js test/pr-body.test.js
```

### 2. `prBodyFaults` falla con una cifra sin respaldo en el cuerpo del PR
Files: `scripts/lib/pr-body.mjs`, `test/pr-body.test.js`, `scripts/lib/gate.mjs`, `.github/pull_request_template.md`, `.claude/skills/github/referencias/subir.md`
Depends on: 1
Blocked by: none
Existing: `prBodyFaults` (`scripts/lib/pr-body.mjs:61-86`) no llama a ningún detector de cifras; `GATE_FILES` no tiene `scripts/lib/pr-figures.mjs` (`scripts/lib/gate.mjs:14-38`).
Not done: solo si el trozo 1 cumplió el listón. `prBodyFaults` llama a `unbackedFigures` en las secciones que eligió el trozo 1 y añade un fallo por cifra («## <sección> line N: figure X has no command, code block or sin medir next to it»). El `hint` de Evidence en `SECTIONS` nombra la regla y la plantilla se regenera con él; `subir.md` lo dice en media frase. `scripts/lib/pr-figures.mjs` entra en `BASE` de `gate.mjs` (lo exige `test/gate-files.test.js`). Lector: el paso «PR body has the template sections» de `tests.yml`, que ya corre en cada PR (disparador `ci-test`), sin tocar el workflow; el constructor lo corre a mano antes de abrir (paso 4 de `.claude/agents/constructor.md`, que no cambia). Clase del fallo: «cifra o recuento afirmado sin el comando que lo respalda» (4 de 10 «no» con log legible). El test pasa por la entrada real: `run` de `scripts/pr-body.mjs` con un cuerpo malo del corpus da 1 con el fallo, y con uno bueno da 0. Endurece C13 (añade un fallo y no quita ninguno); si rompe main, se revierte el PR desde una rama nueva, y como `tests.yml` usa el `pr-body.mjs` de la rama, el PR de arreglo se juzga con su arreglo. No mide el efecto: eso es contar filas `cifra-sin-comando` (trozo 4) en las rondas de los PR fusionados después, cuando haya unos 20.
Done:
```sh
node --test test/pr-body.test.js test/pr-figures.test.js test/gate-files.test.js
```

### 3. Una fila por ronda: campo `run` en `reviewer-no.json`, deuda por ronda y migración de las 26 filas
Files: `scripts/lib/reviewer-no.mjs`, `test/reviewer-no.test.js`, `scripts/reviewer-no.mjs`, `test/reviewer-no-cli.test.js`, `test/fixtures/reviewer-no/records.json`, `reviewer-no.json`, `test/lesson-effect.test.js`, `test/free-values.test.js`, `test/audit-no-per-kind.test.js`, `test/apoyo/audit-raiz.mjs`, `fields.json`, `.claude/agents/constructor.md`
Depends on: none
Blocked by: none
Existing: `git grep -n -E "\brun\b" -- scripts/lib/reviewer-no.mjs reviewer-no.json` -> solo un comentario (`scripts/lib/reviewer-no.mjs:151`); la clave sin ronda está en `scripts/lib/reviewer-no.mjs:87-89`.
Not done: `REVIEWER_NO_KEYS` gana `run`; `REVIEWER_NO_VERSION` pasa a 2; código nuevo `REVIEWER_NO_BAD_RUN` (no es entero positivo) con su caso malo; su lector y disparador es `reviewerNoFaults`, que ejecuta `test/reviewer-no.test.js` sobre el fichero real en cada `npm test` y en el job `tests` de cada PR, y `--debt` lo ve al correr; la clase del fallo que lo origina es «clave de fila duplicada que impide registrar rondas distintas de un mismo PR» (la segunda fila C9 de #143 tuvo que ir como `otro`); el caso de `REVIEWER_NO_DUPLICATE_ROW` pasa a «dos rondas de la misma pregunta y clase son dos filas válidas; la misma ronda dos veces es fallo». `reviewerNoDebt` cuenta por (PR, run, pregunta), y `humanDebt` y `--json` muestran el `run`. Migración en el mismo PR (si no, cae el test del fichero real): cada una de las 26 filas recibe el `run` de la ronda cuya `SALIDA` dice lo que dice la fila; si el par tiene varias rondas «no» y leyendo no se puede decidir, no se elige una por defecto: la migración falla en alto con esa fila y el constructor la resuelve a mano, diciéndolo en el PR. La fila `otro` de #143 se queda como está (la arregla el trozo 5). Las rondas que quedan sin fila salen en `missing` y las rellena el trozo 5. El paso 6 de `constructor.md` dice «una fila por ronda, con el `run` del registro del juez de esa ronda». `fields.json` declara `run` (ver «El registro por ronda»). No cambia el código de `noPerKind`, `readTriagedNo` ni `scripts/lib/lessons.mjs` (solo los fixtures de test que escriben filas v1). No añade el paso de arranque de la deuda (trozo 5 de `plans/registro-de-no.md`, sin construir). Ningún fichero es de la puerta; si rompe main, se revierte el PR.
Done:
```sh
node --test test/reviewer-no.test.js test/reviewer-no-cli.test.js test/lesson-effect.test.js test/free-values.test.js test/audit-no-per-kind.test.js test/fields.test.js test/golden-machine.test.js test/principles-and-roles.test.js
```

### 4. Clase `cifra-sin-comando` en `KINDS` y reclasificación de las filas que ya la cuentan
Files: `scripts/lib/reviewer-no.mjs`, `test/reviewer-no.test.js`, `reviewer-no.json`
Depends on: 3
Blocked by: none
Existing: `KINDS` (`scripts/lib/reviewer-no.mjs:21`) no la tiene; `git grep -n -i -E "cifra-sin-comando" -- scripts test standards` -> sin salida (código 1).
Not done: añade `cifra-sin-comando` a `KINDS` (antes de `otro`) y pasa a esa clase las filas de rondas seguras que ya existen tras el trozo 3 (#117 r1 C9 y #144 C9, si la migración las puso en esas rondas). Antes y después en el PR con `node scripts/audit.mjs --json` (`byKind`). Es la cifra con la que se medirá el trozo 2: filas `cifra-sin-comando` por ronda en PR fusionados antes y después de él. No rellena filas nuevas (trozo 5) ni decide los dudosos (los decide quien lee su `SALIDA` en el trozo 5).
Done:
```sh
node --test test/reviewer-no.test.js test/audit-no-per-kind.test.js && node -e "const r=require('./reviewer-no.json').rows;process.exit(r.some((x)=>x.kind==='cifra-sin-comando')?0:1)"
```

### 5. Rellenar las rondas sin fila: #142 (C8, C9, C14, C15), las rondas de #143 y #144 y el resto de `missing`
Files: `reviewer-no.json`
Depends on: 4
Blocked by: none
Existing: #142 no tiene filas (lista de `source` de `reviewer-no.json`, leída con node); tras el trozo 3, `node scripts/reviewer-no.mjs --debt --repo factory-am89/fabrica --json` da lo que falta por ronda.
Not done: una fila por cada terna de `missing`, con `kind` leído de la `SALIDA` de esa ronda (`gh run view <run> --log`, job `juzgar`), no de memoria. #143: cuatro rondas C9 esperadas (r1 39618862808 cobertura de test afirmada, r2 39631900243 recuento del título, r3 39792269026 y r4 39800431474 cifras); la fila `otro` de #143 pasa a su clase real. #144: la ronda 39622399143 (C9 y C15) y las que haya. `outcome: pendiente` salvo que el PR esté en `sources` de una lección. Lo hace una sesión que no construyó esos PR. El PR pega el recuento por `kind` antes y después y cuántas filas `cifra-sin-comando` hay (esperado: las 4 seguras; los dudosos según su `SALIDA`). No cambia el vocabulario. La Done necesita red y el token del constructor.
Done:
```sh
node scripts/reviewer-no.mjs --debt --repo factory-am89/fabrica --json | node -e "let s='';process.stdin.on('data',(d)=>{s+=d}).on('end',()=>{const r=JSON.parse(s);process.exit(r.missing.length===0&&r.unmatched.length===0?0:1)})"
```

## Build order
Ola 1: trozos 1 y 3 (no comparten fichero; dos constructores). Ola 2: trozos 2 y 4 (dos constructores; el 2 solo si el 1 cumplió el listón). Ola 3: trozo 5 (red y token del constructor). Fuera de este plan: quien toque `scripts/lib/pr-body.mjs`, `reviewer-no.json` o `scripts/lib/reviewer-no.mjs` a la vez mira antes `npm run sesiones` y los PR abiertos.

## Decisions taken
- principio 4 | eligió: un detector propio scripts/lib/pr-figures.mjs al que llama prBodyFaults | descartó: un script y un paso nuevos en tests.yml para las cifras | motivo: decidido
- principio 6 | eligió: el disparador que ya existe, el paso del cuerpo del PR de tests.yml | descartó: un workflow nuevo o un hook local, que obligarían a tocar la lista cerrada de standards/intervention.md | motivo: decidido
- principio 2 | eligió: fijar el listón de enchufe (al menos 2 de los 3 seguros cazados y como mucho 2 de los 20 últimos PR fusionados marcados) antes de medir | descartó: decidir el listón después de ver la medida | motivo: decidido
- principio 4 | eligió: attempt fuera de la clave de fila, solo run.id | descartó: la pareja run.id y attempt como clave | motivo: decidido
- principio 3 | eligió: la migración falla en alto con la fila que no se puede decidir y se resuelve a mano | descartó: tomar la ronda más antigua por defecto | motivo: decidido
- principio 2 | eligió: medir el detector sobre cuerpos reales en un PR aparte y enchufarlo solo si cumple el listón | descartó: enchufarlo a la vez que se escribe | motivo: decidido
- principio 2 | eligió: la marca sin medir como válvula de la regla | descartó: exigir comando para toda cifra aunque no haya salida posible | motivo: decidido
- principio 4 | eligió: el run id del juez como clave de ronda | descartó: un número de ronda 1, 2, 3 calculado aparte | motivo: decidido
- principio 3 | eligió: run obligatorio en la versión 2 con todas las filas migradas | descartó: run opcional para las filas viejas | motivo: decidido
- principio 2 | eligió: una clase nueva cifra-sin-comando | descartó: seguir contándolas dentro de afirmacion-sin-prueba | motivo: decidido
- excepción a principio 2 | motivo: los malos del corpus son la frase que cita el juez y no el cuerpo entero de esa ronda, que no está guardado | coste: la medida de cazados es optimista porque falta el texto de alrededor

## Por qué de cada decisión
En el orden de «Decisions taken»: (1) `prBodyFaults` es el único sitio de las reglas del cuerpo; un segundo script sería una segunda copia del lector de secciones; (2) el paso ya corre en cada PR y en cada edición del cuerpo, y tocar `tests.yml` sería lista cerrada sin necesidad; (3) una regla es una hipótesis: el listón se fija antes de medir; (4) C9 pide que lo no comprobado se diga, y la marca es eso; (5) un número de ronda se rompe con rondas con error, anulaciones y reejecuciones, y el `run.id` ya está en el registro del juez; (6) lección `absent-field-read-as-default`; (7) sin la clase no hay cifra de antes y después del trozo 2; (8) ver «Not verified».

## Doubts
- El listón (2 de 3 cazados, como mucho 2 de 20 falsos) lo fijo yo sin dato previo de falsos positivos; no está en la lista cerrada, así que lo decido y lo apunto.
- Una vez enchufado, aflojar el check es «debilitar un check» (`standards/intervention.md`): pasará por Pablo. Por eso se mide antes.
- `attempt` no entra en la clave: si un día el juez se reejecuta con el mismo `run.id` (0 de 138 hasta el 21 oct), sus dos intentos serán una sola ronda en el registro.
- La deuda no corre sola (no hay paso de arranque): con filas por ronda, una ronda sin fila solo se ve si alguien corre `--debt`. Es el trozo 5 de `plans/registro-de-no.md`, sin construir; no entra aquí.
- `cifra-sin-comando` parte `afirmacion-sin-prueba`; la regla de `plans/registro-de-no.md` (un valor nuevo entra cuando dos o más filas `otro` cuentan la misma clase) no se cumple al pie de la letra: hay 4 casos medidos, pero contados como `afirmacion-sin-prueba`, no como `otro`.

## Not verified
- Los cuerpos de los PR: `gh` no tiene sesión en este PC (`gh pr view 144` -> «gh auth login») y no usé `scripts/token.mjs`. No sé cuántos de los 20 cuerpos fusionados marcaría el detector; «2 o 3 de 4 cazados» es mi lectura de las citas del juez, no una ejecución.
- Que GraphQL `userContentEdits` devuelva el cuerpo de cada ronda (daría malos completos): no probado.
- Los cuatro pares de #142 (C8, C9, C14, C15) y el número de rondas «no» de #142, #143 y #144: vienen del encargo; mi copia de registros acaba en #138. Que 39618862808 sea #143 r1 lo deduzco por el texto de su `SALIDA`, no por el registro.
- Que todos los registros desde #139 tengan `run` no nulo: medido solo hasta #138.
- Que `triggerOf` clasifique el paso del cuerpo de `tests.yml` como `ci-test`: no lo corrí.
- Si `test/audit-data.test.js`, `test/hygiene.test.js` o `test/invariants.test.js` (nombran el registro) escriben filas v1: no los leí; si alguno lo hace, entra en `Files` del trozo 3.
