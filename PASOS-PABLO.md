# Pasos de Pablo

Lo que solo tú puedes hacer. En este orden. **Ningún constructor trabaja antes de que exista el ruleset (paso 8):** hasta entonces `main` no está protegida y un constructor podría empujar a ella.

1. Crea el repo público `fabrica` en tu cuenta (https://github.com/new) y sube lo que ha dejado el agente: `git remote add origin https://github.com/pabloam89/fabrica.git` y `git push -u origin main`.
2. Crea el environment `revisor`, limitado a la rama `main`, **antes de guardar ningún secreto** (los secretos del revisor viven ahí, no en el repo; una rama de un constructor no puede desplegar en él):
   - `gh api -X PUT repos/pabloam89/fabrica/environments/revisor -F "deployment_branch_policy[protected_branches]=false" -F "deployment_branch_policy[custom_branch_policies]=true"`
   - `gh api -X POST repos/pabloam89/fabrica/environments/revisor/deployment-branch-policies -f name=main -f type=branch`
3. Si el nombre `fabrica-constructor` o `fabrica-revisor` ya está cogido en GitHub, cámbialo en `apps/crear-apps.html` (campo `name` del manifest) **antes** de crear la App, y en `.github/workflows/revisor.yml` (`allowed_bots: fabrica-constructor`) y en el ruleset donde se nombre; `convertir.mjs` reconoce el prefijo `fabrica-constructor` y `fabrica-revisor`, así que un sufijo vale.
4. Abre `apps/crear-apps.html` (doble clic) y pulsa **Crear fabrica-constructor**; en GitHub, **Create GitHub App**. Copia de la barra de direcciones lo que va detrás de `code=` (la página no cargará: es normal) y ejecuta `node apps/convertir.mjs EL_CODIGO`. Anota el *client id* que imprime: es `FABRICA_CONSTRUCTOR_CLIENT_ID` para `scripts/token.mjs`.
5. Vuelve a la página y haz lo mismo con **Crear fabrica-revisor** (otro código, otro `convertir`): guarda `REVISOR_APP_KEY` y `REVISOR_CLIENT_ID` en el environment `revisor`.
6. Instala cada App solo en `fabrica`: https://github.com/settings/apps → la App → **Install App** → *Only select repositories* → `fabrica`.
7. Crea el token de Claude: en tu terminal, `claude setup-token`; guárdalo en el environment: `gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo pabloam89/fabrica --env revisor`.
8. Activa la fusión automática (https://github.com/pabloam89/fabrica/settings/general → *Pull Requests* → **Allow auto-merge**) y crea el ruleset de `main`: https://github.com/pabloam89/fabrica/settings/rules/new?target=branch
   - Destino: la rama por defecto (`main`).
   - **Require a pull request before merging**.
   - **Require status checks to pass**: `tests` (fuente: GitHub Actions) y `revisor` (fuente: la App `fabrica-revisor`).
   - **Block force pushes** y **Restrict deletions**.
   - **No** actives «Restrict updates» (impediría que el constructor empuje sus ramas; solo se protege `main`). Sin excepciones («bypass») para nadie.
9. Cambios al árbitro (`.github/`, `scripts/veredicto.mjs`, `estandares/`, `.claude/`): el check `revisor` sale en rojo con «requiere aprobación de Pablo». Pulsa **Approve** en el PR y luego **Re-run** del job `revisor` (Actions); con tu aprobación sobre el último commit sale en verde y se fusiona solo. Apunta cada una en `intervenciones.md` con motivo `arbitro`.
