# Plan: aligerar los tests más lentos de la Fábrica sin que dejen de comprobar lo mismo

Verdict: casi todo el tiempo de esos tests es coste de lanzar procesos (`git push`, `node`), no de lo que comprueban, y la cifra de 464 s de la suite sale en buena parte de la carga de la máquina, no de los tests. Lo desagradable primero: los tiempos que se dieron (356 s, 152 s, 116 s) no se reproducen; medidos por fichero y en dos pasadas salen de 2 a 20 veces menos, y dos de las causas (carrera de procesos en `pull-main` y `arranque-a-la-vez`) no se arreglan sin quitar rondas, que es debilitar el test. Este plan propone cuatro trozos que no debilitan nada y uno (`golden-run`) que sí quita llamadas y por eso espera la decisión A de Pablo.

## Lo que hay hoy (comprobado)

Cada fichero por separado, `node --test --test-reporter=spec test/<fichero>`, el 2026-10-30, en `main` (c41d449) con otra sesión abierta. Dos pasadas seguidas; la segunda con la máquina menos cargada. Segundos por test; solo los de más de 1,5 s.

| Fichero y test | 1.ª pasada | 2.ª pasada |
|---|---|---|
| `invariants` «every machine case is caught…» | 46,7 | 26,8 |
| `golden-run` «9 casos por 3 intentos son 27 llamadas» | 86,4 | 17,9 |
| `golden-run` «el espacio de trabajo no contiene expected.json…» | 25,2 | 6,7 |
| `golden-run` «modelo, turnos y schema salen de revisor.yml» | 19,7 | 6,8 |
| `golden-run` «informe de varianza…» | 30,4 | 10,3 |
| `golden-run` (fichero entero) | 202,1 | 60,1 |
| `clean` «dos repos distintos (merge a base staging…)» | 53,3 | 8,0 |
| `clean` los otros 21 tests | 1,7 a 19,5 | 1,7 a 3,6 |
| `clean` (fichero entero) | 171,8 | 47,0 |
| `arranque-a-la-vez` «el arranque entero a la vez, 10 rondas…» | 28,7 | 17,5 |
| `pull-main` «a la vez que un bucle de `git fetch --prune`…» | 32,5 | 30,9 |
| `pull-main` «dos arranques a la vez no se pisan» | 15,1 | 12,2 |
| `pull-main` «rama suelta (HEAD separado)» | 1,7 | 1,6 |
| `tarea-ficha` «retirar: pregunta por el PR al repo de la ficha» | 4,1 | 2,8 |
| `tarea-ficha` (fichero entero) | 25,1 | 20,4 |
| `principal` «hook: no se deja engañar por Set-Location…» | 10,7 | 9,7 |
| `principal` «hook: niega la carpeta principal de otro repo…» | 5,0 | 6,1 |
| `principal` «hooks de git: niegan commit, merge y cherry-pick…» | 2,2 | 2,5 |

En la suite entera (`npm run done` en la rama de este plan, 2026-10-30, 1359 tests, 280,1 s de reloj, con una sola sesión más abierta), los más lentos fueron: `invariants` 179,5 s; `golden-run` «27 llamadas» 98,6 s; `arranque-a-la-vez` 94,5 s; `principal` «hook: no se deja engañar…» 60,6 s; `pull-main` «dos arranques» 52,4 s y «bucle de fetch» 48,6 s; `clean` «dos repos» 32,0 s. Es decir: `invariants` pasa de 26,8 s sola a 179,5 s con el resto corriendo (6,7 veces) y es el camino crítico de la suite; el hook de `principal`, de 9,7 a 60,6 s (6,2 veces).

Lo que dicen las dos columnas de arriba: `pull-main` «rama suelta» (116 s en la suite) tarda 1,6 s sola; `tarea-ficha` «retirar» (108 s) tarda 2,8 s; `principal` «hooks de git» (90 s) tarda 2,5 s. Esos tiempos eran espera por la carga (no se midió su causa exacta: la comparación es solo entre las dos pasadas y la suite entera). Los que no bajan entre pasadas (`pull-main` 30,9 s, `invariants` 26,8 s, `principal` hook 9,7 s) son coste propio.

