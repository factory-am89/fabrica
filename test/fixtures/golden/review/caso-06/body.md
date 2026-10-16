## What changes

Simplifica `scripts/veredicto.mjs`: quita el filtro por prefijo del juez (`PREFIJO_DEL_JUEZ` y `ID_DEL_JUEZ`) y el import de `ID_SOURCE` que ya no se usa. El filtro era redundante: `conocidos.has(r.id)` ya descarta cualquier id que no esté en la lista de preguntas del estándar cargado, así que una segunda comprobación por la forma del id no añade nada. Menos código en el veredicto, mismo resultado.

Principles: 4 (una idea, un sitio: un solo filtro de ids en vez de dos).

## Evidence

```
$ npm run lint

> lint
> eslint . --max-warnings 0
(exit 0)
```

```
$ node --test --test-reporter=spec test/verdict.test.js
ℹ tests 21
ℹ pass 21
ℹ fail 0
(exit 0)
```

```
$ git diff --shortstat origin/main...HEAD
 1 file changed, 2 insertions(+), 6 deletions(-)
(exit 0)
```

## Red before

No hay test nuevo: es una simplificación que no cambia el comportamiento, y `test/verdict.test.js` sigue en verde con y sin el cambio.

## Not verified

- No lancé la suite entera, solo `test/verdict.test.js`.
- Un estándar con preguntas de otro prefijo que no sea `C`: no lo probé.
