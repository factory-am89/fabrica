## What changes

Encargo: «un resumen de las lecciones por pregunta». `node scripts/resumen-lecciones.mjs` imprime una línea `pregunta,lecciones` por cada pregunta que tiene alguna lección, con cabecera y ordenadas por id (por ejemplo `C5,2`). Reutiliza `readLessons` de `scripts/lib/lessons.mjs`; no cambia ninguna lección. Con su test, que también lanza el comando.

## Evidence

Produced by `npm run evidence`. HEAD 1a8d4c7; merge-base with origin/main e60b3a9.

```
$ node --test --test-reporter=spec test/resumen-lecciones.test.js
ℹ tests 2
ℹ pass 2
ℹ fail 0
(exit 0)
```

```
$ node scripts/resumen-lecciones.mjs
pregunta,lecciones
C5,2
C9,4
(exit 0)
```

```
$ npm run lint

> lint
> eslint . --max-warnings 0
(exit 0)
```

## Red before

Sin el script, el test nuevo da rojo:

```
$ node --test --test-reporter=spec test/resumen-lecciones.test.js
✖ test/resumen-lecciones.test.js
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'scripts/resumen-lecciones.mjs'
ℹ tests 1
ℹ pass 0
ℹ fail 1
(exit 1)
```

## Decisions

None

## Not verified

- Que alguien lea el CSV en una hoja de cálculo: no lo he abierto en ninguna.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