Dónde se va el tiempo (todo medido; el contador envuelve `spawnSync` de `child_process` y lanza el fichero, 2026-10-30):
- `clean`: 468 procesos en 47 s; `git push origin` 41 veces y 14,5 s, el comando más caro; `node` (el token falso y los scripts) 24 veces, 4,0 s.
- `tarea-ficha`: 244 procesos en 24 s; `git push origin` 18 veces y 7,7 s.
- `principal`: 144 procesos en 16 s; 80 son `node .claude/hooks/carpeta-principal.mjs` y suman 12,4 s, lanzados uno detrás de otro.
- Un `git push` a un remoto local tarda 186 a 430 ms (dos pasadas del script de abajo); `git update-ref` en el remoto, apuntando a los objetos de la carpeta con `objects/info/alternates`, tarda 26 a 34 ms y `git fsck` del remoto sale limpio (probado en una carpeta temporal, 3 pruebas de cada). La prueba, `node pp.mjs` sobre una carpeta vacía, con su salida:
```js
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const g = (cwd, ...a) => { const s = performance.now(); const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' }); if (r.status) throw new Error(r.stderr); return [r.stdout.trim(), Math.round(performance.now() - s)]; };
rmSync('pp', { recursive: true, force: true });
mkdirSync('pp');
g('pp', 'init', '-q', '-b', 'main', 'a'); g('pp/a', 'commit', '-q', '--allow-empty', '-m', 'x'); g('pp', 'init', '-q', '--bare', '-b', 'main', 'r.git'); g('pp/a', 'remote', 'add', 'origin', '../r.git');
for (let i = 1; i <= 3; i++) console.log('push', g('pp/a', 'push', '-q', 'origin', `main:b${i}`)[1], 'ms');
const sha = g('pp/a', 'rev-parse', 'HEAD')[0];
writeFileSync('pp/r.git/objects/info/alternates', `${path.resolve('pp/a/.git/objects').replaceAll('\\', '/')}\n`);
for (let i = 1; i <= 3; i++) console.log('update-ref', g('pp/r.git', 'update-ref', `refs/heads/c${i}`, sha)[1], 'ms');
console.log(g('pp/r.git', 'fsck')[0] || 'fsck ok', g('pp/r.git', 'branch')[0].split('\n').length, 'ramas');
```
  Salida, pasada 1: `push 198 ms`, `push 186 ms`, `push 333 ms`, `update-ref 27 ms`, `update-ref 26 ms`, `update-ref 28 ms`, `fsck ok 6 ramas`. Pasada 2, con el bloque extraído de este plan: `push 430`, `277`, `237 ms`; `update-ref 34`, `32`, `32 ms`; `fsck ok 6 ramas`.
- El contador (misma salida con `node <contador> file:///.../test/<fichero>.test.js`; envuelve `spawnSync` y suma por comando; vive solo en este plan y se pega a mano en una carpeta temporal, no se añade al repo):
```js
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const orig = cp.spawnSync; const by = {};
cp.spawnSync = (c, a = [], ...r) => { const s = performance.now(); const x = orig(c, a, ...r); const k = `${c} ${Array.isArray(a) ? a.filter((q) => !q.startsWith('-')).slice(0, 2).join(' ') : ''}`; (by[k] ??= [0, 0]); by[k][0]++; by[k][1] += performance.now() - s; return x; };
syncBuiltinESMExports();
await import(process.argv[2]);
process.on('exit', () => console.error(Object.entries(by).sort((a, b) => b[1][1] - a[1][1]).slice(0, 8).map(([k, [n, ms]]) => `${n} ${Math.round(ms)} ms ${k}`).join(String.fromCharCode(10))));
```
  Salida sobre `clean`: `41 14491 ms git push origin`, `24 3970 ms node …`, `22 3859 ms git fetch origin`, `24 2960 ms git ls-remote origin`; sobre `tarea-ficha`: `18 7664 ms git push origin`; sobre `principal`: `80 12401 ms node` (los 80 son el hook `carpeta-principal.mjs`).
