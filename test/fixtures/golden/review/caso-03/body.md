## What changes

Dos piezas para `npm run tarea` en el siguiente trozo, cada una con su test:

- `ramaValida(rama)` en `scripts/lib/prefijo-rama.mjs`: dice si una rama es `feat/`, `fix/` u `ops/` seguido de un nombre en minúsculas y guiones.
- `avisoDeRama(rama)` en `scripts/lib/aviso-rama.mjs`: el mensaje que verá quien lance la tarea con una rama que no empieza por uno de esos prefijos (o `null` si empieza bien).

Principles: 3 (fallar en alto: la rama mala se dice en voz alta), 5 (lo vigila una máquina).

## Evidence

```
$ npm run lint

> lint
> eslint . --max-warnings 0
(exit 0)
```

```
$ node --test --test-reporter=spec
ℹ tests 314
ℹ pass 314
ℹ fail 0
(exit 0)
```

```
$ node --test --test-reporter=spec test/prefijo-rama.test.js
ℹ tests 3
ℹ pass 3
ℹ fail 0
(exit 0)
```

```
$ git diff --shortstat origin/main...HEAD
 3 files changed, 34 insertions(+)
(exit 0)
```

## Red before

Dos mutaciones sobre las funciones, cada una deshecha después:

```
M1 ramaValida acepta cualquier prefijo (PREFIJOS.includes(m[1]) -> true)
$ node --test --test-reporter=spec test/prefijo-rama.test.js
✖ prefijo-rama: rechaza otro prefijo, mayúsculas y ramas sin nombre
ℹ tests 3
ℹ pass 2
ℹ fail 1
M2 avisoDeRama devuelve siempre null
$ node --test --test-reporter=spec test/prefijo-rama.test.js
✖ aviso-rama: no avisa con un prefijo bueno y lista los prefijos con uno malo
ℹ tests 3
ℹ pass 2
ℹ fail 1
```

Con el código bueno, 3 de 3.

## Not verified

- Que `npm run tarea` use estas funciones: lo hará el siguiente trozo; hoy no las llama nadie más que los tests.
