## What changes

Plan nuevo, `plans/arranque-rapido.md`: un solo trozo para que `npm run lessons`, que corre en el arranque de cada sesión, guarde lo que lee de `lessons/` durante la ejecución en vez de volver a leerlo. El trozo crea `scripts/lib/lecciones-leidas.mjs` y su test; cambiar `scripts/lessons.mjs` para que lo use queda para el trozo siguiente. Este PR solo añade el plan, ningún código.

## Evidence

Produced by `npm run evidence`. HEAD 05f3c9d; merge-base with origin/main 5b543f2.

```
$ node scripts/check-plan.mjs --file plans/arranque-rapido.md
check-plan: ok
chunk 1: gate=false needsPablo=no
(exit 0)
```

```
$ git diff --shortstat origin/main...HEAD
 1 file changed, 24 insertions(+)
(exit 0)
```

## Red before

No hay test nuevo: el PR solo añade un plan.

## Decisions

None

## Not verified

- Que el trozo no cambie la salida de `npm run lessons`: lo comprobará el trozo siguiente.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
