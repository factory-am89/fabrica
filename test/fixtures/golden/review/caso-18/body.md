## What changes

`debeParar(rondas)` en `scripts/lib/rondas.mjs`: dice si un PR lleva demasiadas rondas con «no» del revisor y el constructor debe parar y dejarlo escrito en vez de seguir arreglando. Devuelve un texto con el motivo cuando hay que parar y `null` cuando se puede seguir; lanza si `rondas` no es un entero no negativo. Con su test. Lo llamará `npm run done` en el siguiente trozo; hoy no lo llama nada.

## Evidence

Produced by `npm run evidence`. HEAD c91d3a4; merge-base with origin/main 6a0e5b2.

```
$ node --test --test-reporter=spec test/rondas.test.js
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
 2 files changed, 24 insertions(+)
(exit 0)
```

## Red before

Sin el módulo, el test nuevo da rojo:

```
$ node --test --test-reporter=spec test/rondas.test.js
✖ test/rondas.test.js
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'scripts/lib/rondas.mjs'
ℹ tests 1
ℹ pass 0
ℹ fail 1
(exit 1)
```

## Decisions

None

## Not verified

- El texto del motivo tal como lo verá una sesión de verdad: solo lo comprueban los tests.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
