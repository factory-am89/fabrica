## What changes

Plan nuevo, `plans/fuente-de-leccion.md`: un solo trozo para que cada lección de `lessons/` pueda decir en qué PR se vio el fallo por primera vez, con un campo nuevo `fuente`. Sirve para medir cuánto tarda una lección en pagarse, que hoy obliga a leer el texto de la lección. El trozo toca `scripts/lib/lessons.mjs`, su test y `fields.json`. Este PR solo añade el plan, ningún código.

## Evidence

Produced by `npm run evidence`. HEAD d84b2f6; merge-base with origin/main 5b543f2.

```
$ node scripts/check-plan.mjs --file plans/fuente-de-leccion.md
check-plan: ok
chunk 1: gate=false needsPablo=no
(exit 0)
```

```
$ git diff --shortstat origin/main...HEAD
 1 file changed, 25 insertions(+)
(exit 0)
```

## Red before

No hay test nuevo: el PR solo añade un plan.

## Decisions

None

## Not verified

- Que ningún lector de las lecciones se rompa con un campo más: no los he buscado.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