- `invariants`: ~50 procesos `node` uno detrás de otro (34 casos más sus controles, que se guardan por orden); `node --test test/goals.test.js` solo tarda 1,0 s y `node scripts/audit.mjs --json` 3,7 s. Todos usan una sola copia del repo, por eso no pueden ir a la vez.
- `golden-run`: una llamada con el `claude` falso cuesta ~0,66 s (17,9 s / 27) y el fichero hace 64 (27 + 9 + 2 + 1 + 12 + 1 + 3 + 3 + 6, contadas de los `pasada(...)` del test); cada una copia el juez entero a una carpeta nueva (`layWorkspace`, `scripts/golden-run.mjs`) y lanza `node`.
- `pull-main` (bucle, ~3 s por ronda) y `arranque-a-la-vez` (~1,7 s por ronda): cada ronda es un commit y un push en el remoto, un proceso `node` que carga `pull-main.mjs` o el arranque entero, y el bucle de `git fetch` compitiendo. Es el coste de lo que prueban.

## Chunks

### 1. El plan en `plans/`
Files: `plans/aligerar-tests-lentos.md`
Depends on: none
Blocked by: none
Existing: `git ls-tree --name-only origin/main plans/` (en c41d449) -> `app-admin.md cockpit.md menuplan-separation.md puente-2-alvaro.md puente-homenu.md registro-de-no.md revisor-huerfano.md revisor-pendiente.md trabajar-solos.md un-solo-bucle.md`; ninguno trata la velocidad de los tests.
Not done: no toca ningún test; solo deja el plan y la tabla de tiempos de antes.
Done:
```sh
node scripts/check-plan.mjs --file plans/aligerar-tests-lentos.md
```

### 2. `invariants`: los casos corren a la vez, cada uno en su copia del repo
Files: `test/invariants.test.js`
Depends on: 1
Blocked by: none
Existing: `git grep -n -E "concurrency|Promise.all" -- test/invariants.test.js` (en c41d449) -> sin salida, exit 1; `git grep -n -i "alternates\|update-ref" -- test` -> solo `test/evidence.test.js:252` (otra cosa). Hoy todos los casos usan la misma copia (`const repo`, línea 45) y `runWith` es `spawnSync`.
Not done: no quita ningún caso ni ningún control, no cambia `cases.json` ni las fixtures, no estrecha `--test` a un solo test de cada fichero (eso sí sería ver menos), no toca el resto de ficheros. Qué hace: `SLOTS` copias del repo (`repo-0`… en la misma carpeta temporal, cada una con su unión a `node_modules` que se quita como enlace antes de borrar, como hoy), `runWith` asíncrono con `spawn`, y una cola de casos que cada copia va vaciando; un control se guarda como promesa para que lo corra solo una. El test cuenta cuántos casos estuvieron en marcha a la vez y exige al menos 2 (una aserción que no depende de la carga y que hoy daría 1). Cada copia aplica sus ediciones y las devuelve como ahora, así que dos casos nunca editan el mismo fichero a la vez. Lector: el propio test, disparador `ci-test`; la regla «cada caso malo sale en rojo por su entrada real y su control en verde» no cambia. Mantiene C13: el test sigue fallando por un caso sin atrapar o un control en rojo. Si rompe `main`: revertir el PR desde una rama nueva.
Done:
```sh
node --test --test-reporter=spec test/invariants.test.js
# el test gana una aserción que no depende de la carga: el máximo de procesos a la vez que llegó a haber es al menos 2 (con c41d449 es siempre 1, así que rojo antes y verde después); la duración antes (26,8 s) y después va en el PR del trozo, como cifra y no como criterio
# caso malo en rojo: con un caso de cases.json que ninguna orden atrapa, o con un control roto, el test falla igual que antes y el PR enseña la salida
```

