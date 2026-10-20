## What changes

`porcentaje(parte, total)` en `scripts/lib/porcentaje.mjs`: devuelve el entero redondeado seguido de « %» («38 %»), y lanza si `total` no es un entero mayor que cero o si `parte` no está entre 0 y `total`. Es lo que necesita el informe de la pasada del corpus, que hoy escribe el redondeo a mano en tres sitios; el informe lo usará en el siguiente trozo. Con su test.

## Evidence

Los tests pasan (3 en el fichero nuevo y el resto de la suite sin cambios) y el lint sale limpio. Lo he lanzado en mi máquina antes de subir y todo estaba en verde. La función da «38 %» para 3 de 8, como se espera.

```
$ git diff --shortstat origin/main...HEAD
 2 files changed, 25 insertions(+)
(exit 0)
```

## Red before

El test nuevo falla si se quita la función.

## Decisions

None

## Not verified

Nothing

🤖 Generated with [Claude Code](https://claude.com/claude-code)
