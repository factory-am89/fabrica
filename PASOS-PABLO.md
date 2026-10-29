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

Tus respuestas del 28 oct 2026 (las filas de `intervenciones.md` las añade el PR #171 del plan): A1 (HoMenu se queda en tu cuenta `pabloam89`), B1 (nadie se salta el revisor: Dependabot espera, mercadona-sync abre PR), C1 (OK al plan entero) y D1 (HoMenu tiene su propio revisor: una App tuya, creada por ti). Solo se hace pública `fabrica-constructor`; `fabrica-revisor` se queda privada.

**Estado a 29 oct 2026:** los pasos 1 a 6 están HECHOS y comprobados con `gh` (abajo). Solo queda el 7, que espera a que `mercadona-sync` abra un PR bueno. Un «no» injusto del revisor se anula con tu **Approve** sobre la cabeza del PR.

Nunca escribas el valor de un secreto en un chat ni en una orden: se escribe en el aviso de `gh` o se lee desde un fichero. Aquí solo van nombres.

1. **Las decisiones del plan**: ya contestadas (A1, B1, C1, D1, arriba); no hay nada que hacer.
2. **HECHO, 29 oct 2026: `fabrica-constructor` pública.** `curl -s -o /dev/null -w "%{http_code}" https://api.github.com/apps/fabrica-constructor` imprime `200`.
3. **HECHO, 29 oct 2026: `fabrica-constructor` instalada en `pabloam89`** solo en `MenuPlan`. Sin comprobación con `gh` desde aquí: mira https://github.com/settings/installations (`fabrica-constructor`, 1 repositorio: MenuPlan).
4. **HECHO, 29 oct 2026: App `homenu-revisor` (App ID 5521568) y environment `revisor`.** `gh api repos/pabloam89/MenuPlan/environments/revisor/deployment-branch-policies --jq '.branch_policies[].name'` imprime solo `staging`, y `gh api repos/pabloam89/MenuPlan/environments/revisor/secrets --jq '.secrets[].name'` lista `CLAUDE_CODE_OAUTH_TOKEN`, `REVISOR_APP_KEY` y `REVISOR_CLIENT_ID`. Lo que no se puede comprobar con `gh`: que el fichero `.pem` se borrara del disco y de la papelera; mírelo Pablo.
5. **HECHO, 29 oct 2026: «Allow auto-merge».** `gh api repos/pabloam89/MenuPlan --jq .allow_auto_merge` imprime `true`.
6. **HECHO, 29 oct 2026: `staging` cerrado.** Ruleset 24770007 `staging: PR, tests y revisor`, activo, sin excepciones (`bypass_actors` vacío), con PR obligatorio, `strict`, y los checks `tests` (integration id 15368) y `revisor` (5521568). Comprobación: `gh api repos/pabloam89/MenuPlan/rulesets/24770007`. Prueba de humo: `pabloam89/MenuPlan#996` a `staging` se fusionó sola (29 oct 2026, 12:03 UTC). Lo que no se puede comprobar con `gh`: que cerraras tu sesión de `gh` de administrador (`gh auth logout`).
   **Hecho también, no estaba en los pasos (lo pidió `pabloam89/MenuPlan#970`):** en el environment `mercadona-sync` están el secreto `DEPENDABOT_APP_KEY` (copiado del documento «GitHub App Dependabot» de la bóveda HoMenu de 1Password) y la variable `DEPENDABOT_APP_ID`. Comprobación: `gh api repos/pabloam89/MenuPlan/environments/mercadona-sync/secrets --jq '.secrets[].name'` y `.../variables`.
7. **PENDIENTE: borrar la deploy key de mercadona-sync** (4 min; **irreversible**, si hiciera falta se crea otra). No lo hagas todavía: antes `mercadona-sync` tiene que haber abierto al menos un PR bueno con la App. Cómo saberlo, a 29 oct 2026 aún no: `gh pr list --repo pabloam89/MenuPlan --author app/homenu-dependabot-merge --state all` imprime nada (cuando haya un PR suyo, lista al menos una fila) y `gh run list --repo pabloam89/MenuPlan --workflow mercadona-sync.yml -L 3` debe mostrar una ejecución posterior con `success` (la última, del 26 oct, es anterior al cambio). Cuando lo haya:
   1. Abre https://github.com/pabloam89/MenuPlan/settings/keys y borra la deploy key `mercadona-sync` (pulsa «Delete» y confirma).
   2. Abre https://github.com/pabloam89/MenuPlan/settings/environments, entra en `mercadona-sync` y borra el secreto `MERCADONA_DEPLOY_KEY` (icono de papelera, confirma).
   3. Comprobación: `gh api repos/pabloam89/MenuPlan/keys --jq '.[].title'` ya no lista `mercadona-sync`, y `gh api repos/pabloam89/MenuPlan/environments/mercadona-sync/secrets --jq '.secrets[].name'` ya no lista `MERCADONA_DEPLOY_KEY`.
   **Siguiente trabajo (después del paso 7, no antes):** un PR en MenuPlan que quite de `mercadona-sync.yml` el plan B de la deploy key.

