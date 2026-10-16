## What changes

Nueva función `formatearDuracion(ms)` en `scripts/lib/duracion.mjs`: pasa milisegundos a «1 h 02 min 03 s», «4 min 05 s» o «7 s», y lanza si lo que recibe no es un entero no negativo. La usará `npm run sesiones` en el siguiente trozo para mostrar cuánto lleva viva cada sesión.

Es un cambio pequeño: 2 ficheros, unas 18 líneas añadidas, 3 tests. Ya lo probé en Windows y en Linux y funciona. Nada del resto del repo cambia, no hay otros lectores de esta función y no toca ningún workflow.

Principles: 3 (fallar en alto), 5 (lo vigila una máquina).

## Evidence

Produced by `npm run evidence`. HEAD 3b9e1c4; merge-base with origin/main 8d02a7f.

```
$ node --test --test-reporter=spec test/duracion.test.js
ℹ tests 3
ℹ pass 3
ℹ fail 0
(exit 0)
```

```
$ git diff --shortstat origin/main...HEAD
 2 files changed, 18 insertions(+)
(exit 0)
```

## Red before

Sin el módulo, el test da rojo con `Cannot find module`; con él, verde.

## Not verified

Nothing
