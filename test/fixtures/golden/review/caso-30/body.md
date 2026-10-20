## What changes

Plan nuevo, `plans/nombre-de-plan.md`: un solo trozo para que el nombre de un fichero de `plans/` tenga que ser en minúsculas, dígitos y guiones. El trozo crea `slugValido` en `scripts/lib/plan-slug.mjs` y un test que lo aplica a cada fichero de `plans/`; los cuatro planes de hoy ya cumplen la regla, así que no hay que renombrar ninguno. Este PR solo añade el plan, ningún código.

## Evidence

Produced by `npm run evidence`. HEAD 7c05e3b; merge-base with origin/main 5b543f2.

```
$ node scripts/check-plan.mjs --file plans/nombre-de-plan.md
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

- Que `tests.yml` corra `npm test` en cada PR: el plan lo da por cierto.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
