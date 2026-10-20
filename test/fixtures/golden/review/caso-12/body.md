## What changes

Primer paso de `npm run sesiones -- --purgar`, que borrará los ficheros de sesión que llevan más de N días sin tocarse. N sale de la variable de entorno `FABRICA_RETENCION_DIAS`; si no está puesta, 30. Nuevo `scripts/lib/retencion.mjs` con `diasDeRetencion(env)` y `esVieja(ultima, ahora, dias)`, y su test. Lo llamará `scripts/sesiones.mjs` en el siguiente trozo, que añade la opción `--purgar`; este PR no cambia ningún comando.

## Evidence

Produced by `npm run evidence`. HEAD d3e58a0; merge-base with origin/main b7714fc.

```
$ node --test --test-reporter=spec test/retencion.test.js
ℹ tests 4
ℹ pass 4
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
 2 files changed, 35 insertions(+)
(exit 0)
```

## Red before

Sin `scripts/lib/retencion.mjs` el test nuevo no arranca:

```
$ node --test --test-reporter=spec test/retencion.test.js
✖ test/retencion.test.js
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'scripts/lib/retencion.mjs'
ℹ tests 1
ℹ pass 0
ℹ fail 1
(exit 1)
```

## Decisions

None

## Not verified

- `npm run sesiones -- --purgar` contra ficheros de sesión reales: los tests usan fechas fijas y no tocan `~/.fabrica`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