### 3. `principal`: las órdenes del hook se lanzan a la vez, con tope
Files: `test/principal.test.js`
Depends on: 1
Blocked by: none
Existing: `git grep -n -E "concurrency|Promise.all" -- test/principal.test.js` (en c41d449) -> sin salida, exit 1. La función `hook` (línea 42) y `hookEdicion` (línea 102) son `spawnSync` de `node .claude/hooks/carpeta-principal.mjs`; 80 lanzamientos en el fichero, 12,4 s medidos.
Not done: no llama a `decidir` dentro del proceso (se pierde la entrada real del hook, P12), no quita ninguna orden de las listas `negadas` y `vale`, no toca `.claude/hooks/carpeta-principal.mjs` ni los hooks de git. Qué hace: una función `hooks(lista)` que lanza con `spawn` hasta `TOPE` procesos a la vez y devuelve las decisiones en el orden de la lista; las listas `negadas`, `vale` y las de `hookEdicion` se evalúan con ella y se comparan una a una con el mensaje de la orden, como hoy. El test cuenta cuántos procesos del hook estuvieron en marcha a la vez y exige al menos 2 (hoy daría 1). Es el mismo proceso real con el mismo JSON por stdin. Lector: el propio test (`ci-test`). Mantiene C13: cada orden sigue teniendo su aserción con su mensaje.
Done:
```sh
node --test --test-reporter=spec test/principal.test.js
# el test gana la misma aserción de procesos a la vez (al menos 2; con c41d449 siempre 1, rojo antes y verde después); la duración antes (9,7 s) y después va en el PR del trozo, como cifra y no como criterio
# caso malo en rojo: quitar «Set-Location» de PROHIBIDOS en .claude/hooks/carpeta-principal.mjs hace fallar el test con el mensaje de la orden, antes y después
```

### 4. El montaje de los repos de prueba publica con `update-ref`, no con `git push`
Files: `test/apoyo/remoto.mjs`, `test/apoyo-remoto.test.js`, `test/clean.test.js`, `test/tarea-ficha.test.js`
Depends on: 1
Blocked by: none
Existing: `git grep -n -c "'push'" -- test` (en c41d449) -> `clean.test.js:6`, `tarea-ficha.test.js:2`, `pull-main.test.js:4`, `arranque-a-la-vez.test.js:2` y otros; `git ls-files test/apoyo` no trae ningún ayudante de remoto (`repo.mjs` crea solo el repo local).
Not done: no toca los `git push` de `pull-main` ni `arranque-a-la-vez` (cada ronda de esos tests es la carrera que se prueba; ver Decisions taken); no toca ningún `git push` que haga el código bajo prueba (`scripts/clean.mjs`, `retire.mjs` siguen borrando ramas remotas con `push` de verdad); no baja nada de `principal.test.js` ni de `golden-run`. Qué hace: `test/apoyo/remoto.mjs` exporta `publicar(carpeta, remoto, ramas)`: añade los objetos de la carpeta a `objects/info/alternates` del remoto (si no estaban) y hace `update-ref` de cada rama en el remoto y de su `refs/remotes/origin/<rama>` en la carpeta, que es lo que dejaba el `push`. `clean.test.js` y `tarea-ficha.test.js` la usan en el montaje (`mundo`, `ajeno`, `conPR`), no en las fusiones simuladas con un clon (esas son el mundo que cambia mientras se prueba). Lector: `test/apoyo-remoto.test.js` (`ci-test`), que comprueba que `git ls-remote`, `git clone` y un `git fetch` ven las ramas publicadas y que `git fsck` del remoto no dice nada. Riesgo: la limpieza lee `origin/<rama>`; si algún test depende de un detalle del `push` (la rama de seguimiento) se verá en rojo y se vuelve a `push` en ese test. Mantiene C13: el montaje cambia, las aserciones no.
Done:
```sh
node --test test/apoyo-remoto.test.js test/clean.test.js test/tarea-ficha.test.js
# además: git grep -c "'push'" -- test/clean.test.js test/tarea-ficha.test.js da 6 y 2 con c41d449 y debe dar menos en el PR (las llamadas de montaje pasan a `publicar`); el contador de «Dónde se va el tiempo» (41 y 18 `git push` antes) y las duraciones (47,0 s y 20,4 s antes) van en el PR del trozo como cifras
# caso malo en rojo: sin test/apoyo/remoto.mjs el test nuevo no carga; con una `publicar` que no escribe alternates, `git clone` del remoto falla y el test sale en rojo
```

