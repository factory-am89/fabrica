## What changes

`npm run ramas-abiertas` imprime, de una pasada, el estado de los PR de las ramas de las carpetas hermanas (`feat/...`, `fix/...`): una línea por PR con su número, su título y si `tests` y `revisor` están en verde. Nuevo `scripts/lib/estado-prs.mjs` con `estadoDePrs(ramas, consulta)`, que pregunta por todas las ramas a la vez con `Promise.allSettled` para no esperar una tras otra, y el script `scripts/ramas-abiertas.mjs`, que lo imprime.

`consulta(rama)` es la llamada a GitHub (la inyecta el script; en los tests es un falso). Hoy solo la usa `ramas-abiertas`.

## Evidence

Produced by `npm run evidence`. HEAD 4be1c90; merge-base with origin/main e2a5d37.

```
$ node --test --test-reporter=spec test/estado-prs.test.js
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
 3 files changed, 47 insertions(+)
(exit 0)
```

## Red before

Sin el módulo, el test nuevo da rojo:

```
$ node --test --test-reporter=spec test/estado-prs.test.js
✖ test/estado-prs.test.js
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'scripts/lib/estado-prs.mjs'
ℹ tests 1
ℹ pass 0
ℹ fail 1
(exit 1)
```

## Decisions

None

## Not verified

- La llamada real a GitHub: `ramas-abiertas` no se ha lanzado contra la API, solo contra el falso de los tests.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
