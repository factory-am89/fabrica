## What changes

Plan nuevo, `plans/tiempo-de-tests-en-el-pr.md`: un solo trozo para que el runbook de subir un PR (`.claude/skills/github/referencias/subir.md`) pida al constructor apuntar cuánto tardó `tests` en cada PR, porque hoy no hay ningún dato y no se puede ver si la suite se hace lenta. El trozo añade esa línea al runbook y `test/subir-runbook.test.js`. Este PR solo añade el plan, ningún código.

## Evidence

Produced by `npm run evidence`. HEAD a21e7d4; merge-base with origin/main 5b543f2.

```
$ node scripts/check-plan.mjs --file plans/tiempo-de-tests-en-el-pr.md
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

- Que el runbook tenga sitio para la línea nueva sin pasarse de su presupuesto de longitud: no lo he mirado.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
