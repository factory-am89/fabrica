# Plan: puente 2, Álvaro usa la Fábrica de Pablo para trabajar en HoMenu desde su PC

Verdict: viable sin dar a Álvaro ninguna clave de Pablo, pero no tal como se pidió: la clave del constructor tiene más alcance que HoMenu; Álvaro necesita su propia identidad, su propia capa personal y una regla de anulación de «cuatro ojos».

Fecha: 29 oct 2026. Base leída: Fábrica en `b2a011e` (main); MenuPlan en `origin/staging` = `5afd0908` (leído con `git show origin/staging:<ruta>`). Cada trozo dice en el título en qué repo se construye; sus `Files` son relativos a ese repo. Fuera de este plan: mudar HoMenu a una org neutral (memoria «HoMenu en org neutral», pendiente de hablar), que Álvaro pueda fusionar `main` de HoMenu (ruleset «main: solo Pablo fusiona»). El puente 1 está cerrado (ver «Estado medido»); lo que le queda (borrar la deploy key de `mercadona-sync`) no bloquea nada de aquí.

## Lo desagradable primero

- **La clave del constructor no se puede repartir.** Su alcance es mayor que el trabajo de HoMenu. Clase del riesgo: una credencial con más alcance que el trabajo que se le encarga. Por eso Álvaro necesita su propia identidad.
- **Ninguna clave de Pablo sale de su PC:** las sesiones de Álvaro usan solo credenciales suyas.
- **Meter a Álvaro en la org le enseña lo privado de Pablo.** El permiso base de la org es de lectura (`gh api orgs/factory-am89 --jq .default_repository_permission` -> `read`), y un miembro leería el repo privado de configuración. Además no hace falta: `fabrica` es público (`gh api orgs/factory-am89/repos`), y para HoMenu basta su permiso `write` en MenuPlan (`gh api repos/pabloam89/MenuPlan/collaborators` -> `algbarc-design write`).
- **Instalar la capa de usuario pisaría la configuración que Álvaro ya tiene.** `install-pc instalar` sobrescribe un `~/.claude/CLAUDE.md` o `settings.json` distinto aunque no lo haya instalado él (`scripts/install-pc.mjs:96` lo marca `editado-a-mano` y el bucle de la línea 158 lo escribe). Lo comprueba `test/install-pc.test.js:55` («reinstalar sobrescribe lo editado»). En el PC de Álvaro, que ya usa Claude Code con HoMenu, borraría sus ajustes sin avisar.
- **Hoy las sesiones de Álvaro le hablarían como a Pablo.** `usuario/CLAUDE.md` se titula «Reglas de Pablo», da la hora «de Pablo» y apunta a la ruta fija de los hooks de Pablo en su carpeta de usuario (`usuario/CLAUDE.md:1,11,21` y la hora, líneas 26 a 28). La lista cerrada y el principio 6 dicen «Pablo» (`standards/intervention.md:26`, `CLAUDE.md:4`).
- **Si Álvaro puede anular al juez con un Approve, hay que impedir que se juzgue a sí mismo.** La anulación solo mira el login de quien aprueba (`aprobacionDePablo`, `scripts/veredicto.mjs:126`) y no sabe quién lanzó el PR; la regla de cuatro ojos del trozo 6 lo añade.
- **El juez gasta la suscripción del dueño del token.** El revisor de HoMenu corre con el `CLAUDE_CODE_OAUTH_TOKEN` de su environment `revisor` (`gh api repos/pabloam89/MenuPlan/environments/revisor/secrets` lo lista). Más sesiones son más juicios. No sé de quién es ese token (ver Not verified).

## Estado medido

