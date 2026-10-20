## What changes

Cada reserva de `reparto.json` va a llevar una `prioridad` (`alta`, `media` o `baja`), para que `npm run sesiones` pueda decir cuál de dos ramas que se pisan debe ceder. Este PR añade `validarPrioridad(reserva)` en `scripts/lib/prioridad.mjs`, que exige el campo y rechaza cualquier otro valor, con su test. `reparto.json` hoy no tiene reservas (`"reservas": []`), así que no hay que migrar ninguna. Hacer que `validarReparto` exija el campo y que `sesiones` lo use viene en el siguiente trozo; hoy no lo llama nada.

## Evidence

Produced by `npm run evidence`. HEAD b82f6d0; merge-base with origin/main 3e90c17.

```
$ node --test --test-reporter=spec test/prioridad.test.js
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
 2 files changed, 26 insertions(+)
(exit 0)
```

## Red before

Sin el módulo, el test nuevo da rojo:

```
$ node --test --test-reporter=spec test/prioridad.test.js
✖ test/prioridad.test.js
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'scripts/lib/prioridad.mjs'
ℹ tests 1
ℹ pass 0
ℹ fail 1
(exit 1)
```

## Decisions

None

## Not verified

- La suite completa: solo he lanzado el fichero de arriba.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
