## What changes

Plan nuevo, `plans/aviso-de-cuota.md`: un solo trozo para que el arranque de cada sesión avise cuando le quedan pocas llamadas a GitHub, en vez de enterarse cuando `gh` ya falla. El trozo crea `scripts/lib/aviso-cuota.mjs` y su test; enchufarlo en `PASOS` de `scripts/al-arrancar.mjs` y fijar el umbral queda para el trozo siguiente. Este PR solo añade el plan, ningún código.

## Evidence

Produced by `npm run evidence`. HEAD 3f9a1c8; merge-base with origin/main 5b543f2.

```
$ node scripts/check-plan.mjs --file plans/aviso-de-cuota.md
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

- Que el trozo 1 quepa en un PR pequeño: es una estimación mía, no la he construido.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
