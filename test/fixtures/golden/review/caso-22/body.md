## What changes

`contarRespuestas(respuestas)` y `conNo(respuestas)` en `scripts/lib/contar-respuestas.mjs`: dado lo que contesta el juez (una lista de `{ id, respuesta, prueba }`), la primera cuenta cuántos «sí», «no» y «no aplica» hay y lanza con el id si una respuesta no es ninguna de las tres; la segunda da los ids con «no». Es lo que necesita el resumen que pondrá `npm run done` al final de cada PR, en el siguiente trozo; hoy no lo llama nada. Con su test.

## Evidence

Produced by `npm run evidence`. HEAD 9d30b7a; merge-base with origin/main f4a82c6.

```
$ node --test --test-reporter=spec test/contar-respuestas.test.js
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
 2 files changed, 36 insertions(+)
(exit 0)
```

## Red before

Sin el módulo, el test nuevo da rojo:

```
$ node --test --test-reporter=spec test/contar-respuestas.test.js
✖ test/contar-respuestas.test.js
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'scripts/lib/contar-respuestas.mjs'
ℹ tests 1
ℹ pass 0
ℹ fail 1
(exit 1)
```

## Decisions

None

## Not verified

- Cómo quedará el resumen dentro de la salida de `npm run done`: aún no se llama desde ahí.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
