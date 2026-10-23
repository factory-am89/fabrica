# Plan: cockpit en homenu-panel (pizarra de encargos y aviso en vivo de cada sesión)

Verdict: se puede hacer sin secretos nuevos reutilizando la forma del envío PC -> panel por la red privada; el envío viejo llevaba roto en silencio desde el 15 oct y ya se quitó (trozo 10), y «espera a Pablo» solo se detecta tocando los ganchos de `.claude/settings.json`, que decide Pablo (A); el trozo 1 prueba el circuito entero sin A.

Los trozos 1 y 10 ya están hechos: los construyó el PR #8 de `homenu-panel` (merge `998b965`, 23 oct 2026, un solo PR que hizo las dos ideas). «Lo que hay hoy» y los `Existing` de esos dos trozos describen el estado de antes de ese PR.

Cada trozo dice en el título en qué repo se construye; sus `Files` son relativos a ese repo. «(Panel)» es `factory-am89/homenu-panel`, «(Fábrica)» es `factory-am89/fabrica`.

## Lo que hay hoy (comprobado)

- Lo desagradable primero: el único envío PC -> panel que existía (antes del PR #8 del panel, que lo quitó: trozo 10) estaba roto. `~/.claude/menuplan-fabrica/ultimo-envio.txt` es del 2026-10-15 22:09; `grep -c "Cannot find module" ~/.claude/menuplan-fabrica/enviar.log` -> 1340 (busca `C:\dev\MenuPlan-panel-lectura\scripts\fabrica.mjs`, que ya no existe), y aun así `Get-ScheduledTaskInfo "HoMenu panel - enviar fabrica"` -> `LastTaskResult : 0`. Causa: `cliente/oculto.vbs` hace `sh.Run orden, 0, True` y no devuelve el código (no hay `WScript.Quit`). Clase: un lanzador que traga el código de salida. El cockpit no puede repetirla: su envío devuelve el código y el panel enseña la edad del último envío.
- Transporte: el panel ya recibía datos del PC por la red privada. `server.mjs` (origin/main `61a82c8`, antes del PR #8) aceptaba `POST /ingest/fabrica`, validaba forma y tamaño (`MAX_BYTES`) y guardaba en `datos/` con escritura atómica (`guardarInforme`); `compose.yaml` ata el puerto a la dirección privada del servidor (dónde vive: skills `hetzner` y `tailscale`) y monta el volumen `/data`. El trozo 1 reutiliza esa forma para `POST /ingest/sesiones`.
- Registro de sesiones (Fábrica): una ficha por sesión en `~/.fabrica/sesiones/<id>.json` con solo `id, carpeta, rama, inicio, ultima` (`scripts/lib/session-log.mjs:13`; la cabecera dice «no prompt, no tool name, no free text»). La escriben `sesiones.mjs tocar` en `UserPromptSubmit` y `PostToolBatch` y la borra `fin` en `SessionEnd` (`.claude/settings.json`). `npm run sesiones -- --json` ya da la lista (`scripts/sesiones.mjs:98-105`).
- Restos: `ls ~/.fabrica/sesiones | grep -c tmp` -> 10 ficheros `.tmp` (16 a 19 oct) junto a 3 fichas: escrituras que no llegaron a renombrarse.
- Qué trae cada gancho (leído del binario de Claude Code 2.1.309, no de la documentación): `PostToolBatch` trae `tool_calls: [{tool_name, tool_input, tool_use_id, tool_response?}]`; `PermissionRequest` trae `tool_name, tool_input`; `Stop` trae `stop_hook_active`, `last_assistant_message` y `background_tasks` («lets hooks distinguish session is done from paused waiting for background work»); `Notification` trae `notification_type` con valores `permission_prompt`, `idle_prompt`, `elicitation_dialog`, `auth_success`.
- Coste de un gancho más: `node` + importar `session-log.mjs` + `git branch` -> 274, 287 y 301 ms en tres pasadas. Por eso no se añade `PreToolUse`: `PostToolBatch` ya está cableado y trae los nombres de herramienta.
- Cuánto calla una sesión viva: medido sobre los transcripts de `~/.claude/projects/C--dev-fabrica` y `C--dev-MenuPlan` (36 ficheros, 35 393 huecos entre una línea y la siguiente respuesta de máquina; script `huecos.mjs` en el scratchpad de esta sesión): p50 0,05 min, p99 2,7 min, p99,9 9,7 min; 17 huecos de más de 15 min, todos de MenuPlan, y los de más de 30 min terminan en un `tool_result` (parecen esperas de permiso; sin comprobar). Solo la Fábrica: máximo 10,1 min en 6 042 huecos.
- GitHub sin clave: `GET /repos/factory-am89/fabrica/pulls?state=all` trae `head.ref` (la rama) y `merged_at`; la cuota es 60 por hora y por IP (`X-RateLimit-Limit: 60`). La rama es la llave que une sesión y PR. La Fábrica no tiene issues (la API pública de issues solo devuelve PR).
- `entities.json` tiene la entidad `session` con `base: hueco, base_reason: sin-forja`; `fields.json` no declara ningún campo de `session` y `FIELD_SOURCES` (`scripts/lib/fields.mjs:69-76`) no la lee.

## De dónde sale cada dato

| Dato | Fuente | Cómo llega |
|---|---|---|
| Qué sesiones viven, su rama, su repo | gancho de sesión en el PC (ficha) | tarea de Windows cada minuto -> `POST /ingest/sesiones` |
| Qué hace ahora (`hace`, `objeto`) | `PostToolBatch` y `UserPromptSubmit` (ya cableados) | igual |
| Si espera a Pablo (`estado`) | `PermissionRequest`, `Stop`, `Notification` (decisión A) | igual |
| Sin señal | lo calcula el panel con la hora de la ficha y la del último envío | nada viaja |
| PR abierto, fusionado | GitHub, `pulls` de cada repo de `config/fabrica.json` | el panel lo lee, sin clave |
| Issue por hacer | GitHub, `issues` abiertos que no son PR | el panel lo lee, sin clave |

## Vocabulario cerrado

Un solo sitio: `session-states.json` de la Fábrica; el panel lo lee de GitHub como lee los demás ficheros.

- `estado` de una sesión: `trabajando` (columna en-curso), `espera-tarea` (Stop con `background_tasks` en marcha; en-curso), `espera-permiso` (PermissionRequest o Notification `permission_prompt`; bloqueado, urgente), `espera-decision` (Stop cuya última línea empieza por la marca `Te necesito:`; bloqueado, urgente), `espera-respuesta` (Stop sin marca ni tareas; bloqueado, aviso), `sin-senal` (solo lo escribe el panel; bloqueado, urgente), `sin-dato` (ficha con la forma vieja; bloqueado, neutro).
- `hace` (solo con `trabajando`): `pensando` (UserPromptSubmit), `editando` (Edit, Write, MultiEdit, NotebookEdit; objeto: ruta relativa al repo), `leyendo` (Read, Grep, Glob; objeto: ruta de Read o nada), `ejecutando` (Bash, PowerShell; objeto: clase de orden de la lista `tests`, `git`, `gh`, `npm`, `node`, `otra`, nunca el texto), `delegando` (Task o Agent; objeto: tipo de subagente), `web` (WebFetch, WebSearch; sin objeto), `otro` (cualquier otra; objeto: el nombre de la herramienta si cumple `^[\w:.-]{1,80}$`).
- Columnas de la pizarra: `por-hacer` (issue abierto sin PR ni sesión), `listo` (PR abierto sin sesión viva: espera a la puerta), `en-curso`, `bloqueado` (de la sesión), `hecho` (PR fusionado en los últimos 7 días). Si una rama tiene varias sesiones, gana la peor (bloqueado sobre en-curso).
- Nunca viaja: el texto de una orden, un prompt, un mensaje de Pablo, `tool_response`. Viaja como texto libre solo `pregunta` (la línea `Te necesito:` que escribe el agente, una línea de 200 caracteres como mucho, igual que `motivo` de `intervention-log.mjs`).

## Espera a Pablo y sesiones muertas

- Espera a Pablo = estado `espera-permiso`, `espera-decision` o `espera-respuesta`. Arriba del cockpit, una caja «Qué espera de ti», urgentes primero, con repo, rama, minutos y la `pregunta` si la hay.
- Una sesión muerta sin avisar no se queda en «En curso»: el panel pone `sin-senal` cuando un estado de trabajo lleva más de 15 min sin ficha nueva (p99,9 medido 9,7 min) o cualquier estado lleva más de `ACTIVA_H` (3 h, `session-log.mjs:11`). Si el último envío del PC tiene más de 3 min (la tarea corre cada minuto), sale un aviso de error «sin noticias del PC desde hh:mm (Madrid)» y todas las sesiones pasan a `sin-senal`. Es un aviso, no un borrado: la ficha la purga la Fábrica a las 48 h, como hoy.

## Chunks

### 1. (Panel) Circuito de punta a punta: el PC manda las sesiones y `/cockpit` las enseña con «sin señal» (HECHO: PR #8 de homenu-panel, merge `998b965`)
Files: `cliente/enviar-sesiones.mjs`, `cockpit.mjs`, `server.mjs`, `lib.mjs`, `Dockerfile`, `cockpit.test.js`, `panel.test.js`, `fixtures/fabrica-falsa/scripts/sesiones.mjs`
Depends on: none
Blocked by: none
Existing: `git -C C:/dev/homenu-panel grep -n -i "cockpit\|ingest/sesiones\|enviar-sesiones\|sin señal" origin/main` -> sin salida. Lo que se reutiliza: la forma de `POST /ingest/fabrica` y de `guardarInforme` (`server.mjs`), `banner` e `insignia` de `lib.mjs`, y `npm run sesiones -- --json` de la Fábrica, que ya existe (`scripts/sesiones.mjs:98-105`).
Not done: usa la ficha de hoy (rama, carpeta, minutos desde `ultima`), sin qué hace ni espera (trozos 4 a 8); con solo esos datos una sesión callada más de 15 min sale «sin señal (puede estar esperándote)», y el texto lo dice. El envío ejecuta `node <fabrica>/scripts/sesiones.mjs --json` de la carpeta principal de la Fábrica y manda su salida tal cual: la forma vive en la Fábrica, el panel la valida al recibir (422 si no). No instala la tarea (trozo 2). No quita el envío viejo ni sus rutas: es el trozo 10, que el mismo PR hizo a la vez. El aviso de PC callado y el umbral de 15 min viven en `cockpit.mjs`, un solo sitio. La página entra en `SECCIONES` (grupo «Trabajo») y `cockpit.mjs` en el `Dockerfile` (lo vigila `panel.test.js:135`).
Done:
```sh
node --test cockpit.test.js panel.test.js
```

### 2. (Panel) Tarea de Windows cada minuto que no traga el código de salida, instalada, y prueba en vivo por Tailscale
Files: `cliente/sesiones-oculto.vbs`, `cliente/instalar-tarea-sesiones.ps1`, `cliente-sesiones.test.js`, `README.md`
Depends on: 1
Blocked by: none
Existing: `Get-ScheduledTask -TaskName "HoMenu panel*"` -> solo `HoMenu panel - enviar fabrica`. `cliente/oculto.vbs` (borrado después por el PR #8, trozo 10) tragaba el código (`sh.Run orden, 0, True` sin `WScript.Quit`): 1340 fallos con `LastTaskResult 0`, medido arriba. Según Pablo (no consultado en el PC), la tarea vieja está deshabilitada a mano; este trozo no la toca.
Not done: el lanzador nuevo termina con `WScript.Quit sh.Run(...)`; el test lo comprueba con `cscript` y un `node` que sale 1, y se salta fuera de Windows (el CI de GitHub es Linux; esa parte solo la ve el PC). No toca el envío viejo (ya quitado, trozo 10). `PANEL_URL` es la dirección del servidor del panel por la red privada: la pone quien lanza la orden, y su valor no se escribe en el plan (skills `hetzner` y `tailscale`). Requiere el trozo 1 fusionado y desplegado con `desplegar.sh` antes de la segunda orden del Done. Registrar una tarea de usuario es reversible (`Unregister-ScheduledTask`) y no es de la lista cerrada: la registra el constructor y lo apunta en el PR.
Done:
```sh
node --test cliente-sesiones.test.js && node cliente/enviar-sesiones.mjs --fabrica C:/dev/fabrica --url "$PANEL_URL" && curl -s "$PANEL_URL/cockpit" | grep -q "data-sesion=" && powershell -NoProfile -Command "exit (Get-ScheduledTaskInfo -TaskName \"HoMenu panel - enviar sesiones\").LastTaskResult"
```

### 3. (Fábrica) La ficha de sesión se escribe sin dejar `.tmp` y la purga recoge los restos
Files: `scripts/lib/session-log.mjs`, `test/sesiones.test.js`
Depends on: none
Blocked by: none
Existing: 10 `.tmp` en `~/.fabrica/sesiones` (medido arriba; el 23 oct había 11). Fallo reproducido por su entrada real: 25 rondas de 8 procesos `node scripts/sesiones.mjs tocar` a la vez con el mismo `session_id` y una casa temporal, en Windows, contra el código de `origin/main` -> 200 procesos, 14 con salida distinta de 0 y 14 `.tmp` que quedan; con el cambio del PR #150 -> 0 y 0 (una pasada por lado; el guion vive en el scratchpad de la sesión, no en el repo). Quién escribe en esa carpeta (`git grep -n -E "apuntarSesion|purgarViejas|quitarSesion" origin/main -- scripts` y `.claude/settings.json`): `sesiones.mjs tocar` (`UserPromptSubmit`, `PostToolBatch`), `sesiones.mjs fin` (`SessionEnd`) y el arranque (`al-arrancar.mjs` -> `pasoSesiones`: registra y purga); `~/.claude/hooks` no la toca. `apuntarSesion` escribe `<id>.<pid>.tmp` y renombra (`session-log.mjs:59-61`) y `purgarViejas` solo mira `.json` (`session-log.mjs:93,108-112`). `git grep -n "\.tmp" origin/main -- test/sesiones.test.js` -> sin salida.
Not done: clase: una escritura atómica que deja restos cuando el renombrado falla. Reintenta el renombrado ante `EPERM` o `EBUSY` un número fijo de veces, borra su `.tmp` si al final falla y lanza (el gancho sale 1, como hoy: se ve). La purga borra `.tmp` de más de `CADUCA_H`. No cambia la forma de la ficha (trozo 4). El estrés reproduce el síntoma (salida 1 y `.tmp` huérfano), pero no prueba que los 10 restos de octubre vengan de ahí y no de un proceso cortado.
Done:
```sh
node --test test/sesiones.test.js
```

### 4. (Fábrica) Vocabulario cerrado y la ficha dice qué hace la sesión
Files: `session-states.json`, `scripts/lib/session-log.mjs`, `scripts/sesiones.mjs`, `test/sesiones.test.js`, `fields.json`, `scripts/lib/fields.mjs`
Depends on: 3
Blocked by: none
Existing: `git grep -n -i "session-states\|espera-permiso" origin/main` -> sin salida; los `CAMPOS` de la ficha son cinco (`session-log.mjs:13`) y `validarFicha` exige exactamente esos (`session-log.mjs:32`); `tocar` ignora `tool_calls` (`scripts/sesiones.mjs:74-91`).
Not done: campos nuevos de `session`: `estado` (enum; comparado con `intervention.clase`, otro significado: nueva, sin-equivalente), `hace` (enum, nueva), `objeto` (texto corto con forma comprobada, nueva), `desde` (fecha del último cambio de estado; mismo tipo que `intervention.t` y otro significado: nueva), `pregunta` (texto de una línea; nueva). Se declaran también los cinco de hoy y `session` entra en `FIELD_SOURCES`, que hoy no la lee. Una ficha con la forma vieja se lee como `sin-dato`, no como rota: las sesiones abiertas antes del cambio no ponen en rojo el arranque. Solo escribe `trabajando` (`PostToolBatch` con la última herramienta del lote, y `UserPromptSubmit` -> `pensando`); los estados de espera son el trozo 6. `entities.json` no se toca (la base de `session` sigue `hueco`; otra pregunta). Sin `PreToolUse`: se ve lo último que terminó, no lo que empieza (un `npm test` largo se ve al acabar).
Done:
```sh
node --test test/sesiones.test.js test/fields.test.js
```

### 5. (Fábrica) `npm run sesiones -- --json` dice el repo de cada sesión
Files: `scripts/sesiones.mjs`, `test/sesiones.test.js`, `scripts/lib/folders.mjs`, `fields.json`
Depends on: 4
Blocked by: none
Existing: `listado` devuelve carpeta y rama, no repo (`scripts/sesiones.mjs:98-105`); `scripts/lib/folders.mjs` tiene `git` y `tieneOrigin` pero nada que saque `owner/name` de una URL (`grep -n export scripts/lib/folders.mjs`).
Not done: campo nuevo `repo` de `session` (atributo, texto `owner/name` o `null`; nueva, sin equivalente: `grep -n "\"repo\"" fields.json` -> sin salida, y `carpeta` es otro significado, una ruta local y no el repo remoto), declarado en `fields.json` junto a los del trozo 4. El repo sale de `git remote get-url origin` de la carpeta al listar (una vez por sesión y por minuto, no en cada gancho); sin `origin`, `repo: null` y el panel lo enseña como «sin repo», nunca un valor inventado. La carpeta sigue en la salida local; el panel no la enseña.
Done:
```sh
node --test test/sesiones.test.js
```

### 6. (Fábrica) Estados de espera: `Stop`, `PermissionRequest` y `Notification` marcan la ficha
Files: `.claude/settings.json`, `scripts/sesiones.mjs`, `test/sesiones.test.js`
Depends on: 5
Blocked by: A
Existing: `PermissionRequest` y `Stop` hoy solo llaman a `intervenciones.mjs` (`.claude/settings.json`); `EVENTOS_TOCAR` admite solo `UserPromptSubmit` y `PostToolBatch` (`scripts/sesiones.mjs:72`) y rechaza cualquier otro. `git grep -n "Notification" origin/main -- .claude/settings.json` -> sin salida.
Not done: `PermissionRequest` y `Notification` de tipo `permission_prompt` -> `espera-permiso`; los demás tipos de `Notification` se ignoran a propósito. `Stop` -> `espera-tarea` si `background_tasks` trae alguna en marcha, `espera-decision` si la última línea de `last_assistant_message` empieza por la marca de `session-states.json` (guarda esa línea como `pregunta`, recortada a 200), y si no `espera-respuesta`. Un `Stop` de subagente (`agent_id`) no cambia el estado. Nada más del mensaje se guarda. El test de `test/sesiones.test.js:256` que lee `settings.json` se amplía con los tres eventos. No toca `GATE_FILES`: ningún check de la puerta cambia. Si rompe main: revertir el PR desde una rama nueva.
Done:
```sh
node --test test/sesiones.test.js
```

### 7. (Fábrica) La marca `Te necesito:` en «Cómo responder a Pablo», leída de `session-states.json`
Files: `usuario/CLAUDE.md`, `test/session-states.test.js`
Depends on: 6
Blocked by: none
Existing: `usuario/CLAUDE.md:46` dice «Si necesitas algo de él, al final y en una línea», sin forma que una máquina lea. `git grep -n "Te necesito" origin/main` -> sin salida.
Not done: lector de la regla: el gancho `Stop` del trozo 6; disparador: `hook`, en cada fin de turno. El test nuevo comprueba que `usuario/CLAUDE.md` cita la marca exacta de `session-states.json` (un sitio, el otro la enlaza). Que los agentes la usen no lo comprueba nadie: si la olvidan, la sesión sale como `espera-respuesta` (sigue en «Qué espera de ti», sin la pregunta), así que el fallo se ve. La cifra de uso (cuántos `Stop` son `espera-decision` frente a `espera-respuesta`) queda para después. No toca la skill `estilo-de-respuesta` de MenuPlan.
Done:
```sh
node --test test/session-states.test.js
```

### 8. (Panel) Bocadillo de cada sesión y caja «Qué espera de ti» con el vocabulario de la Fábrica
Files: `cockpit.mjs`, `server.mjs`, `cockpit.test.js`, `config/fabrica.json`
Depends on: 1, 4, 10
Blocked by: none
Existing: tras el trozo 1, `cockpit.mjs` solo enseña rama y minutos. `git -C C:/dev/homenu-panel grep -n "session-states" origin/main` -> sin salida.
Not done: lee `session-states.json` de la rama `main` de la Fábrica con `texto(...)` y la caché que ya existe (`server.mjs:79-95`); un valor que no está en el vocabulario sale como error visible en la tarjeta, nunca neutro en silencio. Urgente -> insignia `error`, aviso -> `aviso` (tonos de `estilo.mjs`, sin colores nuevos). Bocadillo «Editando · scripts/x.mjs», «Ejecutando · tests», «Necesito: <pregunta>». Antes del trozo 6 ninguna ficha trae un estado de espera, y la caja dice «Sin datos de espera: falta la decisión A» en vez de «nada te espera». Sin resultados («12/12 en verde», «HTTP 401»): no hay dato de resultado (duda 3 del informe).
Done:
```sh
node --test cockpit.test.js
```

### 9. (Panel) La pizarra: encargos de GitHub unidos por rama con las sesiones
Files: `cockpit.mjs`, `server.mjs`, `cockpit.test.js`, `config/fabrica.json`
Depends on: 5, 8
Blocked by: none
Existing: el panel lee issues de MenuPlan (`leerIssues`, `server.mjs:55-77`), no PR ni ramas; `git -C C:/dev/homenu-panel grep -n "pulls" origin/main` -> sin salida.
Not done: `config/fabrica.json` gana `cockpit.repos` (hoy `factory-am89/fabrica` y `factory-am89/homenu-panel`); por repo, `pulls?state=all&per_page=50` e `issues?state=open` cada 10 min con `If-None-Match` (un 304 no gasta cuota según GitHub; sin comprobar aquí): 24 peticiones por hora como mucho. Un fallo de GitHub sale como aviso de error encima de la pizarra con la hora del último dato bueno, nunca columnas vacías. Las sesiones en `main` (coordinadoras en la carpeta principal) salen en la fila de agentes y no en la pizarra. No une issue y rama (un PR que dice `Closes #n` puede salir dos veces: duda 2 del informe). No mira checks ni el «no» del revisor (una petición más por PR).
Done:
```sh
node --test cockpit.test.js
```

### 10. (Panel) Quitar el envío viejo y las rutas que sobraban (HECHO: PR #8 de homenu-panel, merge `998b965`)
Files: `cliente/enviar-fabrica.mjs`, `cliente/instalar-tarea.ps1`, `cliente/oculto.vbs`, `server.mjs`, `lib.mjs`, `panel.test.js`
Depends on: 1
Blocked by: none
Existing: antes del PR #8 los tres ficheros de `cliente/` existían y `server.mjs` tenía `/ingest/fabrica`, `/coste` y `/fondos`. Hoy: `git -C C:/dev/homenu-panel ls-tree -r --name-only origin/main | grep -E "enviar-fabrica|oculto|instalar-tarea"` -> sin salida; `git -C C:/dev/homenu-panel grep -n -E "ingest/fabrica|/coste|/fondos" origin/main -- server.mjs` -> sin salida.
Not done: la tarea de Windows `HoMenu panel - enviar fabrica` la deshabilitó Pablo a mano el 23 oct 2026, según él (no consultado en el PC); ningún trozo la toca ni la borra del registro de tareas. Quitar `/coste`, `/fondos` y `/ingest/fabrica` con su código fue decisión de Pablo, no del plan. No arregla el envío viejo: se quita (clase: un lanzador que traga el código de salida; no se repetirá en el trozo 2). Lo construyó el mismo PR que el trozo 1 porque comparten `server.mjs` y `lib.mjs`.
Done:
```sh
test -z "$(git -C C:/dev/homenu-panel ls-tree -r --name-only origin/main | grep -E 'enviar-fabrica|oculto|instalar-tarea')" && ! git -C C:/dev/homenu-panel grep -q -E 'ingest/fabrica|/coste|/fondos' origin/main -- server.mjs && node --test panel.test.js cockpit.test.js
```
Rojo antes, medido en el padre del PR (`998b965~1`): `ls-tree` lista `cliente/enviar-fabrica.mjs`, `cliente/instalar-tarea.ps1` y `cliente/oculto.vbs`, y `git grep -c -E "ingest/fabrica|/coste|/fondos" 998b965~1 -- server.mjs` -> `4`. Verde después: las dos primeras órdenes salen 0 sobre `origin/main`.

## Build order
Ola 1 (hecha el 1 y el 10 en un solo PR; el 3 sigue): 1, 10 y 3 a la vez (repos distintos). Ola 2: 2 (tras desplegar el 1) y 4. Ola 3: 5 y 8. Ola 4: 9; y 6 en cuanto Pablo conteste A, luego 7. El 1 prueba el circuito: su test corre el envío real contra el servidor real en local; el Done del 2 lo prueba por Tailscale con las sesiones de verdad.

## Decisions taken
- principio 4 | eligió: el vocabulario de estados, de qué hace y de columnas vive en session-states.json de la Fábrica y el panel lo lee de GitHub | descartó: una copia de la lista en lib.mjs del panel | motivo: decidido
- principio 4 | eligió: el estado en vivo son campos nuevos de la ficha de sesión que ya existe | descartó: un registro aparte de eventos en ~/.fabrica | motivo: decidido
- principio 3 | eligió: el panel calcula sin-senal con 15 min de silencio en trabajo, 3 h en cualquier estado y 3 min sin envío del PC | descartó: dejar la última ficha como En curso hasta que la purga de 48 h la borre | motivo: decidido
- principio 2 | eligió: umbral de 15 min sacado de 35 393 huecos medidos con p99,9 de 9,7 min | descartó: un umbral redondo sin medir como 5 o 60 min | motivo: decidido
- principio 3 | eligió: el lanzador de la tarea devuelve el código de node y el panel enseña la edad del último envío | descartó: copiar oculto.vbs, que da LastTaskResult 0 con 1340 fallos | motivo: decidido
- principio 6 | eligió: envío por la red privada al servidor del panel, con la forma que tenía /ingest/fabrica | descartó: un token compartido nuevo entre PC y servidor, que sería un secreto nuevo y obliga a preguntar a Pablo (clase «Change permissions or secrets» de standards/intervention.md) | motivo: decidido
- principio 4 | eligió: listo significa PR abierto sin sesión viva, esperando a tests y revisor, dato que ya está en GitHub | descartó: listo como trozo de plan desbloqueado, que obliga al panel a leer y interpretar los planes, otra copia de qué está listo además de los PR | motivo: decidido
- principio 4 | eligió: la rama es la llave del encargo entre ficha y PR | descartó: un número de issue escrito por cada sesión | motivo: decidido
- principio 5 | eligió: solo viajan vocabulario cerrado, rutas relativas al repo y la línea de pregunta del agente, y el panel lo valida al recibir (422 si no encaja) | descartó: mandar el texto de la orden o el último mensaje del agente y confiar en que nadie ponga un secreto, una regla en una frase sin check | motivo: decidido
- principio 4 | eligió: qué hace sale de PostToolBatch, ya cableado, que trae los nombres de herramienta | descartó: un gancho PreToolUse nuevo que repetiría ese mismo dato en otro gancho (y suma unos 0,3 s por herramienta, medidos arriba) | motivo: decidido
- principio 3 | eligió: el trozo 10 quita el envío viejo del panel (cliente/enviar-fabrica.mjs, instalar-tarea.ps1, oculto.vbs), por decisión de Pablo del 23 oct 2026, y él deshabilitó su tarea de Windows a mano | descartó: dejar el envío roto en silencio (1340 fallos con LastTaskResult 0) | motivo: decidido
- principio 4 | eligió: quitar el envío viejo porque el nuevo cubre su función (decisión de Pablo, 23 oct 2026, que de paso quitó /coste, /fondos y /ingest/fabrica) | descartó: arreglar enviar-fabrica y mantener dos envíos PC -> panel | motivo: decidido

## Decisions for Pablo

### A. ¿Dejas que tres avisos más de cada sesión (pide permiso, termina su turno, notifica) apunten su estado para el cockpit?
Por qué te lo pregunto: es cambiar `.claude/settings.json`, que pone en marcha cosas solas en cada sesión y está en la lista cerrada. Sin esto el cockpit no sabe cuándo una sesión te espera, que es lo que más te importa.
1. Sí, solo en las sesiones de la Fábrica: se ve qué te espera en las carpetas `C:\dev\fabrica-*`; las de MenuPlan y homenu-panel no salen (recommended)
2. Sí, en todas las sesiones del PC: también MenuPlan y homenu-panel, pero cada proyecto ejecutaría código de `C:\dev\fabrica` en sus avisos
3. No: el cockpit enseña qué hizo cada sesión y si lleva rato callada, pero nunca «te espera»

## Not verified
- La forma de entrada de los ganchos se leyó del binario de Claude Code 2.1.309 (`grep -a` sobre `claude.exe`), no de la documentación; una versión nueva puede cambiarla.
- Que los 17 huecos de más de 15 min sean esperas de permiso: solo se ve que terminan en un `tool_result`. La muestra son 36 transcripts de 2 carpetas; no hay carpetas `C--dev-fabrica-*` en `~/.claude/projects`.
- Que los 10 `.tmp` de octubre vengan de un renombrado fallido y no de un proceso cortado (el estrés reproduce el síntoma, no el origen de esos ficheros).
- Que la tarea de Windows `HoMenu panel - enviar fabrica` esté deshabilitada: lo dice Pablo; no se consultó con `Get-ScheduledTask` en el PC.
- Quién despliega el panel (`desplegar.sh` en `/opt/panel/app` por ssh) y de qué rama tira el servidor; el Done del trozo 2 lo necesita.
- La cuota de GitHub que ya gasta el panel (`leerIssues` hasta 20 peticiones cada 15 min) sumada a las 24 por hora del trozo 9: no medida en el servidor.
- `gh` no tiene sesión en este PC (`gh auth status` -> «You are not logged into any GitHub hosts»): el plan no está en un issue; la API pública se leyó con `curl`.
- La carpeta principal de homenu-panel va 5 commits por detrás de `origin/main`; todo se leyó de `origin/main` (`61a82c8`).
- Que una tarea de Windows de usuario se registre sin ser administrador: la de `enviar-fabrica` existe, pero no sé quién la registró.
