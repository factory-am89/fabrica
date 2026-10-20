## What changes

`npm run ajustes -- poner <clave> <valor>` guarda una preferencia local de la sesión (por ejemplo `silencio-hooks`) en `.fabrica-ajustes.json`, en la carpeta de trabajo. Nuevo `scripts/lib/ajustes.mjs` con `leerAjustes` y `ponerAjuste`, y el script `scripts/ajustes.mjs` que los llama; `scripts/al-arrancar.mjs` lo leerá en el siguiente trozo.

Si el fichero no se puede leer, `leerAjustes` devuelve un objeto vacío y `ponerAjuste` sigue adelante: así una sesión nueva, sin fichero, funciona a la primera y nadie ve un error por algo tan pequeño.

## Evidence

Produced by `npm run evidence`. HEAD 6f2a9d1; merge-base with origin/main 4c81e07.

```
$ node --test --test-reporter=spec test/ajustes.test.js
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
 3 files changed, 62 insertions(+)
(exit 0)
```

## Red before

Sin `scripts/lib/ajustes.mjs` el test nuevo no arranca:

```
$ node --test --test-reporter=spec test/ajustes.test.js
✖ test/ajustes.test.js
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'scripts/lib/ajustes.mjs'
ℹ tests 1
ℹ pass 0
ℹ fail 1
(exit 1)
```

## Decisions

None

## Not verified

- `npm run ajustes` lanzado a mano desde la raíz del repo: los tests llaman a las funciones con una carpeta temporal.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
