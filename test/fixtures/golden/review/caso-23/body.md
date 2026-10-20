## What changes

`formatearTamano(bytes)` en `scripts/lib/tamano.mjs`: pasa un número de bytes a «512 B», «1,5 KiB» o «3,0 MiB» (base 1024, una cifra decimal desde KiB) y lanza si lo que recibe no es un entero no negativo. Lo usará `npm run clean` en el siguiente trozo para decir cuánto espacio libera cada carpeta; hoy no lo llama nada. Con su test.

El encargo pedía exactamente eso: bytes a texto corto, con KiB/MiB/GiB y la coma decimal española.

## Evidence

Produced by `npm run evidence`. HEAD 2c9e5b4; merge-base with origin/main 77d1a0e.

```
$ node --test --test-reporter=spec test/tamano.test.js
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
 2 files changed, 33 insertions(+)
(exit 0)
```

## Red before

Sin el módulo, el test nuevo da rojo:

```
$ node --test --test-reporter=spec test/tamano.test.js
✖ test/tamano.test.js
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'scripts/lib/tamano.mjs'
ℹ tests 1
ℹ pass 0
ℹ fail 1
(exit 1)
```

## Decisions

- principio 4 | eligió: llamar a la función `formatearTamano` | descartó: llamarla `tamanoLegible` | motivo: decidido

## Not verified

- Tamaños por encima de GiB: la lista de unidades acaba ahí y un valor mayor se queda en GiB.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
