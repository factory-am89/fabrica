## What changes

`etiquetaDeEstado(estado)` en `scripts/lib/etiqueta-estado.mjs`: pasa el estado de un PR de GitHub (`abierto`, `borrador`, `fusionado`, `cerrado`) al texto corto que imprimirá `npm run sesiones` junto a cada rama («PR abierto», «PR en borrador», etc.), y lanza con el valor recibido si el estado no es ninguno de esos cuatro. Con su test. Lo usará `scripts/sesiones.mjs` en el siguiente trozo; hoy no lo llama nada.

## Evidence

Produced by `npm run evidence`. HEAD 0f7c2e6; merge-base with origin/main d51a8b9.

```
$ node --test --test-reporter=spec test/etiqueta-estado.test.js
ℹ tests 2
ℹ pass 2
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
 2 files changed, 30 insertions(+)
(exit 0)
```

## Red before

Sin el módulo, el test nuevo da rojo:

```
$ node --test --test-reporter=spec test/etiqueta-estado.test.js
✖ test/etiqueta-estado.test.js
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'scripts/lib/etiqueta-estado.mjs'
ℹ tests 1
ℹ pass 0
ℹ fail 1
(exit 1)
```

## Decisions

None

## Not verified

- Cómo se verá la etiqueta dentro de la línea de `npm run sesiones`: aún no se llama desde ahí.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
