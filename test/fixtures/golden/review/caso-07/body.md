## What changes

`test/proyecto-nuevo.prueba.ps1` (el gh falso de `apps/proyecto-nuevo.ps1`) estaba roto en Windows en toda copia limpia de `main` desde #54. Dos aserciones («lista de PR ilegible» y «repo ilegible») casaban `Bad gateway` con una regex que llevaba un salto de linea LITERAL dentro de los corchetes (`'Bad[ <LF>]+gateway'`, resto de un `sed`). El CI de Linux salta este test (necesita `powershell.exe` 5.1), por eso no se vio.

Cambio, solo en ese fichero (2 lineas anadidas, 4 quitadas): las dos regex pasan a `Bad\s+gateway`, sin saltos literales. No se toca la captura de salida (`Out-String` sin ancho): ninguna aserción necesita un ancho fijo, asi que no se anade.

Por que la de «lista de PR» no fallaba y la de «repo» si: el texto de error de «los PR abiertos» es mas corto, la linea no se parte y `Bad gateway` sale con un espacio, que la regex vieja aceptaba (`[ \n]` incluye el espacio). El de «repo» es mas largo, PowerShell parte la linea entre `Bad` y `gateway` con `\r\n`, y `\r` no esta en `[ \n]`. O sea: la de «lista» era fragil (dependia de que la linea no se partiera), la de «repo» estaba rota.

Principles: 2 (evidencia: rojo y verde con su comando), 5 (la regla que comprueba una maquina no depende de como esta escrita la copia de trabajo), 1 (el fallo estaba en main y se dice).

## Evidence

Produced by `npm run evidence`. HEAD e496518; merge-base with origin/main f919321.

Filter, applied in code: for `node --test` (run with `--test-reporter=spec`) only lines starting with `ℹ tests`, `ℹ pass`, `ℹ fail` and `✖` are kept, and a duration at the end of a kept line, such as ` (12.3ms)`, is removed so the block is reproducible; every other command is raw. Output is stdout followed by stderr.

```
$ npm run lint

> lint
> eslint . --max-warnings 0
(exit 0)
```

```
$ node --test --test-reporter=spec
ℹ tests 540
ℹ pass 540
ℹ fail 0
(exit 0)
```

```
$ node --test --test-reporter=spec test/proyecto-nuevo.test.js
ℹ tests 4
ℹ pass 4
ℹ fail 0
(exit 0)
```

```
$ git diff --shortstat origin/main...HEAD
 1 file changed, 2 insertions(+), 4 deletions(-)
(exit 0)
```

## Red before

Fichero de `origin/main` (f919321) guardado en `/tmp/main.ps1` y lanzado contra `apps/proyecto-nuevo.ps1` de esta carpeta, que esta limpia en LF:

```
$ git ls-files --eol test/proyecto-nuevo.prueba.ps1
i/lf    w/lf    attr/text=auto eol=lf 	test/proyecto-nuevo.prueba.ps1
$ powershell -File /tmp/main.ps1 -Script apps/proyecto-nuevo.ps1 | grep -E "FALLO|ilegible"
OK: lista de PR ilegible: sale 1 con el motivo y la salida de gh
OK: lista de PR ilegible: no crea rama ni PR
FALLO: repo ilegible: dice que no es JSON con la salida y no culpa a los permisos
OK: instalaciones ilegibles: el pendiente lleva el motivo y no se crea el ruleset
OK: secretos ilegibles: para con el motivo
```

Con el arreglo, la misma carpeta:

```
$ powershell -File test/proyecto-nuevo.prueba.ps1 -Script apps/proyecto-nuevo.ps1  ->  29 OK, 0 FALLO
```

La carpeta donde «pasaba», antes de que se retirara, tenia el fichero con finales de linea mezclados; lo que se vio de ella: `git ls-files --eol test/proyecto-nuevo.prueba.ps1` daba `i/lf    w/mixed`, y en `C:\dev\fabrica-admin-gate-test` (donde fallaba) `i/lf    w/lf` (dato del coordinador; esas carpetas ya no existen y no puedo repetir el comando).

## Revision de las demas aserciones

Script usado (`/tmp/lit.py`: busca un salto de linea dentro de cada `-match '...'` / `-notmatch '...'`):

```
$ python /tmp/lit.py /tmp/main.ps1
salto literal dentro de -match en la linea 153 : 'Bad[ \n]+gateway'
salto literal dentro de -match en la linea 158 : 'Bad[ \n]+gateway'
/tmp/main.ps1 -> aserciones -match/-notmatch: 31 con salto literal: 2
$ python /tmp/lit.py test/proyecto-nuevo.prueba.ps1
test/proyecto-nuevo.prueba.ps1 -> aserciones -match/-notmatch: 31 con salto literal: 0
```

## Not verified

- No relance el arreglo en las carpetas donde fallaba (ya no existen); el rojo y el verde estan en esta carpeta limpia en LF.
- Aserciones largas que PowerShell pudiera partir en mitad de una palabra: no hay ninguna hoy (las frases buscadas son cortas o usan `\s+` entre palabras); si se anade una, el ancho de la consola podria afectarla y no hay test que lo pruebe.
- Si #58 cambia las mismas lineas habra que conservar lo de los dos al rebasar.
- Sigue sin lanzarse contra GitHub real; el test solo corre en Windows.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
