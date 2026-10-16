## What changes

Nueva función `nombreDeRama(titulo)` en `scripts/lib/nombre-rama.mjs`: pasa un título a un nombre de rama (minúsculas, sin tildes, palabras unidas por guiones) y lanza si el título no tiene ninguna letra ni número. La usará `npm run tarea` en el siguiente trozo para proponer la rama; este PR solo trae la función y su test.

Principles: 3 (fallar en alto: un título vacío lanza), 5 (lo vigila una máquina).

## Evidence

```
$ npm run lint

> lint
> eslint . --max-warnings 0
(exit 0)
```

```
$ node --test --test-reporter=spec
ℹ tests 311
ℹ pass 311
ℹ fail 0
(exit 0)
```

```
$ node --test --test-reporter=spec test/nombre-rama.test.js
ℹ tests 2
ℹ pass 2
ℹ fail 0
(exit 0)
```

```
$ git diff --shortstat origin/main...HEAD
 2 files changed, 33 insertions(+)
(exit 0)
```

## Red before

Sin el módulo, el test nuevo da rojo:

```
$ mv scripts/lib/nombre-rama.mjs /tmp/ && node --test --test-reporter=spec test/nombre-rama.test.js
✖ test/nombre-rama.test.js
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'scripts/lib/nombre-rama.mjs' imported from test/nombre-rama.test.js
ℹ tests 1
ℹ pass 0
ℹ fail 1
(exit 1)
```

Con el módulo puesto, verde (el bloque de Evidence).

## Not verified

- Que el nombre salga bien con alfabetos que no sean latinos: no lo probé.
- Que `npm run tarea` acepte el nombre propuesto: todavía no lo llama nadie.
