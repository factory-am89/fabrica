---
name: github
description: Úsala cuando el CI de GitHub esté en rojo, un workflow no arranque, haya que mirar checks o logs de un PR, abrir un PR con la identidad de la App, o tocar el ruleset de main, las Apps o los secretos de Actions. No para: guardar o rotar claves (1password) ni el estándar que juzga el revisor (estandares/codigo.md).
dueño: constructor
comprobado: 2026-10-15
---

# GitHub

## Cómo está montado

- **`main` solo por PR.** Ruleset de `main` (los clics, en `PASOS-PABLO.md`, paso 8): PR obligatorio,
  checks `tests` (Actions) y `revisor` (la App `fabrica-revisor`), sin force push ni borrado, **sin**
  «Restrict updates» (impediría empujar ramas) y sin bypass para nadie. Con la fusión automática
  activa, GitHub fusiona cuando los dos checks están en verde; ninguna sesión fusiona ni empuja a `main`.
- **Dos Apps, cada una con lo mínimo** (manifiestos en `apps/crear-apps.html`):
  - `fabrica-constructor`: contenido, PR, issues y workflows en escritura; checks y actions en lectura.
    Empuja ramas y abre PR; nunca fusiona. Un PR abierto con una App sí lanza `tests`.
  - `fabrica-revisor`: solo PR y checks en escritura. Publica el check `revisor`.
  - Cada una instalada solo en este repo. Las dos se crean y se amplían a mano (Pablo): un constructor no
    toca permisos de una App.
- **`revisor.yml` usa `pull_request_target`**: corre la versión de `main`, tiene secretos y **nunca
  ejecuta código del PR** (ese lo ejecuta `tests.yml`, sin secretos). Sus secretos viven en el environment
  `revisor`, limitado a `main`, no en el repo. Claude no ve el token de la App: se crea después de él.
- **Ningún cambio pasa por la aprobación de Pablo**: decide el check `revisor`. Qué rutas vigila de cerca
  la pregunta C13 está en `estandares/codigo.md` (única fuente).

## Identidad del constructor

`node scripts/token.mjs -- <orden>` canjea un token de instalación de la App (dura 1 hora), lo pone en `GH_TOKEN` solo para esa orden y no lo imprime. Lo reutiliza de
`%LOCALAPPDATA%Fabrica	oken-cache.json` hasta 15 minutos antes de caducar (solo el token, nunca la clave). Necesita
`FABRICA_CONSTRUCTOR_CLIENT_ID` (el client id, no es secreto) y una sesión de `op` abierta: la clave
privada se lee de 1Password en memoria (skill `1password`). `FABRICA_REPO` cambia el repo.

## Operaciones habituales

| Qué | Comando | Debe salir |
|---|---|---|
| Abrir un PR como la App | `node scripts/token.mjs -- gh pr create --fill` | la URL del PR |
| Armar la fusión automática | `node scripts/token.mjs -- gh pr merge <n> --auto --squash` | `will be automatically merged` |
| Checks de un PR | `gh pr checks <n>` | `tests` y `revisor` en `pass`, o `fail` con enlace |
| Solo lo que falló | `gh run view <run> --log-failed` | el error: fichero y regla, o nombre del test |
| Relanzar | `gh run rerun <run> --failed` | el run vuelve a `in_progress` |
| Reglas que aplican a `main` | `gh api repos/<repo>/rules/branches/main` | `pull_request` y `required_status_checks` con `tests` y `revisor` |
| ¿Está en main? | `git fetch origin` y mirar `origin/main` | el commit o su ausencia |
| Probar un workflow | `npx actionlint .github/workflows/*.yml` | sin salida |

## Lo que falló

- **2026-10-09 · un PR abierto con `GITHUB_TOKEN` no lanzó `tests.yml`.** Causa: GitHub no dispara
  workflows con ese token. Arreglo: abrir los PR con el token de la App (`scripts/token.mjs`), o lanzarlo con `gh workflow run`.
- **2026-10-09 · ruleset con la integración de Actions como excepción: 422 «Actor GitHub Actions
  integration must be part of the ruleset source or owner organization».** Causa: en un repo personal no se
  puede eximir a Actions ni a `OrganizationAdmin`. Arreglo: quien deba empujar a la rama protegida usa una
  deploy key y el ruleset exime a `DeployKey` (`actor_id: null`, `bypass_mode: always`). Aquí no hay ninguna: no se crea sin OK de Pablo.
  Por eso el ruleset de `main` va con `bypass_actors = @()`: nadie se salta el PR.
- **2026-10-09 · exigir checks con la protección clásica: 404 «Required status checks not enabled».**
  Causa: el PATCH solo edita checks que ya existen; activarlos pide reescribir la protección con PUT. Arreglo: usar un ruleset.
- **2026-10-15 · una rama que cambia un workflow era rechazada entera al empujarla.** Causa: a la App le
  faltaba el permiso «Workflows»; GitHub rechaza el push completo, no solo el fichero. Arreglo: el permiso
  se da a la App (a mano, Pablo) o el cambio lo empuja una persona.
- **2026-10-14 · `gh` y `git push` daban 401 pasada la hora.** Causa: un token que caduca fijado una sola vez
  al arrancar la sesión. Arreglo: un token por orden, que es lo que hace `scripts/token.mjs`.
- **2026-10-10 · el token de instalación real (~390 caracteres, con `.` y `-`) no pasó la forma escrita de
  memoria.** Causa: se validó sin ver uno real. Arreglo: no validar su forma; si hace falta, `[A-Za-z0-9_.-]`.
- **2026-10-13 · una orden `npm` lanzada con `spawnSync` sin shell fallaba con `EINVAL` en Windows.** Causa: `npm`
  es un `.cmd`. Arreglo: lanzar `node` con el JS de npm, o `gh`/`git`, que son `.exe`. Con `shell: true`, cmd.exe
  sustituye `%VAR%` en los argumentos: no valdría para pasar secretos.
- **2026-10-10 · un `printf '\n…'` con salto de línea real dejó de ser YAML y el run caía a los 0 s.** Causa:
  el salto sacó líneas del bloque `run: |`. Arreglo: un workflow se edita a mano con Edit, nunca con un script que
  lo reescribe; en `name:` un ` #` empieza un comentario.
- **2026-10-08 · `gh` colgado con «TLS handshake timeout».** Causa: la red. Arreglo: `timeout 60 gh …` y repetir.
- **2026-10 · `git worktree remove` falla en Windows con «Filename too long».** Causa: rutas largas dentro de
  `node_modules`. Arreglo: `git config core.longpaths true`, o `scripts/retirar.mjs`, que quita antes `node_modules`.

## Qué requiere el OK de Pablo

Crear o ampliar una App; el ruleset, los environments, los secretos y las deploy keys; subir o fusionar a `main`;
borrar ramas sin fusionar. El resto, `CLAUDE.md` («Prohibido»).

Sin comprobar aquí: `git push` con `GH_TOKEN` en lugar del helper de credenciales (puede pedir `gh auth setup-git`);
la skill viene de otro proyecto y su know-how no se ha repetido en este repo.
