## What changes

Borra `scripts/lib/formato-viejo.mjs` y su test `test/formato-viejo.test.js`: `leerFormatoViejo` leía las fichas de sesión del formato anterior (una línea `clave=valor` por campo), que dejó de escribirse cuando las fichas pasaron a JSON. Ya no lo usa nadie; ningún otro fichero lo importa, así que se puede quitar sin cambiar nada más. Son 2 ficheros borrados, 33 líneas menos.

## Evidence

Produced by `npm run evidence`. HEAD 17d0b6a; merge-base with origin/main c58e214.

```
$ npm run lint

> lint
> eslint . --max-warnings 0
(exit 0)
```

```
$ node --test --test-reporter=spec
ℹ tests 507
ℹ pass 507
ℹ fail 0
(exit 0)
```

```
$ git diff --shortstat origin/main...HEAD
 2 files changed, 0 insertions(+), 33 deletions(-)
(exit 0)
```

## Red before

No hay test nuevo: solo se borra uno, el del módulo que se quita.

## Decisions

None

## Not verified

- Ninguna ficha de sesión antigua que alguien tenga todavía en `~/.fabrica`: si queda alguna en el formato viejo, `leerFicha` ya la rechaza desde que las fichas son JSON.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
