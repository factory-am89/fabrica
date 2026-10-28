# Pasos de Pablo

Lo que solo tú puedes hacer. En este orden. **Ningún constructor trabaja antes de que exista el ruleset (lo crea el paso 1, al final):** hasta entonces `main` no está protegida y un constructor podría empujar a ella. Estado a 15 oct 2026: el repo `factory-am89/fabrica` vive en la organización `factory-am89` (traspasado desde la cuenta personal, ver `intervenciones.md`), su `main` ya tiene la v0 y el ruleset `main` ya existe; el paso 1 queda como referencia y supone una cuenta personal, no una organización (pendiente en factory-am89/fabrica#4).

1. Lanza `powershell -ExecutionPolicy Bypass -File C:\dev\fabrica-v0-revisor\apps\arranque.ps1`. Con una sola sesión de `gh` hace, en este orden: el environment `revisor` (limitado a `main`), la cuenta de servicio de 1Password, las dos Apps y su instalación solo en `fabrica`, el token de Claude, el auto-merge, **sube `main` desde `C:\dev\fabrica`** y, al final, **crea el ruleset de `main`** (PR obligatorio, checks `tests` y `revisor`, sin force push, sin borrado y sin excepciones). Te para donde hay que pulsar algo en el navegador, se puede relanzar y cierra la sesión de `gh` al final. El login de `gh` corre aislado de tu git y de tu Administrador de credenciales, así que da igual lo que conteste a «Authenticate Git…»; si ya tenías una sesión de `gh` sin el permiso `workflow`, el script para y te dice que la cierres. A mano le quedan dos cosas: si `fabrica-constructor` o `fabrica-revisor` ya están cogidos en GitHub, cambia el nombre en `apps/crear-apps.html` y en `.github/workflows/revisor.yml` (`allowed_bots`) antes de lanzarlo; y compara el *client id* del constructor que imprime al final con `CLIENT_ID_CONSTRUCTOR` en `scripts/lib/repo.mjs` (lo que usa `scripts/token.mjs`); si difieren, cambia solo esa constante. Una vez fusionado el PR del paso 2, el script vive en `C:\dev\fabrica\apps\` tras un `git pull --ff-only`; `apps\ruleset.ps1` se puede relanzar suelto.
Ningún cambio pasa por tu aprobación (ver C13 en `standards/code.md`): lo decide el check `revisor` (decisión de Pablo, 15 oct 2026, MenuPlan#875). Si el revisor rechaza por error, solo tu **Approve** sobre la cabeza del PR lo anula; pausar el ruleset está prohibido (regla única: `standards/intervention.md`, «Who decides a merge»).

## Proyecto nuevo con un solo script (una vez por repo)

Para que un repo de `factory-am89` trabaje con la Fábrica (primer caso: `homenu-panel`), con tu sesión de `gh` de administrador:

`powershell -ExecutionPolicy Bypass -File C:\dev\fabrica\apps\proyecto-nuevo.ps1 -Repo factory-am89/homenu-panel`

Activa la fusión automática y el borrado de ramas, deja el environment `revisor` limitado a `main`, comprueba que las dos Apps están instaladas, dice por nombre qué secretos faltan y cómo crearlos, abre un PR con los workflows, un `CLAUDE.md` mínimo y `.fabrica.json`, y crea el ruleset de `main`. Se puede relanzar y para en alto donde algo no cuadre. Lo que te toca a ti:

1. **Apps** (decisión de Pablo, 16 oct 2026): `fabrica-constructor` y `fabrica-revisor` en «All repositories» de `factory-am89`. Con eso el script no pide ningún clic por proyecto; si una App no cubre el repo, el script te dice la dirección exacta del clic. No las instala él ni amplía permisos.
2. **Secretos** del environment `revisor` que falten (los nombra el script): `gh secret set <NOMBRE> --env revisor --repo <repo>`; el valor lo escribes tú, nunca en la orden.
3. **Lanzarlo dos veces**: la primera deja el PR y acaba en «pendiente: fusiona el PR»; ese PR lo fusionas tú (el revisor aún no existe en `main`, no puede juzgarlo). La segunda, con los ficheros ya en `main` y el check `tests` corrido allí, crea el ruleset.
4. **Repo privado**: con el plan gratuito GitHub da 403 «Upgrade to GitHub Pro or make this repository public» al pedir rulesets; el script se para con ese motivo.

Comprobación: `gh api repos/factory-am89/homenu-panel/rules/branches/main` debe mostrar `tests / tests` y `revisor`, y un PR de prueba debe fusionarse solo.

## App fabrica-administrador (una vez)

La tercera App, la que crea y protege repos sin ti (trozo 1 de 10 de `plans/app-admin.md`). Decisión de Pablo, 16 oct 2026 (fila de `intervenciones.md` del 16 oct «Pablo eligió «1»: una tercera App administradora…», PR #63). Ella no se crea sola: ninguna App puede crear Apps. Sus secretos viven solo en el environment `administrador` de `factory-am89/fabrica` (limitado a `main`), nunca en 1Password ni en un PC.

1. Primero `gh auth login` (con tu cuenta de administrador; sin sesión el script se niega, sin gastar el código). Luego abre `apps/crear-apps.html` (en `C:\dev\fabrica`), pulsa **Crear fabrica-administrador** y en GitHub **Create GitHub App**. Copia lo que va detrás de `code=` en la barra de direcciones (página que no carga) y lanza enseguida `node apps/convertir.mjs EL_CODIGO` con tu sesión de `gh` de administrador: crea el environment `administrador` (solo `main`) y guarda `ADMIN_APP_KEY` y `ADMIN_CLIENT_ID` sin imprimirlos.
2. Instálala en `factory-am89`, **All repositories** (el script da el enlace `…/installations/new`). No amplíes sus permisos: son exactamente los del manifiesto.

Nombres que debe haber al final en `administrador`: `ADMIN_APP_KEY` y `ADMIN_CLIENT_ID`. Los secretos del revisor que esta App copiará a cada repo se te pedirán en el trozo que los use, no antes. Comprobación: `gh api repos/factory-am89/fabrica/environments/administrador/secrets --jq '.secrets[].name'`.

## Puente HoMenu: la Fábrica opera `pabloam89/MenuPlan` (plan `plans/puente-homenu.md`)

Tus respuestas del 28 oct 2026 (filas de `intervenciones.md`): A1 (HoMenu se queda en tu cuenta `pabloam89`), B1 (nadie se salta el revisor: Dependabot espera, mercadona-sync abre PR), C1 (OK al plan entero) y D1 (HoMenu tiene su propio revisor: una App tuya, creada por ti). Solo se hace pública `fabrica-constructor`; `fabrica-revisor` se queda privada.

**Cuándo:** los pasos 1 a 3 se pueden hacer ya. Los pasos 4 a 7 van **de una sentada, en este orden**, cuando los trozos 11, 13, 14 y 15 del plan estén fusionados en `staging` de MenuPlan (te lo dirá la sesión que coordina). Mientras dura la sentada, la clave del revisor está en un repo que fusiona solo con `tests`; por eso no se dejan a medias. Con el paso 6 hecho, `staging` pide PR, `tests` y `revisor`, al día. Un «no» injusto del revisor se anula con tu **Approve** sobre la cabeza del PR.

Nunca escribas el valor de un secreto en un chat ni en una orden: se escribe en el aviso de `gh` o se lee desde un fichero. Aquí solo van nombres.

1. **Las decisiones del plan**: ya contestadas (A1, B1, C1, D1, arriba); no hay nada que hacer.
2. **Hacer pública `fabrica-constructor`** (1 min). Abre https://github.com/organizations/factory-am89/settings/apps, entra en `fabrica-constructor` → «Advanced» (abajo del todo) → «Make public» → confirma. Solo cambia quién puede instalarla, no sus permisos. Comprobación: `curl -s -o /dev/null -w "%{http_code}" https://api.github.com/apps/fabrica-constructor` debe imprimir `200` (hoy imprime `404`).
3. **Instalar `fabrica-constructor` en tu cuenta** (2 min). Abre https://github.com/apps/fabrica-constructor → «Install» → elige `pabloam89` → «Only select repositories» → solo `MenuPlan` → «Install». Comprobación: en https://github.com/settings/installations aparece `fabrica-constructor` con 1 repositorio (MenuPlan).
4. **Crear la App revisora de HoMenu** (unos 8 min; es tuya, en `pabloam89`, no en la organización).
   1. En https://github.com/settings/apps/new crea una App nueva (nombre sugerido: `homenu-revisor`), sin webhook (desmarca «Active»), «Only on this account», con **exactamente** los permisos del manifiesto de `fabrica-revisor` en `apps/crear-apps.html`: **Pull requests: Read and write** y **Checks: Read and write**; ningún otro. «Create GitHub App».
   2. Apunta dos datos: el **Client ID** (arriba de la página de la App) y el **App ID** (número, también arriba; lo usarás en el paso 6). En «Private keys» → «Generate a private key»: baja un fichero `.pem` (anota dónde queda).
   3. En la App, «Install App» → `pabloam89` → «Only select repositories» → solo `MenuPlan`.
   4. Crea el environment `revisor`: https://github.com/pabloam89/MenuPlan/settings/environments → «New environment» → nombre `revisor` → «Deployment branches and tags» → «Selected branches and tags» → añade la regla `staging` (solo esa).
   5. Guarda los tres secretos en ese environment, con tu sesión de `gh` de administrador (el valor lo escribes tú cuando `gh` lo pida; la clave se lee del fichero):
      - `gh secret set REVISOR_APP_KEY --env revisor --repo pabloam89/MenuPlan < RUTA\DEL\FICHERO.pem`
      - `gh secret set REVISOR_CLIENT_ID --env revisor --repo pabloam89/MenuPlan` (pega el Client ID de la App nueva)
      - `gh secret set CLAUDE_CODE_OAUTH_TOKEN --env revisor --repo pabloam89/MenuPlan` (el token que sale de `claude setup-token`)
   6. **Borra el fichero `.pem`** del disco (y de la papelera).
   Comprobación: `gh api repos/pabloam89/MenuPlan/environments/revisor/secrets --jq '.secrets[].name'` debe listar los tres nombres: `CLAUDE_CODE_OAUTH_TOKEN`, `REVISOR_APP_KEY`, `REVISOR_CLIENT_ID`.
5. **Activar «Allow auto-merge» en MenuPlan** (30 s). https://github.com/pabloam89/MenuPlan/settings → «General» → «Pull Requests» → marca «Allow auto-merge». Comprobación: `gh api repos/pabloam89/MenuPlan --jq .allow_auto_merge` imprime `true`.
6. **Cerrar `staging`: aplicar el ruleset** (3 min). Es el paso que hace obligatorio el revisor. Con tu sesión de `gh` de administrador y desde `C:\dev\fabrica` (con `git pull --ff-only` hecho), sustituye `<APP_ID>` por el App ID del paso 4:
   1. Mira primero lo que se va a mandar: `node scripts/admin/cuerpo-ruleset.mjs --app-id <APP_ID> --name "staging: PR, tests y revisor" --strict --tests-context tests`. Debe imprimir un JSON con `"enforcement": "active"`, `"bypass_actors": []`, `"strict_required_status_checks_policy": true` y los checks `tests` (15368) y `revisor` (con tu `<APP_ID>`, no 5332150). Si imprime `falta --app-id`, el número no está bien. La opción `--tests-context tests` es necesaria: el check de HoMenu se llama `tests`, no `tests / tests`.
   2. Aplícalo sobre el ruleset de `staging` que ya existe: `node scripts/admin/cuerpo-ruleset.mjs --app-id <APP_ID> --name "staging: PR, tests y revisor" --strict --tests-context tests | gh api --method PUT repos/pabloam89/MenuPlan/rulesets/24770007 --input -`
   3. Comprobación: `gh api repos/pabloam89/MenuPlan/rules/branches/staging` debe mostrar `pull_request` y `required_status_checks` con `tests` y `revisor`; `gh api repos/pabloam89/MenuPlan/rulesets/24770007 --jq '.bypass_actors'` debe imprimir `[]`. Después abre un PR de prueba pequeño a `staging`: no se puede fusionar hasta que `tests` y `revisor` estén en verde, y se fusiona solo.
   4. Cierra la sesión de `gh` (`gh auth logout`).
7. **Borrar la deploy key de mercadona-sync** (4 min; **irreversible**, si hiciera falta se crea otra). Solo cuando el trozo 14 (mercadona-sync abre PR) esté fusionado y haya abierto al menos un PR bueno. Abre https://github.com/pabloam89/MenuPlan/settings/keys → borra la deploy key `mercadona-sync`; borra el secreto `MERCADONA_DEPLOY_KEY` del environment `mercadona-sync` (https://github.com/pabloam89/MenuPlan/settings/environments) y guarda ahí la clave de la App con la que abrirá el PR (el nombre del secreto lo da el PR del trozo 14). Comprobación: `gh api repos/pabloam89/MenuPlan/keys --jq '.[].title'` ya no lista `mercadona-sync`, y el ruleset del paso 6 no tenía ninguna excepción.

No hay un paso de «Apps de Dependabot»: `homenu-dependabot-merge` ya existe y no se toca aquí.