### 5. `golden-run`: menos llamadas por test (espera a la decisión A)
Files: `test/golden-run.test.js`
Depends on: 1
Blocked by: A
Existing: `git grep -n -E "NUEVE|CHICO" -- test/golden-run.test.js` (en c41d449) -> `CHICO` (3 casos) y `NUEVE` (9 casos) definidos en las líneas 29-30; `NUEVE` se usa en las líneas 49 y 61 (los dos primeros tests). `MAX_CALLS = 96` (`scripts/golden-run.mjs:25`) tiene su propio test («más llamadas que el tope se rechaza antes de llamar a nadie»), que no cambia.
Not done: no toca `scripts/golden-run.mjs` ni la copia del juez por llamada (producción), no cambia `claude-falso.mjs`, no baja los intentos de los tests de varianza. Qué hace (opción 1 de A): el test «9 casos por 3 intentos son 27 llamadas» pasa a 3 casos por 3 intentos (9 llamadas) y comprueba el mismo producto casos x intentos, el anuncio antes de la primera llamada, el coste por llamada y el total; el del espacio de trabajo pasa de 9 a 3 llamadas. El título deja de decir «9» y «27». Se pierde que esas dos comprobaciones se hagan con seis casos más (`caso-03`, `04`, `05`, `06`, `08`, `09`) cuya diferencia con los tres que quedan es el contenido de `pr.diff` y `body.md`, que esas comprobaciones no leen. Ahorro esperado: 24 de 64 llamadas, ~16 s del fichero de 60 s (a 0,66 s la llamada; sin medir después). Lector: el propio test (`ci-test`).
Done:
```sh
node --test --test-reporter=spec --test-name-pattern="3 casos por 3 intentos son 9 llamadas" test/golden-run.test.js | grep -c "3 casos por 3 intentos son 9 llamadas"
# con c41d449 imprime 0 (ese test no existe, rojo) y después 1 (verde); la duración del fichero antes (60,1 s, 64 llamadas) y después va en el PR del trozo, como cifra
# caso malo en rojo: con GOLDEN_CLAUDE_BIN que cuenta una llamada de menos el test del producto falla
```

## Build order
Ola 1: 1. Ola 2: 2, 3, 4 (ficheros distintos, sin dependencia entre ellos). Ola 3: 5, cuando Pablo conteste A.

