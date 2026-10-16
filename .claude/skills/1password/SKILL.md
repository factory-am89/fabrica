---
name: 1password
description: Úsala al leer una clave con `op` desde un script, cuando una dirección `op://` o la service account falle, al guardar algo en una bóveda o si el agente SSH no responde. No para: crear o rotar un secreto de punta a punta (lo hace Pablo) ni los secretos de GitHub (github).
dueño: constructor
comprobado: 2026-10-15
---

# 1Password

## Qué es y dónde

- **Las claves viven en 1Password, no en ficheros.** En este repo, la clave privada de la App
  `fabrica-constructor` es el documento `fabrica-constructor.pem` de la bóveda `Fabrica`; la lee
  `scripts/token.mjs` (`op document get fabrica-constructor.pem --vault Fabrica`, `OP_VAULT` la cambia).
  Los secretos del revisor no están aquí: viven en el environment `revisor` de GitHub (skill `github`).
- **Direcciones, no valores**: un fichero de entorno guarda `op://<bóveda>/<ficha>/<campo>`; se resuelven al
  ejecutar (`op run --env-file=… -- <orden>`). Un `.env*` con valores no se commitea (`.gitignore`).
- **Dos caminos con `op`, y no se mezclan**: con una service account (solo lectura, sin ventanas) para leer
  en automático; sin ella, por la app de escritorio (pide aprobar a Pablo), para escribir o leer lo que la
  cuenta no ve. Una service account solo lee las bóvedas que se le dieron al crearla.
- **Agente SSH**: guarda las llaves y cada conexión pide aprobar en la ventana de 1Password. Sirve a la `ssh`
  de Windows (`C:\Windows\System32\OpenSSH\ssh.exe`), no a la de Git for Windows.
- **CLI**: `winget install AgileBits.1Password.CLI`; reiniciar el terminal después.

## Operaciones habituales

| Qué | Comando | Debe salir |
|---|---|---|
| ¿Hay sesión de `op`? | `op whoami` | la cuenta; si no, `op signin` o abrir la app |
| Leer un documento en memoria | `op document get "<ficha>" --vault <bóveda>` | su contenido; que un script lo use, nunca lo imprima |
| Lanzar algo que lee variables | `op run --env-file=<fichero> -- <orden>` | la orden corre; si imprime una clave, sale `<concealed by 1Password>` |
| Comprobar una clave sin verla | comparar a ciegas (`valor === otro`) e imprimir el sí o el no | `COINCIDEN` o `NO COINCIDEN` |
| Ver llaves del agente SSH | `C:\Windows\System32\OpenSSH\ssh-add.exe -l` | una línea por llave con su título |
| ¿Por qué falló la `ssh`? | `grep -a "ssh authorization prompt" "$LOCALAPPDATA"/1Password/logs/*.log` | `timed out` = nadie aprobó la ventana |
| Cupo de lecturas de una service account | `op service-account ratelimit` | cuándo se reinicia el cupo |

**El valor de una clave nunca va escrito en un comando**: quedaría en la conversación y en el historial.
Se pasa por tubería (stdin) entre dos procesos.

## Lo que falló

- **2026-10-09 · una dirección `op://` daba error con ficha y campo bien puestos.** Causa: el nombre de la
  ficha llevaba tilde; `op://` solo admite letras y cifras sin acento, espacios, `-`, `_` y `.`. Arreglo: leerla
  por nombre con `op item get` y crear las fichas nuevas sin tildes.
- **2026-10-08 · «"<bóveda>" isn't a vault in this account» al crear una ficha desde un script.** Causa: Node
  con `shell: true` concatena los argumentos y el espacio parte el nombre. Arreglo: pasar el **id** de la bóveda (`op vault list`).
- **2026-10-09 · «a vault query must be provided when this command is called by a service account».** Causa: con
  service account, `op item get` exige `--vault`; con la app, no. Arreglo: todo script pasa `--vault`.
- **2026-10-10 · «Too many requests» de 1Password.** Causa: cada arranque de cada sesión leía la clave, y un test
  llamaba a `op` de verdad; el cupo (por hora) es de la cuenta, no de la sesión. Arreglo: reutilizar lo leído
  durante la hora (la clave de una App, un token de 1 h) y que los tests no llamen a `op`.
- **2026-10-16 · «Too many requests» again, now from the Fábrica's `scripts/token.mjs` (the same failure as MenuPlan
  on 2026-10-10).** Cause: every gh/git call read `fabrica-constructor.pem` from 1Password, so several agents in a
  loop spent the service account's hourly quota (MenuPlan's showed 1000/1000 used); the quota belongs to the
  account, not to the session. Fix: `scripts/lib/cache-token.mjs` keeps only the installation token in
  `%LOCALAPPDATA%Fabrica	oken-cache.json` (user-only ACL) until 15 minutes before it expires, with a lock so two
  sessions do not exchange at once; on "Too many requests" `token.mjs` does not retry nor try another vault: it
  prints `limite-de-1password`, uses the saved token if it is still alive and otherwise exits with code 3.
  Count with `node --test test/token-lecturas.test.js`: 10 calls read the .pem 10 times before, once after.
- **2026-10-11 · la `ssh` falla con «communication with agent failed».** Causa: nadie contestó la ventana de
  aprobar; no era el agente ni la llave. Arreglo: avisar a Pablo antes de conectar y esperar su sí, sin
  reintentar en bucle.
- **2026-10-08 · al conectar por SSH sale una ventana de «Git for Windows» y la conexión se cuelga.** Causa: la
  `ssh` de Git Bash no habla con el agente (escucha en una tubería de Windows). Arreglo: la `ssh` de Windows.
- **2026-10-08 · cada comando tardaba ~10 s y el build cayó con «authorization timeout».** Causa: sin service
  account, `op` pasa por la app de escritorio y pide aprobar en cada proceso. Arreglo: service account de solo lectura.
- **2026-10-08 · «connecting to desktop app timed out».** Causa: la app estaba cerrada o bloqueada. Arreglo:
  abrirla y desbloquearla; crear una service account sí la necesita (la service account no puede crear nada).
- **2026-10-08 · `op` no se encontraba tras instalarlo.** Causa: el PATH nuevo solo llega a terminales abiertos
  después. Arreglo: reiniciar el terminal.
- **2026-10-08 · 1Password no ofreció guardar una contraseña.** Causa: la extensión del navegador estaba
  bloqueada. Arreglo: mirar que su icono esté desbloqueado; si no, crear la ficha a mano.

## Qué requiere el OK de Pablo

Crear, rotar, editar o borrar una clave, ficha, bóveda o service account; cambiar permisos de una bóveda o
invitar a alguien; guardar o mover códigos de recuperación del 2FA (los pega él, nunca pasan por la conversación).
Leer con una service account no lo requiere. Ninguna sesión escribe en la bóveda personal de Pablo.

Sin comprobar aquí: los comandos de la tabla contra la bóveda `Fabrica` (la skill viene de otro proyecto).
