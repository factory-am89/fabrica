# Plan: el check `revisor` pasa a «juzgando» al empezar cada juicio (issue #155)

Verdict: se puede arreglar sin tocar permisos de ninguna App: un trabajo nuevo de `revisor.yml` publica `revisor` en «en curso» antes de que juzgue Claude, y GitHub no fusiona con un check obligatorio que no ha terminado; pero lo desagradable es que no fue un caso suelto (12 de 142 PR fusionados entraron con un juicio a medias), y el trozo que lo arregla toca `.github/workflows/`, lo que pedía el OK de Pablo (A): lo dio el 2026-10-27, opción 1.

## Lo que hay hoy (comprobado)

- Quién publica `revisor`: solo la App `fabrica-revisor` (id 5332150; `gh api repos/factory-am89/fabrica/check-runs/120311293933 --jq .app.id` -> 5332150, el mismo `integration_id` que pide el ruleset). Lo hace en dos sitios: `publicarCheck` de `scripts/veredicto.mjs:188-189` (un POST con `status: 'completed'`, ya terminado) al final del trabajo `juzgar` de `.github/workflows/revisor.yml` (paso de la línea 112, con el token creado en la 98), y `anular` (`scripts/veredicto.mjs:207-219`), que corre en `anulacion.yml` tras una review de Pablo. Nadie publica nada al empezar: el check nace terminado (`started_at` = `completed_at` en los cinco `revisor` de #148).
- `senal` no publica `revisor`: es el trabajo inerte de `senal-review.yml` (despierta a `anulacion.yml` tras una review). En #148 corrió a las 07:42:32 porque `veredicto.mjs:200-201` envió la aprobación de la App justo después del «sí» de las 07:42:25.
- El ruleset de `main` (`gh api repos/factory-am89/fabrica/rules/branches/main`): `required_status_checks` con `tests` (integration 15368) y `revisor` (integration 5332150), `strict_required_status_checks_policy: false`, `required_approving_review_count: 0`. La aprobación de la App no cuenta para fusionar; solo los dos checks.
- El fallo, reproducido con los check-runs reales de la cabeza `5519484b769a9e1c89108d2c74a8fadf66d1e4bb` (`commits/{sha}/check-runs?filter=all`, UTC): `revisor failure 07:40:23` (lo publica el paso `if: always()` del run cancelado de 07:38:47), `revisor success 07:42:25`, `tests` relanzado 08:07:21 -> success 08:07:59, `juzgar` 08:07:24 -> 08:09:14, `revisor failure 08:09:11`; `merged_at 2026-10-23T08:08:07Z`, fusionado por `fabrica-constructor[bot]` con la fusión automática (squash) armada desde las 07:23:17. Los tres `revisor` van en la misma check suite (108195950061).
- Cuántas veces: script de solo lectura por REST (`stale.mjs` en el scratchpad de esta sesión: 2 páginas de `pulls?state=closed` + 1 `check-runs?check_name=revisor&filter=all` por PR; 144 llamadas). De 142 PR fusionados, 15 tienen un `revisor` de la App publicado después de `merged_at`. Cruzado con `actions/runs?head_sha=` (15 llamadas): en 12 había un run de `revisor` de esa cabeza creado antes de la fusión, o sea, se fusionaron mientras se volvía a juzgar: #33, #46, #51, #57, #63, #93, #94, #96, #98, #107, #135, #148. En 11 el juicio tardío fue «sí» (suerte); en #148, «no». Los otros 3 son otra cosa: #20 y #40 entraron durante pausas del ruleset (clase ya cerrada, `test/ruleset-never-paused.test.js`; #40 lo fusionó `pabloam89` con el último `revisor` en failure), y #44 se volvió a juzgar después de fusionado. Cifra de antes: 12 de 142 (8,5 %), 1 con «no».
- Qué disparos vuelven a calcular `revisor` (`revisor.yml:16-17`): `opened`, `synchronize`, `reopened`, `ready_for_review`, `edited`, y relanzar el run a mano. `synchronize` es el único seguro: cambia la cabeza, el verde viejo se queda en el commit viejo y en el nuevo no hay `revisor`, así que el ruleset espera. `edited` (cuerpo, título o rama base), `reopened`, `ready_for_review` y relanzar juzgan la misma cabeza: el verde viejo sigue valiendo hasta que llega el nuevo. La API de runs no dice la acción; que las 12 fueran ediciones se deduce de que la cabeza no cambió y de lo que cuenta el issue.
- Si «en curso» bloquea: la documentación de GitHub (about-protected-branches, «Require status checks before merging») dice «Required status checks must have a successful, skipped, or neutral status»; la tabla de pull-requests/reference/status-checks dice que `in_progress` y `queued` no son exclusivos de Actions (una App los puede poner). Medido aquí con `tests`, que Actions crea en cola al empezar: en los 12 PR fusionados donde un `tests` nuevo empezó sobre la misma cabeza después de un `tests` verde y antes de la fusión, la fusión esperó en los 12 a que acabara el nuevo (`tests-wait.mjs` en el scratchpad). Es justo lo que le falta a `revisor`.
- Quién más lee o escribe el mismo estado (los check-runs `revisor`). Búsqueda: `git grep -n "check-runs\|check_runs\|checkName\|check_name"` fuera de `test/fixtures`, y `git grep -n "revisor.yml@main"`. Escribe: solo `veredicto.mjs` (juicio y anulación). Leen: `veredicto.mjs:211` (`anular`: el último completado de la App, también sin `filter=all`); `scripts/collect-records.mjs:94` (recolector de rondas) y, con su salida, `readCheckRuns` de `scripts/lib/record.mjs:100`, que usan `scripts/records.mjs`, `scripts/lib/audit-data.mjs:84`, `scripts/lib/lesson-effect.mjs:58` y `scripts/lib/reviewer-no.mjs:169` (un check sin registro los para en alto); GitHub (el ruleset); y los repos que llaman a `revisor.yml@main` (`apps/proyecto-nuevo/revisor.yml:18`), que heredan cualquier cambio. `apps/lib-proyecto.ps1:150` solo lee `tests`. Ninguna otra App publica `revisor` aquí: los `revisor` de los 142 PR son todos de `fabrica-revisor` (filtro `app.slug` del script).
- Hallazgo de paso, lado lector: `collect-records.mjs:94` pide `check-runs?check_name=revisor` sin `filter=all` y la API devuelve por defecto solo el último. En la cabeza de #148: `total=1` sin filtro, 3 con `filter=all`. El recolector pierde rondas de una misma cabeza (ediciones, y el «no» que tapa una anulación), aunque su cabecera dice que baja todas.

## Chunks

### 1. El plan en `plans/` y el fallo reproducido en vivo antes del arreglo
Files: `plans/revisor-pendiente.md`
Depends on: none
Blocked by: none
Existing: `ls plans` -> `app-admin.md cockpit.md menuplan-separation.md registro-de-no.md trabajar-solos.md`; ninguno trata #155.
Not done: no arregla nada. La reproducción usa el PR de este mismo plan SIN fusión automática armada (no debe entrar por el hueco que mide): con `revisor` en verde, el constructor edita el cuerpo y, mientras corre `juzgar`, lee `mergeable_state`. Si sale `clean`, el hueco queda reproducido por su entrada real (editar el cuerpo) y se apunta en el cuerpo del PR. Si sale `blocked`, el mecanismo no es el de este plan y se para el trozo 4.
Done:
```sh
node scripts/check-plan.mjs --file plans/revisor-pendiente.md
# en el PR del plan, con revisor en verde, tras editar el cuerpo y con juzgar en marcha (PR = numero del PR):
node scripts/token.mjs -- gh api repos/factory-am89/fabrica/pulls/$PR --jq .mergeable_state
# antes del arreglo debe salir: clean
```

### 2. El recolector baja todas las rondas de una cabeza (`filter=all`)
Files: `scripts/collect-records.mjs`, `test/collect-records.test.js`
Depends on: none
Blocked by: none
Existing: `git grep -n "filter=all" -- scripts test` -> sin salida. `test/collect-records.test.js:35` prueba «every commit», no varias rondas del mismo commit.
Not done: no rehace las cifras ya publicadas de `records` ni de `audit --data` (salen bien en la próxima recogida); no toca `anular`, que tiene el mismo hueco (`veredicto.mjs:211`) y lo arregla el trozo 4, porque ese fichero es de puerta. Clase: un lector que toma el valor por defecto de una API (el último) como si fuera el todo.
Done:
```sh
node --test test/collect-records.test.js
# caso nuevo: el GET falso da 1 check-run si la URL no lleva filter=all y 3 si lo lleva; antes del trozo cuenta 1 y falla
```

### 3. Los lectores de registros cuentan aparte un `revisor` «juzgando»
Files: `scripts/lib/record.mjs`, `scripts/records.mjs`, `test/record.test.js`
Depends on: none
Blocked by: none
Existing: `git grep -n "PENDING\|in_progress" -- scripts/lib/record.mjs scripts/records.mjs` -> sin salida; hoy `readCheckRuns` (`record.mjs:100-115`) solo aparta los de título `OVERRIDE_TITLE`, y todo lo demás sin registro es `unreadable`, que para `audit`, `lesson-effect` y `reviewer-no`.
Not done: nadie publica todavía un `revisor` en curso (trozo 4). El título `PENDING_TITLE` vive aquí, junto a `OVERRIDE_TITLE`, y `veredicto.mjs` lo importará. Un check completado sin registro sigue siendo `unreadable`. Puerta: `record.mjs` está en `GATE_FILES`; mantiene C13 (todo check sin registro sigue parando las cifras salvo el «juzgando» sin terminar, que no es una ronda y se cuenta en `pending`, como hoy `overrides`). Si rompe `main`: revertir el PR desde una rama nueva.
Done:
```sh
node --test test/record.test.js test/audit-data.test.js test/reviewer-no.test.js test/lesson-effect.test.js
# casos nuevos: un check in_progress con PENDING_TITLE suma pending y no unreadable; uno completado sin registro sigue en unreadable
```

### 4. `revisor.yml` marca `revisor` en curso al empezar y el veredicto cierra ese mismo check
Files: `.github/workflows/revisor.yml`, `scripts/veredicto.mjs`, `test/revisor-pendiente.test.js`, `test/fixtures/github-falso.mjs`, `lessons/required-check-stale-while-rejudged.json`
Depends on: 1, 3
Blocked by: A
Existing: `git grep -n "in_progress\|MODO=pendiente\|CHECK_RUN" -- .github scripts` -> sin salida; `test/revisor-pendiente.test.js` no existe; en `lessons/` ninguna trata un check recalculado (la cercana, `ruleset-pause-merges-armed.json`, es otra clase).
Not done: no cambia los disparos de `revisor.yml` (`test/revisor-workflow.test.js:51-56` los fija y siguen igual), ni `anulacion.yml`, ni el ruleset, ni permisos de la App (ya tiene `checks: write`, `revisor.yml:105`). Qué hace, una idea en dos ficheros que deben entrar juntos: (a) trabajo nuevo `pendiente`, con el mismo `if:` y el environment `revisor`, que baja la Fábrica a `.fabrica/`, crea su propio token de la App (otro runner: Claude nunca lo ve) y corre `node .fabrica/scripts/veredicto.mjs` con `MODO=pendiente`, que publica `revisor` con `status: in_progress` y título `PENDING_TITLE` y deja su id como salida; (b) `juzgar` lleva `needs: pendiente` y corre aunque `pendiente` falle; su veredicto recibe `CHECK_RUN` y cierra ESE check con PATCH en vez de crear otro; (c) sin `CHECK_RUN` publica un «no» con el fallo «no se pudo marcar el juicio en curso» y sale con error; (d) antes de cerrar en verde mira si la App ya abrió otro `revisor` más nuevo en esa cabeza y, si lo hay, cierra el suyo en «no» con «hay un juicio más nuevo de esta cabeza» (un run cancelado aún publica, como el de 07:38:47 en #148); (e) `anular` pide `check-runs?check_name=revisor&filter=all` (hoy, `veredicto.mjs:211`, sin filtro, solo ve el último) y toma el último `revisor` de la App por id, de cualquier estado: si está en curso no hace nada, porque el juicio en curso aplica la anulación al terminar (`publicar`, `veredicto.mjs:197-198`). Esto no ensancha la anulación: hoy, con un en curso encima de un «no», anularía; después espera. Clase: un check obligatorio que se recalcula sin pasar antes a pendiente. Puerta: toca `revisor.yml` y `veredicto.mjs` (`GATE_FILES`); endurece C13 (el ruleset deja de aceptar un verde viejo durante un juicio nuevo) y mantiene la anulación de Pablo. Si rompe `main`: un PR de revert desde una rama nueva; si el revisor roto no lo deja pasar, Pablo pulsa Approve en ese PR y `anulacion.yml` (que no usa `revisor.yml`) publica el verde; por eso `test/anulacion.test.js` sigue en verde en este mismo PR. Si un juicio muere sin cerrar su check (runner perdido), el PR queda bloqueado (falla cerrado) y se sale editando el cuerpo o relanzando, que abre un juicio nuevo.
Done:
```sh
node --test test/revisor-pendiente.test.js test/anulacion.test.js test/verdict-e2e.test.js test/revisor-workflow.test.js test/golden-run.test.js test/gate-files.test.js test/lessons.test.js
npx actionlint .github/workflows/revisor.yml
# revisor-pendiente: MODO=pendiente hace POST con status in_progress y nombre revisor; el veredicto hace PATCH a /check-runs/CHECK_RUN y ningun POST completado;
# sin CHECK_RUN publica failure y sale con 1; con un revisor mas nuevo de la App en la cabeza, un si se cierra en failure;
# el yml tiene el trabajo pendiente, juzgar con needs: pendiente, y ningun paso de juzgar recibe el token de pendiente.
# Caso malo en rojo: con el veredicto.mjs de main (POST completado) el test del PATCH falla.
```

### 5. Medida después: un cuerpo editado ya no deja fusionar, y la lección en la skill `github`
Files: `.claude/skills/github/SKILL.md`
Depends on: 1, 2, 4
Blocked by: none
Existing: `git grep -n "155\|juzgando\|in_progress" -- .claude/skills/github/SKILL.md` -> sin salida.
Not done: no vuelve a contar los 142 PR viejos (la cifra de antes está arriba). Si la medida sale mal (`clean` durante el juicio), se reabre #155 y la entrada no se escribe como arreglada.
Done:
```sh
# en el PR de este trozo, sin fusion automatica armada, con revisor en verde, tras editar el cuerpo y con juzgar en marcha (SHA = cabeza, PR = numero):
node scripts/token.mjs -- gh api "repos/factory-am89/fabrica/commits/$SHA/check-runs?check_name=revisor&filter=all" --jq ".check_runs[0].status"
node scripts/token.mjs -- gh api repos/factory-am89/fabrica/pulls/$PR --jq .mergeable_state
# debe salir: in_progress y blocked (antes, en el trozo 1: clean)
node --test test/skills.test.js
```

## Build order
Ola 1: 1, 2 y 3 en paralelo (ficheros distintos). Ola 2: 4, con A ya contestada (opción 1) y en cuanto el 1 haya reproducido el hueco (`clean`). Ola 3: 5, que necesita el 4 ya en `main`: `revisor.yml` corre la versión de `main`, así que el 4 no se puede probar en vivo en su propio PR. Hasta el 4 sigue la regla provisional del issue: no editar el cuerpo de un PR con la fusión automática armada y los dos checks en verde; desarmarla antes.

## Decisions taken
- principio 3 | eligió: publicar revisor en curso al empezar el juicio, para que el ruleset espere | descartó: dejar el verde viejo y confiar en que nadie edite el cuerpo con la fusión automática armada | motivo: decidido
- principio 4 | eligió: el modo pendiente vive en scripts/veredicto.mjs junto a publicarCheck, y PENDING_TITLE junto a OVERRIDE_TITLE en record.mjs | descartó: un script nuevo para el check en curso, un segundo sitio que publica revisor y un fichero más de puerta | motivo: decidido
- principio 3 | eligió: el veredicto cierra con PATCH el mismo check que abrió su trabajo pendiente | descartó: crear siempre un check completado nuevo, que deja un en curso huérfano por juicio y deja ganar a un run viejo que publica tarde | motivo: decidido
- principio 3 | eligió: sin CHECK_RUN el veredicto publica un no y sale con error | descartó: volver en silencio al POST de hoy, un valor por defecto que esconde que el juicio no se marcó | motivo: decidido
- principio 5 | eligió: el token de la App para el check en curso se crea en un trabajo aparte, en otro runner, y un test comprueba que ningún paso de juzgar lo recibe | descartó: crear el token antes de Claude en el mismo trabajo y fiar en la frase de revisor.yml de que Claude nunca lo ve, una regla escrita sin check que la ejecute | motivo: decidido
- principio 5 | eligió: la lección required-check-stale-while-rejudged con su test como mecanismo | descartó: dejar solo la frase del issue de no editar el cuerpo con la fusión armada | motivo: decidido
- principio 2 | eligió: contar los casos por REST con filter=all y cruzarlos con los runs de cada cabeza | descartó: dar por hecho que fue un caso suelto, como suponía el issue | motivo: decidido

## Decisions for Pablo

Contestada el 2026-10-27: Pablo eligió la opción 1 (dijo «Fixea esto» tras leer la explicación del arreglo); se apuntará en `intervenciones.md` en el PR del trozo 4 (un PR con plan solo toca el plan). Se deja aquí porque el trozo 4 apunta a ella con `Blocked by: A` (check-plan lo exige para rutas de la lista cerrada).

### A. ¿Dejas cambiar el workflow del revisor para que, al empezar cada juicio, el check pase a «juzgando» y GitHub espere?
Por qué te lo pregunto: es tocar `.github/workflows/revisor.yml`, que está en la lista cerrada. Hoy, si se edita el cuerpo de un PR ya aprobado, GitHub puede fusionarlo con el «sí» viejo mientras el revisor vuelve a mirar: pasó en 12 de 142 PR y en uno (#148) el revisor acabó diciendo «no». No hace falta tocar permisos de ninguna App.
1. Sí: un paso nuevo marca «juzgando» antes de que el revisor lea y el veredicto cierra ese mismo check; cada juicio tarda unos segundos más (sin medir) (recommended)
2. Solo desarmar la fusión automática cada vez que se edita el cuerpo: tapa este caso, pero una fusión a mano aún entraría con el «sí» viejo y el constructor tendría que volver a armarla
3. No tocar nada: queda la regla en una frase («no editar el cuerpo con la fusión armada»), que ya falló 12 veces

## Dudas
- Si dentro de una misma check suite GitHub decide con el `revisor` más nuevo por creación o por última actualización: con `tests` (suites distintas) gana el más nuevo, 12 de 12, pero con el PATCH de una App no está medido. El punto (d) del trozo 4 cubre los dos casos salvo una carrera de segundos (un run viejo que cierra en verde justo después de que el nuevo abra su check); el trozo 5 lo mide en vivo.
- Si `gh run rerun --failed` reutiliza la salida de `pendiente` del intento anterior y hace PATCH a un check ya cerrado: no comprobado; hay que verlo en el trozo 5.
- Si el trozo 2 debería ir en un issue aparte: salió al listar los lectores (P13) y lo dejo aquí porque las cifras de rondas cambian con el 4.

## Not verified
- Que un `revisor` en curso publicado por una App bloquee la fusión: lo dice la documentación y lo cumple `tests` 12 de 12, pero con un check de App no se ha medido; es el Done del trozo 5.
- La acción exacta (`edited` o `reopened`) de los 12 juicios a medias: la API de runs no la da; se deduce de que la cabeza no cambió.
- La clasificación de los 15 PR (12 a medias, 2 pausas, 1 después de fusionar) se hizo a mano con las horas de los runs; no hay un script que la repita.
- Cuánto tarda el trabajo `pendiente` (arranque de runner, token y una llamada): sin medir.
- Que los repos que llaman a `revisor.yml@main` admitan un segundo trabajo con su environment `revisor` sin cambios: lo dan por hecho los comentarios de `revisor.yml:6-13`; no se ha mirado ningún repo que lo llame.
- Si un trabajo que se pasa de `timeout-minutes` corre su paso `if: always()`: no comprobado; si no, su check se queda en curso y el PR bloqueado (falla cerrado).
- La fila de la respuesta de Pablo en `intervenciones.md` no va en este PR (un PR con plan solo toca el plan); va en el PR del trozo 4.
