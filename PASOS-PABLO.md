# Pasos de Pablo

Lo que solo tú puedes hacer. En este orden.

1. Crea el repo público `fabrica` en tu cuenta (https://github.com/new) y sube lo que ha dejado el agente: `git remote add origin https://github.com/pabloam89/fabrica.git` y `git push -u origin main`.
2. Abre `apps/crear-apps.html` (doble clic) y pulsa **Crear fabrica-constructor**; en GitHub, **Create GitHub App**. Copia de la barra de direcciones lo que va detrás de `code=` (la página no cargará: es normal) y ejecuta `node apps/convertir.mjs EL_CODIGO`.
3. Vuelve a la página y haz lo mismo con **Crear fabrica-revisor** (otro código, otro `convertir`).
4. Instala cada App solo en `fabrica`: https://github.com/settings/apps → la App → **Install App** → *Only select repositories* → `fabrica`.
5. Crea el token de Claude: en tu terminal, `claude setup-token`; guárdalo en https://github.com/pabloam89/fabrica/settings/secrets/actions con el nombre `CLAUDE_CODE_OAUTH_TOKEN`.
6. Activa la fusión automática: https://github.com/pabloam89/fabrica/settings/general → *Pull Requests* → **Allow auto-merge**.
7. Crea el ruleset de `main`: https://github.com/pabloam89/fabrica/settings/rules/new?target=branch
   - Destino: la rama por defecto (`main`).
   - **Restrict updates** (nadie empuja directo) y **Require a pull request before merging**.
   - **Require status checks to pass**: añade `tests` y `revisor`; para `revisor`, elige como fuente la App `fabrica-revisor`.
   - Sin excepciones («bypass») para nadie.
