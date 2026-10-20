## What changes

`leerCuota(fichero)` en `scripts/lib/cuota-local.mjs`: lee el JSON `{ "restantes": n, "reinicio": "<fecha ISO>" }` donde la sesión guarda cuántas llamadas a GitHub le quedan, y lo devuelve ya comprobado. Lanza, nombrando el fichero, si falta, no es JSON, `restantes` no es un entero no negativo o `reinicio` no es una fecha. Con su test. Lo usará `scripts/clean.mjs` en el siguiente trozo para no pasarse de la cuota; hoy no lo llama nada.

## Evidence

Produced by `npm run evidence`. HEAD 6b0e8d5; merge-base with origin/main 9c4d2f1.

```
$ node --test --test-reporter=spec test/cuota-local.test.js
ℹ tests 3
ℹ pass 3
ℹ fail 0
(exit 0)
```

```
$ npm run lint

> lint
> eslint . --max-warnings 0
(exit 0)
```

```
$ git diff --shortstat origin/main...HEAD
 2 files changed, 44 insertions(+)
(exit 0)
```

## Red before

Sin el módulo, el test nuevo da rojo:

```
$ node --test --test-reporter=spec test/cuota-local.test.js
✖ test/cuota-local.test.js
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'scripts/lib/cuota-local.mjs'
ℹ tests 1
ℹ pass 0
ℹ fail 1
(exit 1)
```

## Decisions

- principio 3 | eligió: lanzar un `Error` con la causa original | descartó: lanzar un `TypeError` con la causa original | motivo: decidido

## Not verified

- El fichero de cuota real de una sesión: los tests escriben los suyos en una carpeta temporal.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
