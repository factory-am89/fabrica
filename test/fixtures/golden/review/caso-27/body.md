## What changes

Encargo: «cuando dos ramas reservan el mismo fichero en `reparto.json`, `sesiones` tiene que decir cuál cede». `quienCede(a, b)` en `scripts/lib/quien-cede.mjs` recibe dos reservas y devuelve la rama que cede, o `null` si no se pisan; para saber si se pisan llama a `solapan` de `scripts/lib/work-split.mjs`, sin copiar su lógica. Con su test. Lo llamará `scripts/sesiones.mjs` en el siguiente trozo; hoy no lo llama nada.

## Evidence

Produced by `npm run evidence`. HEAD 8e51c2b; merge-base with origin/main 4d6a7f0.

```
$ node --test --test-reporter=spec test/quien-cede.test.js
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
 2 files changed, 28 insertions(+)
(exit 0)
```

## Red before

Sin el módulo, el test nuevo da rojo:

```
$ node --test --test-reporter=spec test/quien-cede.test.js
✖ test/quien-cede.test.js
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'scripts/lib/quien-cede.mjs'
ℹ tests 1
ℹ pass 0
ℹ fail 1
(exit 1)
```

## Decisions

- principio 4 | eligió: importar `solapan` de `work-split.mjs` | descartó: copiar su comparación de ficheros en este módulo | motivo: decidido

## Not verified

- Dos reservas con el mismo `hasta`: el test no las cubre.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
