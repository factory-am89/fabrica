---
name: hetzner
description: Úsala al tocar un servidor de Hetzner Cloud: entrar por SSH, cortafuegos y puertos, actualizar o reiniciar, Docker y Postgres, copias cifradas y su restauración, o disco y memoria. No para: la red privada y quién entra (tailscale), la llave SSH y otras claves (1password).
dueño: constructor
comprobado: 2026-10-15
---

# Hetzner (servidor propio)

## Cómo se monta

- Un VPS pequeño (1 vCPU, 1 GB de RAM, 20 GB) con Ubuntu LTS, 2 GB de swap, Docker y Compose. La dirección
  pública no se usa: el cortafuegos deniega todo salvo lo que entra por `tailscale0` (skill `tailscale`).
- `sshd` solo con llaves (`/etc/ssh/sshd_config.d/10-solo-llaves.conf`; Ubuntu trae contraseñas por defecto).
  Se entra como `root` con una llave del agente SSH de 1Password, que pide aprobar cada vez (skill `1password`).
- Postgres en Docker escucha **solo** en la IP de Tailscale. La contraseña, en 1Password y en el `.env` del
  servidor (permisos 600); nunca se imprime.
- Copia diaria con un temporizador de systemd: `pg_dump -Fc` por tubería a `age` con la clave **pública**; el
  servidor no puede leer sus propias copias, la privada solo está en 1Password. Se poda solo tras una copia buena.

## Operaciones habituales

`ssh` es `C:\Windows\System32\OpenSSH\ssh.exe root@<IP 100.x>` (en PowerShell, `ssh` ya es esa).

| Qué | Comando | Debe salir |
|---|---|---|
| Entrar | `ssh` | el prompt; **cada vez** ventana de 1Password a aprobar: avisa antes a quien la contesta |
| Algo largo | subir el script (`ssh 'cat > /root/x.sh' < x.sh`) y **en otra llamada** `ssh 'nohup bash /root/x.sh >/dev/null 2>&1 < /dev/null &'`; leer el log | sigue aunque se corte la conexión |
| Actualizar | `apt-get update && apt-get -y upgrade`, lanzado como lo anterior | el log acaba sin errores |
| ¿Pide reinicio? | `ls /var/run/reboot-required` | el fichero existe o `No such file` |
| Reiniciar (OK) | `systemctl reboot` | vuelve en menos de un minuto; swap y Docker arrancan solos |
| Memoria, swap y disco | `free -m; swapon --show; df -h /` | RAM ~1 GB, `/swapfile` de 2 G |
| Cortafuegos | `ufw status verbose` | `active`, `deny (incoming)` y `ALLOW IN` en `tailscale0` |
| Postgres | `docker compose ps` en su carpeta | `Up … (healthy)` y el puerto atado a la IP de Tailscale |
| Temporizador de copias | `systemctl list-timers <unidad>.timer` | la próxima ejecución |
| Restaurar en una base nueva (OK) | `docker compose exec -T db pg_restore -U <usuario> -d <base_nueva> --no-owner < <copia>.dump` | sin errores y el dato leído igual |
| ¿Se ve el puerto desde fuera? | `bash -c 'echo > /dev/tcp/<IP pública>/5432'` desde cualquier PC | no conecta (timeout) |

- **Cortafuegos con red de seguridad.** Antes de tocar `ufw` o `sshd`, armar un temporizador que lo deshaga:
  `systemd-run --on-active=300 --unit=ufw-rescate /usr/sbin/ufw disable`; se cancela con
  `systemctl stop ufw-rescate.timer` cuando se comprueba que se entra por Tailscale. La consola web entra sin red.
- **Docker publica puertos saltándose `ufw`.** Todo `ports:` va atado a la IP de Tailscale
  (`<IP 100.x>:5432:5432`), nunca `5432:5432`.

## Lo que falló

- **2026-10-09 · con `pg_dump` caído, `age` dejó un `.age` válido que parecía una copia.** Causa: `age` cifra
  también una entrada vacía y sale con 0. Arreglo: `set -o pipefail` en el script de copia y, de segunda red, un tope de tamaño mínimo.
- **2026-10-09 · revisión de un script de copia antes de instalarlo.** Causa: la contraseña iba en el argv de
  `pg_dump` y `psql` (se ve en `ps`); `docker run -i` dentro de un `while read` se comía la lista; un corte de
  systemd no dejaba línea. Arreglo: fichero de contraseña `:ro`, `</dev/null` en el bucle y `trap` de TERM.
- **2026-10-09 · un ensayo de restauración se quedaba colgado en `pg_ctl start` (Windows).** Causa: el
  postmaster hereda las tuberías y `spawnSync` espera a que se cierren. Arreglo: `stdio: "ignore"` en el arranque, el log a fichero y un tope de tiempo.
- **2026-10-08 · una orden larga por SSH no vuelve y se corta a los 300 s (`apt upgrade`).** Causa: depende de
  que la conexión siga viva; probablemente la ventana de aprobación sin contestar. Arreglo: subir el script y
  lanzarlo con `nohup`; esperar leyendo el log; el cortafuegos, en pasos cortos y con el temporizador de rescate.
- **2026-10-08 · el script se subió vacío y no se ejecutó nada.** Causa: `cat > f && nohup … &` mete la lista
  entera en segundo plano y pierde la entrada estándar. Arreglo: subir el fichero en una llamada y lanzarlo en otra.
- **2026-10-08 · ventana de «Git for Windows» al conectar.** Causa: la `ssh` de Git Bash no habla con el agente.
  Arreglo: la `ssh` de Windows.
- **2026-10-08 · SSH aceptaba contraseñas.** Causa: valor por defecto de Ubuntu. Arreglo: el fichero de
  `sshd_config.d`, validado con `sshd -t` y aplicado con `systemctl reload ssh`; con contraseña da `Permission denied (publickey)`.
- **2026-10-08 · el precio asustó por un modelo distinto.** Causa: la web de ventas muestra precios **sin IVA** y la
  consola **con IVA**, y la fila de abajo es otro modelo. Arreglo: mirar el **total** de la columna de la derecha al crear.

## Qué requiere el OK de Pablo

Crear, borrar o cambiar de tamaño el servidor, un Volume o una IP; todo lo que tenga coste (Backups de Hetzner,
snapshots, otro servidor); abrir un puerto a internet, aunque sea un rato; tocar `ufw` o `sshd` más allá de lo
escrito; `docker compose down -v`, borrar un volumen o restaurar sobre una base con datos; rotar la contraseña
de Postgres (es un secreto); instalar o cambiar las copias y borrar copias a mano.

Coste: facturado por horas, con IVA aparte; el límite que muerde es 1 GB de RAM (la swap es el colchón; si no cabe, se
sube de tamaño desde la consola). Sin comprobar aquí: restaurar con una base llena y la copia fuera del servidor (la skill viene de otro proyecto).
