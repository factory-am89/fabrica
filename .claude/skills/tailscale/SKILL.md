---
name: tailscale
description: Úsala al conectar un PC o un servidor a la red privada, cuando no se pueda entrar a un servidor por su IP privada, si Tailscale «no abre» o dice Logged out, o al invitar a alguien o cambiar quién ve qué. No para: el servidor en sí, su cortafuegos y sus copias (hetzner) ni las llaves SSH (1password).
dueño: constructor
comprobado: 2026-10-15
---

# Tailscale

## Qué es

- **Una red privada (tailnet)** entre los aparatos de una persona: lo que no está en ella no ve el servidor.
  El servidor no abre ningún puerto a internet; SSH y la base de datos llegan por aquí (skill `hetzner`).
- Cada máquina recibe una IP `100.x.y.z` (`tailscale ip -4`) y se conecta directa a las demás cuando puede.
- **Windows**: es una app de bandeja, sin ventana; el servicio arranca solo. Si no se ve, pulsar `^` en los iconos ocultos.
- **Linux**: `tailscaled` es el servicio; el cortafuegos deja pasar lo que entra por `tailscale0`.
- La cuenta es la de quien la creó (entra con su proveedor de identidad). No hay claves de API ni auth keys
  salvo que se creen; si se crean, van a 1Password (skill `1password`).

## Operaciones habituales

Con `tailscale` en Windows se entiende `"C:\Program Files\Tailscale\tailscale.exe"`.

| Qué | Comando | Debe salir |
|---|---|---|
| ¿Está conectado el PC? | `tailscale status` | la lista de máquinas; `Logged out.` = falta iniciar sesión |
| Iniciar sesión en el PC | icono de la bandeja → **Log in** | el navegador abre el acceso; luego `status` lista máquinas |
| ¿Está el servidor en la red? | `ssh root@<IP 100.x> 'tailscale status'` | las dos máquinas, la del PC con `direct` |
| Probar la entrada | `ssh root@<IP 100.x> hostname` | el nombre del servidor |
| Instalar en Linux | `curl -fsSL https://tailscale.com/install.sh \| sh` | `Installation complete!` y `tailscaled` en `active` |
| Conectar un servidor (OK) | `nohup tailscale up --hostname=<nombre> > /root/tailscale-up.log 2>&1 < /dev/null &` y leer el log | un enlace `https://login.tailscale.com/a/…` que abre y aprueba su dueño |
| IP de una máquina | `tailscale ip -4` | su `100.x.y.z` |

## Lo que falló

- **2026-10-08 · «no consigo abrir Tailscale» en Windows.** Causa: no es una app con ventana; el servicio corría
  pero sin sesión (`status` decía `Logged out.`). Arreglo: iniciar sesión desde el icono de la bandeja.
- **2026-10-08 · `tailscale up` en el servidor se queda esperando y parece colgado.** Causa: espera a que alguien
  abra el enlace de acceso. Arreglo: lanzarlo con `nohup` en segundo plano, leer el enlace del log y pasárselo a su dueño.

## Qué requiere el OK de Pablo

Invitar a alguien o compartir una máquina; cambiar la política de acceso (ACL) o los ajustes de la cuenta; crear
auth keys o tokens de API; pasar a un plan de pago. Si la red cae, el servidor sigue vivo pero inaccesible por
SSH: la vía de emergencia es la consola web del proveedor (skill `hetzner`).

Sin comprobar aquí: MagicDNS (se entra por la IP `100.x`), las ACL, invitar a otra persona y los límites del plan gratuito.
