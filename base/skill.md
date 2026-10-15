# Cómo se escribe una skill

Una skill es el know-how de un dominio (un servicio, una herramienta) para que una sesión con prisa
haga algo bien sin haber estado cuando se aprendió. Vive en `.claude/skills/<nombre>/SKILL.md`.
La forma la comprueba `test/skills.test.js` con `scripts/lib/skills.mjs`: una sola forja, la misma
para cualquier skill. Lo que no comprueba una máquina no se exige aquí.

## Forma

```
---
name: <igual que la carpeta>
description: Úsala <cuándo: disparadores concretos>. No para: <qué es de otra skill o agente>.
dueño: <agente de .claude/agents/ que la mantiene>
comprobado: AAAA-MM-DD
---
```

- **Solo esos cuatro campos.** `description` lleva «Úsala» y «No para:», y como mucho 600 caracteres.
- **`comprobado` caduca a los 90 días** (o si está en el futuro): se renueva volviendo a comprobar
  la skill, no cambiando la fecha.
- **`SKILL.md` de 120 líneas como mucho.** El detalle largo va a `referencias/<tema>.md`, y `SKILL.md`
  lo cita por su ruta (`referencias/<tema>.md`): lo que no se cita es un huérfano. En la carpeta
  no hay nada más que `SKILL.md` y `referencias/`.
- **Una sección `## Lo que falló`**, con una viñeta por lección: `- **AAAA-MM-DD · síntoma.** Causa: …
  Arreglo: …`. Es el know-how acumulado: cada fallo real vuelve aquí si no cabe en un test o un hook.
- **Nada sensible**: ni valores de claves, ni direcciones IP, ni ids de instalación; solo el nombre
  de la variable o de la ficha y dónde vive.

## Qué lleva dentro (no lo vigila el test, pero es el oficio)

- Comandos copiables con lo que **debe salir**: «funciona» no es una comprobación.
- Lo que requiere el OK de Pablo, y lo que no se ha comprobado, dicho como tal (`Sin comprobar`).
- Una idea en un sitio: si otra skill ya lo explica, se cita por su nombre.