## Decisions taken
- principio 2 | eligió: dejar las 10 rondas de `arranque-a-la-vez` y de `pull-main` («bucle de fetch»), y las 3 de «dos arranques a la vez» | descartó: bajarlas a 3, que ahorraría unos 25 s de 64 pero verían menos veces una carrera que falló 26 de 30 arranques con `git pull` (comentario de `test/pull-main.test.js:155`, 23 oct 2026) | motivo: decidido
- principio 5 | eligió: lanzar a la vez las órdenes del hook y de los casos de `invariants` | descartó: llamar a `decidir` y a las funciones de cada script dentro del proceso del test, que es más rápido pero deja de probar la entrada real que lanza Claude y CI | motivo: decidido
- principio 2 | eligió: en el trozo 4 cambiar solo el montaje del mundo y dejar los `push` del código bajo prueba | descartó: sustituir también esos, que dejaría de probar el borrado real de ramas remotas | motivo: decidido
- principio 2 | eligió: el montaje del trozo 4 enlaza los objetos con `objects/info/alternates` y escribe las ramas con `update-ref` | descartó: copiar con `cpSync` un remoto plantilla ya montado, que no se midió y se elegiría por intuición, sin la cifra de antes y de después que sí tienen `update-ref` (26 a 34 ms) y `push` (186 a 430 ms) | motivo: decidido
- principio 2 | eligió: el número de copias (`SLOTS`) y el tope de procesos (`TOPE`) son constantes con nombre fijadas al medir en el PR de cada trozo | descartó: derivarlos de `os.availableParallelism()`, que da otro valor en CI que en el PC de Pablo y hace que la cifra no se reproduzca | motivo: decidido
- principio 2 | eligió: no mover ningún test a un grupo «lento» que no corra en local | descartó: un grupo aparte para `golden-run` e `invariants`, que quita de la vista de cada PR lo que el revisor de CI sí corre | motivo: decidido

## Decisions for Pablo

### A. ¿Dejas que `golden-run` pruebe con menos casos sus dos comprobaciones de 27 y 9 llamadas?
Por qué te lo pregunto: es recortar un test (la clase «Weaken a check» de `standards/intervention.md`), aunque lo que comprueba (cuántas llamadas se hacen, que el espacio de trabajo va limpio) se vea igual con 3 casos que con 9. Sin esto, el fichero sigue en 60 s y los 16 s de ahorro no llegan.
1. Sí, a 3 casos por 3 intentos y a 3 llamadas el del espacio de trabajo: 24 llamadas menos de 64, unos 16 s; se pierde la repetición con seis casos más, que no cambian lo que se comprueba (recommended)
2. Solo el del espacio de trabajo, de 9 a 3 llamadas: 6 llamadas menos, unos 4 s; el de las 27 llamadas queda como está
3. No: se queda como está y el fichero sigue en 60 s

## Not verified
- Ninguna cifra de «después»: este plan solo mide el antes. Cada trozo trae la suya en su PR, con la misma orden. Que los Done no usan un tope de segundos (depende de la carga, 6,7 veces entre sola y suite): prueban el cambio (procesos a la vez, nombre del test, `push` contados) y las duraciones se dan como cifras de antes y después, sin criterio de paso.
- Que los trozos 2 y 3 acorten la suite entera: lanzar a la vez no baja el trabajo total del procesador, solo el reloj de ese fichero, y ayuda si hay núcleos libres (en esta máquina `nproc` da 12) y `invariants` está en el camino crítico. Con la máquina justa de memoria puede no notarse. Los trozos 4 y 5 sí bajan trabajo (menos procesos), el 4 sin alcanzar a `pull-main` ni `arranque-a-la-vez`.
- La suite entera: una sola pasada (280,1 s), la de `npm run done` de este PR; no hay segunda. La cifra de 464 s de Pablo salió con el PC justo de memoria y dos sesiones, y por lo medido aquí es sobre todo carga, pero con una pasada no se separa cuánto.
- Que lanzar a la vez los casos de `invariants` (trozo 2) baje su 179,5 s dentro de la suite: con todos los ficheros compitiendo por el procesador, más procesos a la vez de un mismo fichero pueden repartirse la misma máquina y no acortar nada. Se sabrá al medir la suite entera en el PR del trozo 2; si no baja, se descarta ese trozo.
- Que `refs/remotes/origin/<rama>` hecha con `update-ref` sirva igual que la que deja `git push` para todo lo que lee `clean.test.js`; se sabe al construir el trozo 4.
- Cuántos núcleos o cuánta memoria usa `invariants` con `SLOTS` copias: el repo copiado pesa lo que `cpSync` copió en ~0,6 s por copia, sin medir el disco.
