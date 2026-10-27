# Plan: un run cancelado de `revisor.yml` ya no deja `revisor` «juzgando» para siempre (issue #162)

Verdict: se arregla con un tercer trabajo `cerrar` en `revisor.yml` que corre aunque se cancele el run y cierra en failure el «juzgando» que abrió ESE run; lo desagradable primero: no fue un caso suelto, 3 de 18 runs desde #159 dejaron un huérfano (los 3 sin daño, ninguno en la cabeza final de un PR), y la opción que proponía el issue (que `pendiente` cierre los huérfanos de su cabeza) habría cerrado solo 1 de los 3.

## Lo que hay hoy (comprobado)

Todo por REST y GraphQL de solo lectura (`node scripts/token.mjs -- gh api ...`), el 2026-10-27. El `main` local de `C:\dev\fabrica` está atrasado (ad3ec07); el código se leyó de `origin/main` (4cf4e14, con #159 y #161) con `git show origin/main:<ruta>`.

- Runs de `revisor.yml` desde la fusión de #159 (07:52:31Z): `actions/workflows/revisor.yml/runs?created=>=2026-10-27T07:50:00Z` -> 18 runs, 7 `cancelled`. En 4 de los 7, `pendiente` se canceló sin ningún paso (no publicó). En 3, `pendiente` terminó sus pasos (publicó) y `juzgar` se canceló en cola sin ningún paso (`actions/runs/<id>/jobs?filter=all`): 40473640025 (PR #160), 40488298240 y 40489749086 (PR #161).
- Huérfanos: `commits/<sha>/check-runs?check_name=revisor&filter=all` sobre las cabezas de esos 18 runs, con `status != completed` -> 3, todos de `fabrica-revisor`, título `juzgando`:
  - `d76a872` (PR #160) 122086502111, 08:27:45Z. MISMA cabeza: el run que lo canceló (40473654601) es de `d76a872` y cerró su propio check en «sí» (122086571140, 08:27:56Z).
  - `65ff13f` (PR #161) 122135597004, 10:25:13Z. Cabeza vieja: lo canceló el run del push de 1ef9a6d.
  - `1ef9a6d` (PR #161) 122140479154, 10:36:19Z. Cabeza vieja: lo canceló el run del push de 1ce6bb4 (la final).
  - Cifra de antes: 3 huérfanos en 18 runs (3 de 7 cancelados); en la cabeza final de un PR, 0. En `homenu-panel`, el otro repo que llama a `revisor.yml@main`, no hay PR desde #159 (el último se actualizó el 2026-10-23).
- Cómo decide GitHub con varios `revisor` en una cabeza (caso `d76a872`, el único huérfano en la misma cabeza): sin `filter=all` la REST devuelve solo 122086571140 (el más nuevo, «sí»); en `1ef9a6d` devuelve el huérfano, que allí es el más nuevo. GraphQL `statusCheckRollup` de `d76a872` con `isRequired(pullRequestNumber:160)` lista un solo `revisor`, 122086571140, `SUCCESS`, `isRequired:true`; el huérfano no aparece. Con esta evidencia: gana el más nuevo por creación y un huérfano más viejo de la misma cabeza no bloquea. No es `mergeable_state` (no se lee en pasado); el trozo 1 lo confirma por su entrada real.
- Por qué el cierre de #159 no lo cubre: `juzgar` lleva `if: ${{ !cancelled() && ... }}` (`revisor.yml:75`) y su paso del veredicto (`if: always()`, `revisor.yml:150`) no corre si el trabajo se cancela en cola; el `catch` de `main()` (`veredicto.mjs:269-283`) solo cubre un error dentro del juez.
- Quién más lee o escribe el mismo estado (check-runs `revisor`). Búsqueda: `git grep -n -E "PENDING_TITLE|readCheckRuns|\.pending\b" origin/main -- scripts test .claude` y `git grep -n "revisor.yml@main" origin/main`. Escribe solo `scripts/veredicto.mjs` (`publicarCheck` :188, `marcarEnCurso` :193, `cerrarCheck` :195, `anular` :228). Leen: `anular` (`veredicto.mjs:232-235`, el último de la App por id; si está en curso espera); la guarda del «sí» (`veredicto.mjs:299`, un sí pasa a no si hay un `revisor` más nuevo de la App que no sea override); `readCheckRuns` (`scripts/lib/record.mjs:100-123`: in_progress con `PENDING_TITLE` suma `pending`; un completado sin registro es `unreadable` y para `scripts/lib/audit-data.mjs:83`, `scripts/lib/lesson-effect.mjs:57`, `scripts/lib/reviewer-no.mjs:160` y `scripts/records.mjs:10`); `scripts/collect-records.mjs:94` (baja con `filter=all`); GitHub (ruleset, `revisor` de la integración 5332150); `apps/proyecto-nuevo/revisor.yml:18` y `homenu-panel/.github/workflows/revisor.yml` (llaman a `@main`, sin `concurrency` propia, permisos `contents/pull-requests/checks: read`).
- `anular` hoy: un huérfano más viejo que el juicio nuevo no le afecta (toma el más nuevo por id). Le afectaría si el huérfano fuera el más nuevo de la cabeza actual (juicio cortado sin run posterior: runner perdido, cancelación a mano): esperaría para siempre y el Approve de Pablo no saldría hasta otra edición. No ha pasado (0 en cabeza final).
- El hueco tras editar el cuerpo: `tests.yml:20-23` se relanza con `edited`. Horas de edición (GraphQL `userContentEdits.editedAt`) contra el `started_at` del primer check posterior en la cabeza, 6 ediciones de #160 y #161: `tests` empieza 5-7 s después (09:03:26->09:03:32, 10:27:08->10:27:15, 10:36:04->10:36:11, 10:37:56->10:38:03, 10:48:00->10:48:05, 10:50:33->10:50:40) y `revisor` «juzgando», 12-17 s después. Desde que `tests` aparece ya bloquea (#156 midió `blocked` con un check en curso), así que el hueco con los dos verdes viejos es de 5-7 s, no de 11. Fusiones dentro de 20 s de una edición desde #159: 0 de 3 (#160 fusionado 10:53:14, última edición 10:50:33; #161 10:38:26 y 10:36:15; #163 sin ediciones). Una fusión automática ya armada no salta por una edición (ya era fusionable); el riesgo es fusionar a mano o armarla en esos segundos. No se arregla aquí.

## Chunks

### 1. El plan en `plans/` y el caso de la misma cabeza reproducido antes del arreglo
Files: `plans/revisor-huerfano.md`
Depends on: none
Blocked by: none
Existing: `git ls-tree --name-only origin/main plans/` -> `app-admin.md cockpit.md menuplan-separation.md registro-de-no.md revisor-pendiente.md trabajar-solos.md`; `revisor-pendiente.md` es #155 y no trata un run cancelado (sus dudas solo nombran el runner perdido y el timeout).
Not done: no arregla nada. Reproduce en el PR de este plan, SIN fusión automática armada: el constructor edita el cuerpo, lee una vez a los ~20 s que hay `juzgando` en la cabeza y vuelve a editarlo; con el segundo juicio terminado lee los `revisor` de la cabeza y `mergeable_state`. Una lectura de `mergeable_state` a los ~2 s de la primera edición mide el hueco de 5-7 s (puede salir `unknown`, GitHub lo calcula en diferido; se apunta tal cual). Si tras el segundo juicio sale `blocked`, la evidencia de arriba estaba mal (un huérfano de la misma cabeza bloquea): el trozo 3 pasa a urgente, sin cambiar de forma.
Done:
```sh
node scripts/check-plan.mjs --file plans/revisor-huerfano.md
# en el PR del plan, tras dos ediciones del cuerpo en la misma cabeza y con el segundo juicio terminado (SHA = cabeza, PR = numero):
node scripts/token.mjs -- gh api "repos/factory-am89/fabrica/commits/$SHA/check-runs?check_name=revisor&filter=all" --jq '.check_runs[] | "\(.id) \(.status) \(.conclusion) \(.output.title)"'
node scripts/token.mjs -- gh api repos/factory-am89/fabrica/pulls/$PR --jq .mergeable_state
# antes del arreglo debe salir: un juzgando in_progress mas viejo que el veredicto nuevo, y mergeable_state clean o unstable (no blocked)
```

### 2. Los lectores de registros cuentan aparte un juicio cortado
Files: `scripts/lib/record.mjs`, `scripts/records.mjs`, `test/record.test.js`
Depends on: none
Blocked by: none
Existing: `git grep -n -E "CUT_TITLE|cortado" origin/main -- scripts test` -> sin salida. Hoy `readCheckRuns` (`record.mjs:100-123`) aparta solo `OVERRIDE_TITLE` y el in_progress con `PENDING_TITLE`; un completado sin registro es `unreadable` (`test/record.test.js:98`).
Not done: nadie publica todavía un juicio cortado (trozo 3). El título nuevo `CUT_TITLE` («juicio cortado») vive junto a `PENDING_TITLE` y `OVERRIDE_TITLE` y `veredicto.mjs` lo importará; `readCheckRuns` lo cuenta en `cut` solo si está `completed` y en `failure` (cualquier otra combinación sin registro sigue `unreadable`); `records.mjs` imprime `cut:` junto a `pending:`. Campo nuevo `cut`: un contador de `readCheckRuns` como `pending` y `overrides`, no una entidad; `entities.json` tiene `review-record` y ningún contador de esos, así que no se añade fila. No toca los 3 huérfanos viejos: solo la App del revisor puede cambiar sus check-runs y su clave no está en local; seguirán sumando `pending: 3`. Puerta: `record.mjs` está en `GATE_FILES` (`scripts/lib/gate.mjs:21`); mantiene C13 (todo check sin registro sigue parando las cifras salvo los tres títulos con nombre). Si rompe `main`: revertir el PR desde una rama nueva.
Done:
```sh
node --test test/record.test.js test/audit-data.test.js test/reviewer-no.test.js test/lesson-effect.test.js test/collect-records.test.js
# casos nuevos: un completed/failure con CUT_TITLE suma cut y no unreadable; uno in_progress o success con CUT_TITLE sigue en unreadable;
# caso malo en rojo: con el record.mjs de main el completed/failure con CUT_TITLE cae en unreadable y el test falla
```

### 3. `revisor.yml` cierra el «juzgando» de un run que no llegó al veredicto
Files: `.github/workflows/revisor.yml`, `scripts/veredicto.mjs`, `test/revisor-pendiente.test.js`, `lessons/in-progress-closed-by-job-that-may-not-run.json`
Depends on: 1, 2
Blocked by: A
Existing: `git grep -n -E "external_id|MODO=cerrar|cerrar:" origin/main -- scripts .github test lessons` -> solo `veredicto.mjs:264`, un comentario; `revisor.yml` tiene dos trabajos, `pendiente` y `juzgar` (`revisor.yml:37,71`); ninguna lección de `lessons/` trata un estado abierto por un trabajo y cerrado por otro (`required-check-stale-while-rejudged.json` es #148/#156, otra clase).
Not done: no toca `concurrency` (`revisor.yml:27-29`), ni los disparos, ni `anulacion.yml`, ni el ruleset, ni permisos de la App (ya tiene `checks: write`). No cierra los 3 huérfanos viejos. No cubre que `cerrar` pierda su propio runner: queda un «juzgando» del que se sale editando el cuerpo (el juicio nuevo es más nuevo y gana, evidencia arriba), y la anulación espera hasta entonces. No arregla `gh run rerun --failed` con la salida reutilizada de `pendiente` (duda abierta en `plans/revisor-pendiente.md`). Qué hace: (a) `MODO=pendiente` publica el check con `external_id` igual a `RUN_ID` (`github.run_id`), campo propio de los check-runs de GitHub, no uno nuestro (`fields.json` no modela check-runs); (b) trabajo nuevo `cerrar` con `needs: [pendiente, juzgar]` y un `if:` con `always()`, la condición de repo y borrador de `pendiente`, y `needs.juzgar.result` distinto de `success`; environment `revisor`, `permissions: contents: read`, baja la Fábrica a `.fabrica/` en `job.workflow_sha`, crea su token de la App con `permission-checks: write` y corre `MODO=cerrar` con `REPO`, `SHA`, `TOKEN`, `RUN_ID`; (c) `MODO=cerrar` lee `revisoresDeLaApp(SHA)` (`veredicto.mjs:205`), toma los no completados cuyo `external_id` es `RUN_ID` y los cierra con PATCH en `failure`, título `CUT_TITLE`, resumen «- el juicio se cortó antes del veredicto (run RUN_ID)»; sin ninguno lo dice y sale con 0; un error de la API sale con 1. Por qué `external_id` y no la salida `check_run`: en 1ef9a6d `pendiente` acabó `cancelled` con todos sus pasos en verde, y no está comprobado que GitHub entregue la salida de un trabajo cancelado. Por qué failure y no neutral: un check obligatorio en neutral cuenta como pasado («Required status checks must have a successful, skipped, or neutral status», citado en `plans/revisor-pendiente.md`). Con `anular`: un juicio cortado es un «no» con hallazgo; si es el último de la cabeza, el Approve de Pablo lo anula (hoy esperaría para siempre). No ensancha la anulación: antes de #159 un run cancelado publicaba un «no» por el `if: always()` del veredicto y Pablo podía anularlo. La guarda del sí (`veredicto.mjs:299`) no cambia: el check cortado es siempre más viejo que el del juicio siguiente (con `concurrency` el run nuevo no empieza hasta que acaba el cancelado, `cerrar` incluido). Clase: un estado «en curso» que abre un trabajo y cierra otro que puede no correr. Lector de la regla: `test/revisor-pendiente.test.js`, disparador `ci-test`. Puerta: toca `revisor.yml` y `veredicto.mjs` (`GATE_FILES`); endurece C13 (ningún run deja su `revisor` sin cerrar) y por esta vía nada se aprueba (solo cierra en failure). Si rompe `main`: un PR de revert desde una rama nueva; si el revisor roto no lo deja pasar, Pablo pulsa Approve y `anulacion.yml` (no usa `revisor.yml`) publica el verde. Repos que llaman a `@main`: heredan el trabajo sin cambios (mismo environment y secretos que `pendiente`); sin probar en `homenu-panel`.
Done:
```sh
node --test test/revisor-pendiente.test.js test/anulacion.test.js test/verdict-e2e.test.js test/revisor-workflow.test.js test/gate-files.test.js test/lessons.test.js
npx actionlint .github/workflows/revisor.yml
# casos nuevos en revisor-pendiente: MODO=pendiente manda external_id=RUN_ID en el POST;
# MODO=cerrar con CHECKS_FALSOS [uno in_progress de este run, uno in_progress de otro run, uno completado de este run] hace UN solo PATCH,
# al de este run, con conclusion failure y titulo CUT_TITLE; sin ninguno en curso de este run no publica nada y sale con 0;
# el yml tiene cerrar con needs [pendiente, juzgar], always(), la condicion sobre needs.juzgar.result y MODO=cerrar.
# Caso malo en rojo: con el veredicto.mjs de main MODO=cerrar no existe (cae al juicio sin CHECK_RUN) y el test del PATCH falla.
```

### 4. Medida después, en vivo, y la viñeta de la skill `github`
Files: `.claude/skills/github/SKILL.md`
Depends on: 1, 3
Blocked by: none
Existing: `git show origin/main:.claude/skills/github/SKILL.md` -> la viñeta «`revisor` está «juzgando» mientras se juzga (#155)» (línea 27) no nombra un run cancelado ni `cerrar`.
Not done: cambia esa viñeta, no añade otra (el presupuesto de `test/skills.test.js`, `BUDGET_EXCEEDED`, ya paró la de #161). No vuelve a contar los runs anteriores (la cifra de antes está arriba). Si la medida sale mal, se reabre #162 y la viñeta no se escribe como arreglado. `revisor.yml` corre la versión de `main`: el trozo 3 no se puede probar en vivo en su propio PR, por eso la medida va aquí.
Done:
```sh
# en el PR de este trozo, sin fusion automatica armada: editar el cuerpo, ver juzgando (~20 s) y empujar un commit (el caso de 1ef9a6d); OLD = cabeza vieja
node scripts/token.mjs -- gh api "repos/factory-am89/fabrica/commits/$OLD/check-runs?check_name=revisor&filter=all" --jq '.check_runs[] | "\(.id) \(.status) \(.conclusion) \(.output.title)"'
# debe salir: el check de ese run completed failure «juicio cortado» y ninguno in_progress (antes: 3 huerfanos en 18 runs)
# y, con el mismo filtro de no completados sobre las cabezas de los runs desde la fusion del trozo 3: 0
node --test test/skills.test.js
```

## Build order
Ola 1: 1 y 2 en paralelo (ficheros distintos). Ola 2: 3, con A ya contestada y la medida del 1 apuntada. Ola 3: 4, con el 3 ya en `main`.

## Decisions taken
- principio 3 | eligió: un trabajo cerrar con always() que cierra en failure el juzgando de su propio run | descartó: que pendiente cierre los juzgando de su cabeza antes de abrir el suyo, que no ve las cabezas viejas (habría cerrado 1 de los 3 huérfanos medidos) y deja el estado abierto hasta que alguien vuelva a juzgar | motivo: decidido
- principio 3 | eligió: mantener cancel-in-progress | descartó: quitarlo, que deja acabar el juicio de un cuerpo viejo y, en la misma cabeza, publicar su sí antes de que empiece el juicio del cuerpo nuevo, con la fusión automática armada | motivo: decidido
- principio 3 | eligió: un trabajo aparte con always() | descartó: un paso if cancelled() dentro de juzgar, que no corre cuando juzgar se cancela en cola (los 3 juzgar cancelados no tienen ningún paso) | motivo: decidido
- principio 3 | eligió: cerrar en failure con título propio | descartó: cerrar en neutral, que el ruleset cuenta como pasado y dejaría fusionar sin juicio | motivo: decidido
- principio 3 | eligió: buscar el check del run por external_id, un campo que GitHub ya tiene | descartó: leer la salida check_run de un trabajo cancelado, sin comprobar que GitHub la entregue | motivo: decidido
- principio 4 | eligió: MODO=cerrar en scripts/veredicto.mjs y CUT_TITLE en record.mjs junto a PENDING_TITLE | descartó: un script nuevo que también escribe revisor, un segundo sitio de escritura y un fichero más de puerta | motivo: decidido
- principio 2 | eligió: decidir la misma cabeza con la REST sin filtro y el statusCheckRollup con isRequired de d76a872, y confirmarlo en vivo en el trozo 1 | descartó: parar el arreglo hasta reproducirlo, cuando el diseño del trozo 3 no depende de la respuesta | motivo: decidido
- principio 6 | eligió: dejar fuera los dos desvíos de #161, con su motivo en Dudas | descartó: meterlos como trozos de este plan, que son otras clases | motivo: decidido

## Decisions for Pablo

Contestada el 2026-10-27: Pablo autorizó tocar `revisor.yml` y `veredicto.mjs` para cerrar este hueco («Fixea esto» y luego «sigue»), opción 1. Se deja aquí porque el trozo 3 toca `.github/workflows/` y `check-plan` exige `Blocked by: A`; la fila de `intervenciones.md` va en el PR del trozo 3.

### A. ¿Dejas añadir al workflow del revisor un paso que cierre el «juzgando» cuando un juicio se corta?
Por qué te lo pregunto: es tocar `.github/workflows/revisor.yml`, de la lista cerrada. Hoy, si un juicio se cancela (pasa al editar el cuerpo y empujar seguido), su check se queda «juzgando» para siempre: 3 veces de 18 desde ayer, sin daño porque eran cabezas viejas o ya tapadas, pero en la cabeza final bloquearía el PR y tu Approve no lo sacaría.
1. Sí: un trabajo más que, si el juicio no acaba, cierra su check como «no» (juicio cortado); unos segundos más solo cuando se cancela (recommended)
2. Quitar la cancelación automática: no hay huérfanos por cancelación, pero un juicio viejo puede decir «sí» antes de que se juzgue el cuerpo nuevo, y cada edición rápida cuesta un juicio entero de más
3. No tocar nada: un huérfano en la cabeza final se saca editando el cuerpo a mano

## Dudas
- Que un trabajo con `always()` corra cuando `concurrency` cancela el run: la documentación de GitHub dice que al cancelar se reevalúan las condiciones y uno con `always()` no se cancela; no medido aquí. Si no corre, el trozo 4 lo ve (el check viejo sigue `in_progress`) y se reabre #162.
- Cuánto retrasa `cerrar` al juicio siguiente (con `concurrency` el run nuevo espera a que acabe el cancelado): sin medir; los cancelados de hoy duraron 3-15 s; se mide en el trozo 4.
- Desvío 1 de #161 (la lección no cupo en «Lo que falló» de la skill `github`): fuera. La máquina hizo su trabajo (`BUDGET_EXCEEDED` y `PROSE_DUPLICATES_TEST`, `scripts/lib/skills.mjs:142,149`); lo que falló es que el plan de #155 eligió un sitio sin mirar su presupuesto. En su clase sería una pregunta del estándar de plan («¿el sitio que elige el plan cabe en su check?»): otro issue.
- Desvío 2 de #161 (tras cada push el Evidence nombra un `HEAD` viejo, `scripts/lib/pr-body.mjs:21-31`, y `tests` falla hasta editar el cuerpo): fuera, pero es lo que más cancela: cada push lleva su edición del cuerpo detrás, y 2 de los 3 huérfanos salieron de editar y empujar seguido. Arreglarlo baja la frecuencia, no cierra la clase. Propuesta: issue aparte con la cifra de runs por push (hoy, 7 de 18 runs cancelados).
- El hueco de 5-7 s entre editar el cuerpo y que aparezca `tests`: no se arregla (0 de 3 fusiones dentro; una fusión automática ya armada no salta por una edición). Se mide en el trozo 1; si hiciera falta, el sitio es el paso 8 de `.claude/skills/github/referencias/subir.md` (armar solo con los checks de la cabeza terminados después de la última edición).

## Not verified
- Que `mergeable_state` no salga `blocked` con un huérfano más viejo en la misma cabeza: deducido de la REST y del `statusCheckRollup`, no leído en vivo; es el Done del trozo 1.
- Que el `started_at` de `tests` sea su hora de cola y no la de arranque del runner: si es la de arranque, el hueco real es menor que 5-7 s.
- Que una App pueda poner `external_id` en el POST de un check-run y que vuelva en el GET con `filter=all`: lo dice la referencia de la API de checks; no probado contra GitHub.
- Que `homenu-panel` y los repos de `apps/proyecto-nuevo` acepten un tercer trabajo con el environment `revisor` sin cambios: igual que `pendiente`, que ya corre en la Fábrica; en `homenu-panel` no ha corrido desde #159.
- El tiempo y la cuota de un runner más por run cancelado: sin medir.
