## What changes

`npm run limpiar -- --dry-run` lista las carpetas `fabrica-<tema>` hermanas que se podrían borrar. Una carpeta se puede borrar cuando su rama está fusionada y `git status` no muestra nada sin guardar. Esto añade el segundo punto: `scripts/lib/carpeta-limpia.mjs` con `carpetaLimpia(carpeta)` (true si `git status --porcelain` no devuelve líneas) y su uso en `scripts/limpiar-lista.mjs`, que imprime una línea por carpeta.

No borra nada: solo lista. El borrado real queda para el siguiente trozo.

## Evidence

Produced by `npm run evidence`. HEAD a07be52; merge-base with origin/main 91d4c30.

```
$ node --test --test-reporter=spec test/carpeta-limpia.test.js
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
$ node scripts/limpiar-lista.mjs C:\dev\fabrica-ejemplo
C:\dev\fabrica-ejemplo: limpia
(exit 0)
```

## Red before

Sin el módulo, el test nuevo da rojo:

```
$ node --test --test-reporter=spec test/carpeta-limpia.test.js
✖ test/carpeta-limpia.test.js
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'scripts/lib/carpeta-limpia.mjs'
ℹ tests 1
ℹ pass 0
ℹ fail 1
(exit 1)
```

## Decisions

None

## Not verified

- Una carpeta con cambios sin guardar en un repo real: el test usa un repo temporal con un fichero sin añadir.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
