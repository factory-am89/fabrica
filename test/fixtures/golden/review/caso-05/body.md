## What changes

`npm run hora -- --utc` imprime, además de la hora de Madrid, la hora UTC (nueva `horaUtc` en `scripts/hora.mjs`), para poder comparar una hora límite de Madrid con la de un log de GitHub sin hacer la cuenta de cabeza. Sin `--utc` la salida no cambia. Test nuevo de `horaUtc`.

También añade `scripts/lib/zonas.mjs` con `horaDeZona(zona)` y la lista `ZONAS_CONOCIDAS`, por si hace falta la hora de otra zona más adelante (Londres, Nueva York). Hoy no la llama nada.

Principles: 1 (verdad: la hora UTC al lado de la de Madrid evita la confusión del 8 oct), 5 (lo vigila una máquina).

## Evidence

```
$ npm run lint

> lint
> eslint . --max-warnings 0
(exit 0)
```

```
$ node --test --test-reporter=spec
ℹ tests 313
ℹ pass 313
ℹ fail 0
(exit 0)
```

```
$ node --test --test-reporter=spec test/hora.test.js
ℹ tests 6
ℹ pass 6
ℹ fail 0
(exit 0)
```

```
$ git diff --shortstat origin/main...HEAD
 3 files changed, 22 insertions(+), 1 deletion(-)
(exit 0)
```

## Red before

Sin `horaUtc` el test nuevo da rojo:

```
$ node --test --test-reporter=spec test/hora.test.js
✖ test/hora.test.js
  SyntaxError: The requested module '../scripts/hora.mjs' does not provide an export named 'horaUtc'
ℹ tests 1
ℹ pass 0
ℹ fail 1
(exit 1)
```

Con `horaUtc` en `scripts/hora.mjs`, 6 de 6.

## Not verified

- La opción `--utc` lanzada de verdad desde `npm run hora`: el test solo cubre `horaUtc`.
- `zonas.mjs` no tiene test.