- Puente 1: CERRADO (comprobado el 29 oct 2026). `.fabrica.json` (`{ "repo": "pabloam89/MenuPlan", "base": "staging", "identidad": "fabrica-constructor" }`), `revisor.yml` (`bots: homenu-sesiones,homenu-dependabot-merge`, `revisor-app-slug: homenu-revisor`), `anulacion.yml` y `senal-review.yml` están en `staging` (`git ls-tree --name-only origin/staging .github/workflows/`). El ruleset de `staging` exige PR, `tests` y `revisor`, es `strict` y no tiene excepciones; `allow_auto_merge` es `true` (`gh api repos/pabloam89/MenuPlan`, `.../rulesets`); MenuPlan#996 se fusionó sola. Por tanto el juez ya es obligatorio para cualquier PR a `staging`, también para los de Álvaro. El `anulacion.yml` de `staging` hoy solo pasa `revisor-app-slug`: la entrada de dueños del trozo 6 aún no existe.
- Apps: `curl https://api.github.com/apps/<slug>` -> `fabrica-constructor 200` (pública), `fabrica-revisor 404`, `fabrica-administrador 404`, `homenu-sesiones 200`. `homenu-revisor` (App ID 5521568) existe y da 404 porque es privada, no porque falte; juzga PR reales de MenuPlan (el ruleset exige su check y MenuPlan#996 pasó por él). `fabrica-constructor` está instalada solo en MenuPlan en la cuenta `pabloam89` (además de la instalación de `factory-am89`, que abarca todos sus repos; la API pide el JWT de la App y no lo comprobé con `gh`: dato de `PASOS-PABLO.md`).
- Org factory-am89: plan `free`, un solo miembro (`gh api orgs/factory-am89/members` -> `pabloam89`), `members_can_create_repositories: true`.
- Identidad: el mapa `IDENTIDADES` tiene dos entradas, `fabrica-constructor` y `ninguna` (`scripts/lib/identities.mjs:12-16`). La App, el documento y la bóveda de la clave están fijos en `token.mjs` (`CLIENT_ID_CONSTRUCTOR` en `scripts/lib/repo.mjs:7`; `DOCUMENTO_CLAVE = 'fabrica-constructor.pem'` en `scripts/token.mjs:134`; la bóveda, `OP_VAULT` en `scripts/token.mjs:176`). La identidad es del repo (campo `identidad` de la ficha), no de la persona (`scripts/lib/repo-card.mjs:11`). `git grep -n "FABRICA_IDENTIDAD"` -> sin salida.
- La caché del token solo sirve para el dueño de `REPO` (`scripts/token.mjs`, `mismoDueno`): en MenuPlan, cada token lee 1Password (tope de 60 lecturas por hora, `scripts/token.mjs:152`).
- Capa de usuario: `usuario/settings.json` ya es plantilla con huecos (`{{home}}`, `{{enabledPlugins}}`, `{{autoMode.*}}`). Los valores se leen de `FABRICA_VALORES` o de un fichero privado junto a la Fábrica (`scripts/install-pc.mjs:12,58`): Álvaro puede tener su propio fichero sin acceder al de Pablo. `usuario/CLAUDE.md` se copia tal cual.
- Rutas fijas (búsqueda con `git grep -n -i` de la carpeta de usuario de Pablo y de `C:/dev`, fuera de `plans/` y `test/`): `usuario/CLAUDE.md:5,8,11,21`, `apps/arranque.ps1:14` (solo el arranque de Pablo), y comentarios en `scripts/tarea.mjs:1`, `scripts/lib/folders.mjs:20,50`, `scripts/install-pc.mjs:12` y `.claude/hooks/carpeta-principal.mjs:1`. El código calcula las carpetas como hermanas de la principal (`scripts/lib/folders.mjs:50`), sin exigir `C:/dev`. Los hooks del proyecto usan `$CLAUDE_PROJECT_DIR` (`.claude/settings.json`) y los registros van a `~/.fabrica/` con `homedir()` (`scripts/lib/gh-log.mjs:14`, `op-log.mjs:8`, `intervention-log.mjs:49`, `session-log.mjs:25`). El hook de usuario `limpiar-worktrees.mjs` sale sin hacer nada en un repo con ficha (`usuario/hooks/limpiar-worktrees.mjs:364`). `scripts/madrid-time.mjs:7` imprime «Hora local de Pablo (Madrid)» en cada arranque.
- 1Password: la puerta está cerrada por un check. `scripts/lib/op-door.mjs` (`PUERTAS`) lista quién puede llamar a `op` o al llavero, y `test/op-door.test.js` falla si alguien más lo hace. El token de la cuenta de servicio sale del entorno o de la entrada del llavero «Fabrica 1Password» (`apps/llavero.json`, `scripts/token.mjs:82-93`). Solo la guarda `apps/arranque.ps1`, que además crea Apps, environments y el ruleset con la sesión de `gh` de quien lo lanza: no sirve para Álvaro.
- HoMenu ya prevé a Álvaro: «en otro PC, `gh` y `git` van con la cuenta de quien está delante» (`CLAUDE.md:45` de MenuPlan). Sus sesiones toman la clave de `homenu-sesiones` de la bóveda de HoMenu (`scripts/lib/env.mjs:116` y skill `1password` de MenuPlan).

## Chunks

### 1. (Fábrica) La identidad la elige la persona: `FABRICA_IDENTIDAD` y cada identidad trae su App, su documento y su bóveda
Files: `scripts/lib/identities.mjs`, `scripts/token.mjs`, `scripts/lib/repo-card.mjs`, `test/identidad-activa.test.js`
Depends on: none
Blocked by: A
Existing: `git grep -n "FABRICA_IDENTIDAD"` -> sin salida; `ls test | grep -i identidad-activa` -> sin salida. El cliente, el documento y la bóveda están fijos en `scripts/token.mjs:134,176` y en `CLIENT_ID_CONSTRUCTOR` (`scripts/lib/repo.mjs:7`), y solo `FABRICA_CONSTRUCTOR_CLIENT_ID` y `OP_VAULT` los cambian, por separado. Campos: `clientId`, `documento` y `boveda` son claves de la constante de código `IDENTIDADES`, no campos de entidad. `git grep -n -i -E "identidad|clientId|boveda|persona" -- fields.json entities.json` -> sin salida: ninguna fila equivalente que reutilizar.
Not done: una sola variable de entorno por PC, `FABRICA_IDENTIDAD`. Una función `identidadActiva(env, ficha)` en `identities.mjs` es su único lector y la usan `token.mjs` y `leerFicha`. Sin variable vale la de la ficha, como hoy. Si la variable nombra una identidad que no existe o cuyo dueño no es el del repo, falla en alto. No añade la identidad de Álvaro (trozo 2) ni caché por dueño: el tope de 60 lecturas por hora sigue y se mide con `npm run op-reads`. En la Fábrica y en el PC de Pablo nada cambia. Con A = 3 no se construye. Lector: `token.mjs` y `leerFicha`; disparador: `manual` (la persona lo activa al fijar la variable en su PC), declarado como deuda: no hay otro disparador para un ajuste por PC (entrada real: `node scripts/token.mjs -- node -e ...` con un `op` falso, como `test/token-cache.test.js`).
Done:
```sh
node --test test/identidad-activa.test.js test/identidades-dueno.test.js test/token-clientid.test.js test/token-cache.test.js test/op-door.test.js
```

### 2. (Fábrica) La identidad de Álvaro en el mapa
Files: `scripts/lib/identities.mjs`, `test/identidades-dueno.test.js`
Depends on: 1
Blocked by: A
Existing: `IDENTIDADES` solo tiene `fabrica-constructor` y `ninguna` (`scripts/lib/identities.mjs:12-16`). La App de Álvaro aún no existe (paso 2 de Álvaro).
Not done: una entrada con el slug y el client id que Álvaro dé (no es secreto), dueño solo `pabloam89` (GitHub la limita además a MenuPlan por su instalación) y `borraRemotas: true`. Su nombre no se pone en `REPO` ni en `OWNER_LOGIN`. Con A = 2 la entrada es `cuenta-propia`: un lanzador que corre `gh` y `git` tal cual, con `duenos` solo `pabloam89`. Con A = 3 no se construye.
Done:
```sh
node --test test/identidades-dueno.test.js test/identidad-activa.test.js
```
Falla antes: el caso nuevo de `test/identidades-dueno.test.js` (la entrada de Álvaro con dueño solo `pabloam89`) falla porque la identidad no existe en el mapa.

### 3. (Fábrica) `install-pc` no pisa un fichero que no instaló él
Files: `scripts/install-pc.mjs`, `test/install-pc.test.js`
Depends on: none
Blocked by: none
Existing: `scripts/install-pc.mjs:96` da `editado-a-mano` tanto a un fichero tocado tras instalar como a uno que nunca se instaló (sin huella), y los dos se sobrescriben (`test/install-pc.test.js:55`). En lo leído de `install-pc.mjs` (líneas 84-97) no hay ningún estado para un fichero sin huella.
Not done: clase: una instalación que borra en silencio lo que no es suyo. Estado nuevo `ajeno` (el fichero existe, difiere y la huella no lo tiene). `instalar` no escribe nada y sale con 1 nombrándolo, salvo con `--reemplazar`, que antes guarda una copia `<fichero>.antes-de-fabrica`. Lo de después de instalar sigue igual (lo exige el test de la línea 55). La reproducción (un `home` con `CLAUDE.md` propio y sin huella; `node scripts/install-pc.mjs instalar` hoy lo escribe y después sale con 1 sin tocarlo) es el test nuevo, que se ve fallar antes. Quién más escribe en `~/.claude`: Claude Code y el propio usuario (no se tocan); `git grep -n -l "[.]claude" -- scripts` nombra 14 ficheros, casi todos por la carpeta `.claude/` del repo, y `install-pc.mjs` es el único que instala la capa de usuario. Lector: `install-pc`; disparador: `manual` (lo lanza la persona), declarado como deuda: no hay otro disparador para instalar un PC.
Done:
```sh
node --test test/install-pc.test.js test/usuario-settings.test.js
```

### 4. (Fábrica) Capa de usuario común y capa personal: `usuario/CLAUDE.md` sin «Pablo» y `usuario/personas/<login>.md`
Files: `usuario/CLAUDE.md`, `usuario/personas/pabloam89.md`, `scripts/install-pc.mjs`, `scripts/madrid-time.mjs`, `test/install-pc-persona.test.js`
Depends on: 3
Blocked by: none
Existing: `ls usuario` -> `CLAUDE.md hooks settings.json settings.motivos.json tls`, sin `personas/`; `git grep -n "personas/\|persona.md"` -> sin salida; `ls test | grep persona` -> sin salida.
Not done: `install-pc` instala en `~/.claude/CLAUDE.md` la parte común seguida de `usuario/personas/<persona>.md`, y `<persona>` es el valor `persona` del fichero de valores de cada uno. Las dos se unen al instalar (no con un `@import`, que no he probado en esta versión de Claude Code). Lo común sale de `usuario/CLAUDE.md`: dónde se trabaja (con `~/.claude/hooks/...` en vez de la ruta de Pablo), borrar carpetas, pensar en datos y tests. Lo personal va a `pabloam89.md`: nombre, Madrid, cómo responderle. `madrid-time.mjs` deja de decir «de Pablo». Lector: la instalación de cada PC (`install-pc` al instalar); disparador: `manual` (lo lanza la persona), declarado como deuda. `valores.json` gana una clave (`persona`); `git grep -n -i "persona" -- fields.json entities.json` -> sin salida: ninguna fila equivalente que reutilizar (se vuelve a lanzar al construir). El fichero de Álvaro lo escribe él (paso 4 de Álvaro) en un PR suyo. No cambia el puntero de `CLAUDE.md:4` ni el de `standards/intervention.md:26` (trozo 5, ruta cerrada).
Done:
```sh
node --test test/install-pc-persona.test.js test/install-pc.test.js
```

### 5. (Fábrica) Quién contesta el residuo: «el dueño del repo» en vez de «Pablo», en la lista cerrada y en el principio 6
Files: `CLAUDE.md`, `standards/intervention.md`, `test/principles-and-roles.test.js`
Depends on: 4
Blocked by: B, C
Existing: `CLAUDE.md:4` y `standards/intervention.md:26` apuntan a `usuario/CLAUDE.md`, «Cómo responder a Pablo». `git grep -n -i "lvaro\|algbarc" -- CLAUDE.md standards PASOS-PABLO.md intervenciones.md` -> sin salida.
Not done: según B = 1: en la Fábrica (su gate, sus Apps, su bóveda, sus permisos) solo responde Pablo. En HoMenu responde cualquiera de los dos dueños, salvo en lo que solo puede hacer el admin de GitHub (Pablo). Los punteros pasan a `usuario/personas/`. No toca el bloque `closed-paths` (lo lee `scripts/lib/intervention.mjs`, que es puerta) ni `intervenciones.md`, que sigue sin columna «quién». Lector: las sesiones, al arrancar; disparador: `arranque`. C13: no afloja ningún check; si rompe, se revierte el PR desde una rama nueva.
Done:
```sh
node --test test/principles-and-roles.test.js test/contrato.test.js && ! git grep -q "Cómo responder a Pablo" -- CLAUDE.md standards/intervention.md
```

### 6. (Fábrica) Anulación con varios dueños por repo y nunca sobre el trabajo propio
Files: `scripts/veredicto.mjs`, `scripts/lib/record.mjs`, `.github/workflows/anulacion.yml`, `test/anulacion.test.js`, `test/anulacion-duenos.test.js`
Depends on: none
Blocked by: B, C
Existing: `ls test | grep -i anulacion-duenos` -> sin salida (el test nuevo no existe); `git grep -n -i "duenos" -- fields.json entities.json` -> sin salida (el `duenos` de cada identidad es una clave de `IDENTIDADES`, `scripts/lib/identities.mjs:13`; la entrada de `workflow_call` reutiliza el nombre para otra cosa: logins por repo). `aprobacionDePablo(reviews, cabeza, dueno = OWNER_LOGIN)` acepta un solo login (`scripts/veredicto.mjs:126`); `anulacion.yml` en `workflow_call` solo recibe `revisor-app-slug` (líneas 25-37). `grep -n "duenos" .github/workflows/anulacion.yml` -> sin salida.
Not done: entrada opcional `duenos` de `workflow_call`: cada dueño con su login y la lista de Apps que lanzan sus sesiones (p. ej. `pabloam89:fabrica-constructor,algbarc-design:<App de Álvaro>`). Una aprobación solo cuenta si su autor está en la lista, si es su última review decisiva sobre la cabeza actual y si el autor del PR no es una de sus propias Apps. Sin la entrada (la propia Fábrica) todo sigue igual, con `OWNER_LOGIN` y sin la regla nueva. El título «override by Pablo» (`scripts/lib/record.mjs:13`) pasa a nombrar al dueño que anula. `node scripts/records.mjs` lo sigue contando como `overrides`. `OWNER_LOGIN` también es dueño de repo en `identities.mjs:13`: no se separa aquí. Es puerta: amplía quién anula, solo en el repo que lo pide, y añade una condición. Las tres de hoy siguen, y `test/anulacion.test.js` sigue en rojo si se quita alguna (C13). Si rompe, se revierte desde una rama nueva. Lector: `veredicto.mjs` (MODO=anulacion); disparador: `ci-judge`.
Done:
```sh
node --test test/anulacion-duenos.test.js test/anulacion.test.js test/workflows.test.js test/gate-files.test.js test/revisor-pendiente.test.js
```

### 7. (MenuPlan) `revisor.yml` acepta la App de Álvaro
Files: `.github/workflows/revisor.yml`, `ops/revisor-fabrica.test.js`, `ops/revisor-bots.test.js`
Depends on: 2
Blocked by: A, C
Existing: `git show origin/staging:.github/workflows/revisor.yml` -> `bots: homenu-sesiones,homenu-dependabot-merge`, sin la de Álvaro; `ops/revisor-fabrica.test.js` ya existe y `ops/revisor-bots.test.js` no (`git ls-tree --name-only origin/staging ops/ | grep -c revisor-bots` -> `0`).
Not done: solo añade el slug a `bots`; su caso va en `ops/revisor-bots.test.js` (fichero nuevo, que falla sin el slug). Con A = 2 no hace falta: un PR de una persona con `write` no pasa por `allowed_bots` (no lo he probado; ver Not verified). Es puerta de HoMenu: amplía quién despierta al juez y no quita ninguna pregunta (C13). Si rompe, se revierte desde una rama nueva. Lleva `Jueces: …, seguridad` (`CLAUDE.md:32` de MenuPlan). Lector: el juez reutilizable; disparador: `ci-judge`.
Done:
```sh
npx vitest run ops/revisor-bots.test.js ops/revisor-fabrica.test.js
```

### 8. (MenuPlan) `anulacion.yml` de HoMenu pasa los dos dueños
Files: `.github/workflows/anulacion.yml`, `ops/anulacion-fabrica.test.js`
Depends on: 6, 2
Blocked by: B, C
Existing: `anulacion.yml` ya está en `staging` (puente 1 cerrado) y solo pasa `revisor-app-slug`; `ops/anulacion-fabrica.test.js` ya existe y se amplía.
Not done: solo añade la entrada `duenos` con los dos logins y sus Apps y sube el sha de la Fábrica al que traiga el trozo 6. Con B = 2 no se construye. Puerta de HoMenu: la regla vive en la Fábrica (trozo 6); C13 igual que allí. Lector: el ruleset de `staging` (check `revisor`); disparador: `ci-judge`.
Done:
```sh
npx vitest run ops/anulacion-fabrica.test.js
```
Falla antes: el caso nuevo de `ops/anulacion-fabrica.test.js` (el workflow pasa `duenos` con los dos logins) falla porque hoy solo pasa `revisor-app-slug`.

### 9. (Fábrica) Guardar el token de la cuenta de servicio en el llavero sin el arranque de Pablo
Files: `apps/guardar-token-servicio.ps1`, `scripts/lib/op-door.mjs`, `scripts/token.mjs`, `test/op-door.test.js`, `test/guardar-token-servicio.test.js`
Depends on: 1
Blocked by: A, C
Existing: solo `apps/arranque.ps1` llama a `Llavero-Guardar` (`apps/lib-gh.ps1:213`); `git grep -n "guardar-token"` -> sin salida. El mensaje de `scripts/token.mjs:92` manda a «el script de arranque de Pablo».
Not done: un script que lee el token por la entrada estándar (nunca por argumentos) y lo guarda en la entrada de `apps/llavero.json`. Pasa a la lista `PUERTAS.lectores` con su motivo, y el mensaje de `token.mjs` lo nombra. No crea la cuenta de servicio ni la bóveda: eso lo hace Álvaro en su 1Password (paso 2 de Álvaro). Con A = 2 o 3 no se construye. Lector: `test/op-door.test.js`; disparador: `ci-test`.
Done:
```sh
node --test test/guardar-token-servicio.test.js test/op-door.test.js
```

### 10. (Fábrica) `comprobar-pc`: una orden que dice si un PC está listo para la Fábrica
Files: `scripts/comprobar-pc.mjs`, `test/comprobar-pc.test.js`, `package.json`
Depends on: 1, 4
Blocked by: none
Existing: `npm run check-pc` solo compara la capa de usuario (`scripts/install-pc.mjs comprobar`); `ls scripts test | grep -i comprobar-pc` -> sin salida.
Not done: comprueba `node` >= 22, `git`, `gh`, `op` y `claude` en el PATH; que `FABRICA_IDENTIDAD`, si está, sea válida para la ficha del repo que se le pase; que exista el fichero de valores; y `install-pc comprobar`. No lee ningún secreto ni abre el llavero (no entra en `PUERTAS`). Sale con 1 y nombra cada fallo. `package.json` es puerta (`GATE_FILES`): solo añade un script, sin tocar `ci` ni dependencias (C13); mantiene la comprobación de `test/comprobar-pc.test.js` y, si rompe, se revierte desde una rama nueva. Lector: la persona que monta el PC; disparador: `manual`, declarado como deuda.
Done:
```sh
node --test test/comprobar-pc.test.js
```

### 11. (Fábrica) Los pasos de Álvaro, en un solo sitio
Files: `PASOS-ALVARO.md`, `PASOS-PABLO.md`
Depends on: 9, 10
Blocked by: A
Existing: `ls PASOS-*` -> solo `PASOS-PABLO.md`; `grep -n -i "lvaro" PASOS-PABLO.md` -> sin salida.
Not done: copia la lista «Pasos de Álvaro» de este plan según la respuesta a A. `PASOS-PABLO.md` gana la sección «Puente 2» con los pasos de Pablo. Ningún valor de secreto. Las respuestas a A, B y C van como filas de `intervenciones.md` en el PR que las recoja.
Done:
```sh
git grep -q "comprobar-pc" -- PASOS-ALVARO.md && git grep -q "Puente 2" -- PASOS-PABLO.md
```

## Build order

Ya, sin esperar a nadie ni a Pablo (A, B y C contestadas, puente 1 cerrado): 3 y 6, luego 4, 5 (tras 4) y 1, y tras 1 los trozos 9 y 10 (10 también tras 4); 11 al final. Esperan al paso 2 de Álvaro (existe su App): 2 y 7, y 8 tras 2 y 6. El puente 1 está cerrado, así que 8 no espera a nada del puente 1. Álvaro puede empezar a trabajar cuando 1, 2, 3, 4, 7, 9 y 10 estén en main y en `staging`. Sin 6 y 8, un «no» injusto en un PR suyo solo lo anula Pablo.

## Pasos de Pablo

1. Contestar A, B y C (hecho: consta en `intervenciones.md`, filas del 2026-10-29).
2. Con A = 1: aceptar la petición de instalación de la App de Álvaro, solo en `pabloam89/MenuPlan`.
3. No añadir a Álvaro a factory-am89 (decisión tomada, abajo).
4. Del puente 1 solo queda el paso 7 (borrar la deploy key de `mercadona-sync`), que no bloquea nada de este plan. El juez ya es obligatorio en `staging` también para Álvaro.

## Pasos de Álvaro

1. En su PC: Git, Node 22 o más, `gh`, Claude Code y, con A = 1, 1Password con su CLI `op`. Clonar `factory-am89/fabrica` (público) como carpeta hermana de su copia de MenuPlan y lanzar `npm ci`.
2. Con A = 1: crear su App a partir del manifiesto del constructor (mismos permisos, pública para poder instalarla en el repo de Pablo) y pedir su instalación solo en MenuPlan. Guardar la clave en una bóveda de su 1Password, crear una cuenta de servicio que solo lea esa bóveda y guardar su token con el script del trozo 9. Pasar a Pablo el slug y el client id (no son secretos).
3. Hacer copia de su `~/.claude` y escribir su fichero de valores privado fuera de los repos (`home`, `enabledPlugins`, `autoMode`, `persona`), con `FABRICA_VALORES` apuntando a él y `FABRICA_IDENTIDAD` puesto.
4. Escribir `usuario/personas/algbarc-design.md` (cómo quiere que le hablen) en un PR suyo.
5. `npm run install-pc`. Si dice que hay ficheros ajenos (su `CLAUDE.md` o `settings.json` de antes), repasar la copia del paso 3 y repetir con `--reemplazar`, que deja `<fichero>.antes-de-fabrica` (trozo 3). Después, `node scripts/comprobar-pc.mjs` en verde.

## Cifras antes y después

- Claves de Pablo que salen de su bóveda: antes 0; después 0 con A = 1 o 2, y 1 (con un alcance mayor que el trabajo) con A = 3. Se comprueba en la lista de miembros y cuentas de servicio de la bóveda.
- Repos que alcanza la credencial de las sesiones de Álvaro: con A = 1, 1 (MenuPlan); con A = 3, todos los de factory-am89 más MenuPlan (instalaciones de las Apps).
- PR de HoMenu abiertos por sesiones de Álvaro y juzgados por el revisor: antes, ninguno distinguible por su autor; después, los de su App. Se cuentan con `gh pr list --repo pabloam89/MenuPlan --state merged --json author`.
- Anulaciones en HoMenu por dueño: antes, solo podía Pablo; después, se cuentan con `node scripts/records.mjs` y el login de cada check «override».
- Lecturas de 1Password por hora en el PC de Álvaro (`npm run op-reads`), para ver si el tope de 60 basta sin caché fuera de factory-am89.

## Decisions taken
- principio 2 | eligió: la identidad de GitHub de las sesiones es de la persona (`FABRICA_IDENTIDAD` en su PC, validada contra la ficha), y la ficha guarda la de por defecto del repo | descartó: cambiar la ficha de MenuPlan a una identidad común para los dos, que haría indistinguible quién lanzó cada PR y dejaría sin base la regla de cuatro ojos del trozo 6 | motivo: decidido
- principio 6 | eligió: no añadir a Álvaro a factory-am89 | descartó: hacerle miembro, que ampliaría sus permisos sobre repos privados de Pablo (clase «Change permissions or secrets» de `standards/intervention.md`) y no le hace falta porque `fabrica` es público | motivo: decidido
- principio 3 | eligió: install-pc falla en alto ante un fichero que no instaló y solo lo reemplaza con `--reemplazar` y copia previa | descartó: seguir sobrescribiendo en silencio la configuración de quien instala por primera vez | motivo: decidido
- principio 2 | eligió: la capa personal se une a la común al instalar, en un solo `~/.claude/CLAUDE.md` | descartó: un `@import` desde `~/.claude/CLAUDE.md`, que no he probado en esta versión de Claude Code | motivo: decidido
- principio 6 | eligió: los valores privados de Álvaro viven en su propio fichero, con `FABRICA_VALORES` (que `install-pc` ya admite) | descartó: darle acceso a `fabrica-privado` o meter sus valores en el mismo `valores.json` que Pablo | motivo: decidido
- principio 6 | eligió: los dueños de cada repo para la anulación los pasa el workflow que llama, y la Fábrica sigue con `OWNER_LOGIN` | descartó: convertir `OWNER_LOGIN` en una lista global, que daría a Álvaro poder de anular en la propia Fábrica | motivo: decidido
- principio 4 | eligió: los pasos de Álvaro en `PASOS-ALVARO.md` | descartó: copiarlos también en `PASOS-PABLO.md`, que repetiría el mismo dato en dos sitios | motivo: decidido

## Decisions for Pablo

Contestadas el 2026-10-29: A, B y C. Cada respuesta es una fila `decisión` de `intervenciones.md` con fecha 2026-10-29 (la de A abre con «ante las decisiones A, B y C» y las de B y C remiten a ella); aquí no se copian. Abajo quedan las preguntas como contexto de los trozos que dicen «Blocked by»: todos esos bloqueos ya están levantados. Ya no hay ninguna abierta.

### A. (contestada, `intervenciones.md`, fila de la decisión A) ¿Con qué identidad abren PR en HoMenu las sesiones de Álvaro?
Por qué te lo pregunto: es dar o crear credenciales y permisos de Apps, que es tuyo.
1. Con una App propia de Álvaro, que crea él, cuya clave solo guarda él y que instalas solo en MenuPlan. Ninguna clave tuya sale de tu bóveda, cada PR dice quién lo lanzó y la quitas desinstalándola. Coste: unos 20 minutos de Álvaro, un clic tuyo y los trozos 1, 2, 7 y 9 (recommended)
2. Con su propia cuenta de GitHub, como hoy en su PC. Coste: nada que montar, pero los PR no salen de una App y una sesión suya podría aprobar PR ajenos como él, así que con esta opción Álvaro no puede tener la anulación
3. Con tus claves (el constructor o `homenu-sesiones`), mediante una segunda cuenta de servicio de tu 1Password. Coste: lo más rápido, pero esa clave tiene más alcance que el trabajo de HoMenu

### B. (contestada, `intervenciones.md`, fila de la decisión B) ¿Qué puede contestar Álvaro y puede anular al juez en HoMenu?
Por qué te lo pregunto: es la lista cerrada de intención y autoridad, y la anulación es la única salida de un «no»; las dos son tuyas.
1. En HoMenu, los dos contestáis y los dos podéis anular con un Approve, pero nunca un PR lanzado por vuestras propias sesiones (cuatro ojos). En la Fábrica solo tú. Coste: tus PR de HoMenu los anula Álvaro y al revés; trozos 5, 6 y 8 (recommended)
2. Solo tú, en todo, como hoy. Coste: nada que construir; cada «no» injusto de Álvaro te espera a ti
3. En HoMenu los dos, también sobre el trabajo propio. Coste: igual de rápido que la 1, pero cada uno puede saltarse al juez en lo suyo, y eso es juzgar tu propio trabajo, que está prohibido

### C. (contestada, `intervenciones.md`, fila de la decisión C) ¿Das el OK a los trozos que tocan rutas cerradas (`CLAUDE.md` de la Fábrica, `anulacion.yml` de los dos repos, `revisor.yml` de HoMenu y un script nuevo en `apps/`)?
Por qué te lo pregunto: son rutas de la lista cerrada; el revisor sigue juzgando cada PR.
1. Sí, OK al plan entero (recommended)
2. Sí, pero trozo a trozo
3. No, plan aparcado

## Not verified

- Que 1Password permita cuentas de servicio en el plan de Álvaro, y que él tenga 1Password. Si no, la opción A1 necesita otra forma de guardar su clave, y sería otro trozo.
- Que una App de la cuenta de Álvaro, pública, se pueda instalar en `pabloam89/MenuPlan` cuando Pablo acepta la petición: lo dice la documentación de GitHub, no lo he probado.
- Que `claude-code-action` acepte sin `allowed_bots` un PR de una persona con `write` (afecta a A2 y al trozo 7).
- De quién es el `CLAUDE_CODE_OAUTH_TOKEN` del environment `revisor` de MenuPlan, y cuánto gasta juzgar los PR de Álvaro.
- La zona horaria de Álvaro: si no es Madrid, `madrid-time.mjs` y la regla de la hora pasan a la capa personal (trozo 4 lo deja preparado).
- Cuántas lecturas de 1Password por hora gastaría Álvaro sin caché (MenuPlan no es de factory-am89): no lo he medido.
- Hice `git fetch -q origin` en la carpeta principal de MenuPlan (solo mueve las ramas remotas, sin checkout ni pull) para leer `origin/staging` (`git rev-parse --short origin/staging` -> `5afd0908` el 29 oct 2026).
- Que las guardias de HoMenu cubran a una sesión de Álvaro que trabaje desde una carpeta de la Fábrica (ver «Estado medido» del puente 1).
