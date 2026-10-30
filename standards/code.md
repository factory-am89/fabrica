# Estándar de código

Preguntas de sí o no (la lista es la de «Preguntas», más abajo; nadie guarda el número). Cada una dice quién la comprueba: la **máquina** (el CI, workflow `tests`) o el **revisor**. Todas deben ser `sí` (o `no aplica`) para fusionar.

## De dónde sale

Casos reales de MenuPlan: 118 issues `tipo:caso` a 15 oct 2026.

```
gh api "repos/pabloam89/MenuPlan/issues?labels=tipo:caso&state=all&per_page=100" --paginate
```

Solo 30 de los 118 llevan etiqueta `causa:`, así que no cuenta la etiqueta: agrupé a mano por el título (97 de 118; el resto son casos sueltos). Es una clasificación mía, no medida. Además 102 de 118 son `area:ops`, fallos de la maquinaria de MenuPlan: la muestra sesga hacia ella.

| Clase | Casos | Pregunta |
|---|---|---|
| Vigilante falso: la guardia niega lo bueno por el texto del comando | 22 | ninguna: la Fábrica no tiene guardia; la lección es no construirla (principio 5: solo checks que se prueban) |
| Test frágil: depende de carga, tiempo, historial de git o entorno | 21 | C7 |
| Dos fuentes: un dato copiado a mano que se desincroniza | 11 | C8 |
| Error silencioso: se traga el fallo y sigue | 11 | C5 |
| Verde falso: el test no prueba la regla | 9 | C6 |
| Afirmar sin comprobar: hechos copiados sin releer la fuente | 8 | C9 |
| Secreto o dato sensible expuesto | 8 | C10 |
| Regla solo en texto, sin check | 7 | principio 5 y C4 |

C1 a C3 son lo mínimo de cualquier repo. C4 (acciones por SHA, permisos), C11 y C12 (tamaño y alcance del PR) y C13 (no rebajar comprobaciones, la contrapartida de que ningún cambio pase por una persona; la única anulación de un «no» es el Approve de un dueño, regla en `standards/intervention.md`, «Who decides a merge») no salen de un caso contado: vienen del diseño de la Fábrica (#875 en MenuPlan) y de partir el trabajo en trozos pequeños. C14 a C17 salen de los invariantes de `goals.json` (I2, I4 e I3): lo repetido es dato, lo decidido queda apuntado, el plan cumple su estándar y un check se dispara por su entrada real; C16 es la puente que da juez a las preguntas de revisor de `standards/plan.md` sin tocar `revisor.yml` (el registro guarda «C16», no la P que falla).

## Preguntas

### C1 — ¿El lint pasa sin avisos?
Quién: máquina (`npm run lint`; en un repo que llama a `tests.yml`, el mismo `eslint.config.js` de la Fábrica, bajado a `.fabrica/`).
Bien: `eslint . --max-warnings 0` sale con 0.
Mal: un `// eslint-disable` sin motivo para que pase.

### C2 — ¿Pasan todos los tests?
Quién: máquina (`npm test`, que usa `node --test`).
Bien: la suite entera en verde en el PR.
Mal: «el test que falla es de otro»: si falla, no se fusiona.

### C3 — ¿Ninguna función pasa de 100 líneas?
Quién: máquina (ESLint `max-lines-per-function: 100`).
Bien: una función por idea, de 20 líneas.
Mal: una función de 300 líneas que lee, valida y escribe.

### C4 — ¿Cada acción de un workflow va fijada por SHA, y cada workflow declara sus permisos?
Quién: máquina (`test/workflows.test.js`, que `tests.yml` lanza también sobre el repo que lo llama).
Bien: `uses: actions/checkout@<40 hex> # v7.0.1` y `permissions: contents: read`.
Mal: `uses: actions/checkout@v7` (una etiqueta se puede mover) o un workflow sin `permissions`.
Excepción, una sola y comprobada por máquina (`accionFijada` en `scripts/lib/actions.mjs`, probada en `test/revisor-workflow.test.js`): `uses: factory-am89/fabrica/.github/workflows/<fichero>.yml@main`, el juez reutilizable de la Fábrica, que los repos de la organización llaman siempre en su versión actual. Ningún otro repo, ruta ni referencia sin SHA.
Aplica también al repo que llama: sus workflows pasan por la misma comprobación, sin «no aplica».

### C5 — ¿Todo fallo se ve, se lanza o se registra, y nada lo sustituye por un valor por defecto?
Quién: revisor (el lint solo ve el `catch` vacío).
Bien: `catch (e) { throw new Error('no se pudo leer X', { cause: e }) }`.
Mal: `catch { return [] }`: una carga fallida se confunde con «no hay nada» y se pisan datos.

### C6 — ¿El test nuevo se vio fallar sin el cambio, y comprueba la regla y no solo que existe?
Quién: revisor (el PR trae el comando y la salida del test en rojo antes).
Bien: «sin el arreglo, `node --test test/x.test.js` da 1 fallo (esperaba 3, salió 0); con él, verde».
Mal: un test que solo comprueba que el fichero existe o que la función no lanza.

### C7 — ¿Los tests son deterministas: sin reloj, red, carga de la máquina, historial de git ni orden entre tests?
Quién: revisor.
Bien: la fecha entra como parámetro; el repo de prueba se crea en una carpeta temporal.
Mal: un tope de tiempo de 50 ms, o un test que lee `git log` y falla en un clon poco profundo.

### C8 — ¿Cada dato o vocabulario vive en un solo sitio?
Quién: revisor.
Bien: una constante exportada y todos la importan.
Mal: la misma lista copiada en dos ficheros «por ahora», sin un test que las compare.

### C9 — ¿Cada afirmación del PR trae el comando y su salida, y lo no comprobado se dice?
Quién: revisor.
Bien: «`npm test` da 14 pasan, 0 fallan; no probé en Windows».
Mal: «funciona», «sin lectores», «ya lo probé», sin comando.

### C10 — ¿El diff está libre de secretos, claves y datos personales?
Quién: revisor (el secret scanning de GitHub avisa de formatos conocidos, no de todo).
Bien: solo el nombre de la variable, `process.env.REVISOR_APP_KEY`.
Mal: un token en un `.env` commiteado, o un detalle de seguridad escrito en un issue público.

### C11 — ¿El PR es una sola idea y cabe en una sentada de revisión?
Quién: revisor.
Bien: un script y su test, 150 líneas.
Mal: un arreglo, un renombrado y una función nueva mezclados.

### C12 — ¿Todo lo que añade tiene un lector y solo toca lo del encargo?
Quién: revisor.
Bien: la función nueva la llama algo, o el PR dice quién la usará en el siguiente trozo.
Mal: una dependencia o un fichero «por si hace falta», o ficheros ajenos al encargo.

### C13 — Si el cambio toca workflows, el veredicto, el estándar, `.claude/` o `CLAUDE.md`, ¿deja cada comprobación igual o más estricta (ninguna se quita, se salta ni se rebaja)?
Quién: revisor.
Bien: una pregunta nueva, o un test que antes no existía; ninguna comprobación desaparece.
Mal: quitar un check obligatorio, convertir un «no» en aviso o ampliar lo que el veredicto da por bueno sin que nada lo compense.

### C14 — Lo que el cambio repite (un umbral, un valor de pocos casos, una receta), ¿es una tabla o un enum que un lector usa, o una excepción apuntada, y cada campo nuevo está en `fields.json`?
Quién: revisor.
Bien: los valores permitidos son una lista exportada que el código y los tests importan, y el campo nuevo está en `fields.json`.
Mal: la misma cadena o el mismo número escritos a mano en dos ficheros, o un campo nuevo que `fields.json` no conoce, sin una excepción apuntada.

### C15 — Cada decisión que el encargo no impone, ¿está en «Decisions» del PR, y la alternativa descartada incumpliría el principio citado?
Quién: revisor.
Bien: `- principio 4 | eligió: una tabla | descartó: copiarla en el test | motivo: decidido`, y copiarla en el test rompería el principio 4.
Mal: una elección de diseño que no está apuntada, o una línea cuya alternativa descartada no incumple el principio que cita.

### C16 — Si el PR cambia un `plans/<slug>.md`, ¿el plan cumple cada pregunta de revisor de `.fabrica/standards/plan.md`?
Quién: revisor (la prueba nombra la P que falla; si el PR no cambia ningún plan, «no aplica»).
Bien: cada trozo del plan tiene una Done que falla antes y pasa después, un `Not done` concreto y, si toca la puerta, dice qué comprobación mantiene y cómo se repara main.
Mal: un trozo con `npm test` solo como Done, o una decisión del plan que no está en «Decisions taken».

### C17 — Cada check nuevo, ¿se dispara por su entrada real (lo recoge `npm test`, lo corre `tests.yml` o lo lee el revisor), y el PR muestra un caso malo que lo pone en rojo por esa entrada, no llamando a la función?
Quién: revisor (sin check nuevo, «no aplica»).
Bien: un test nuevo en `test/` y, en `Red before`, el comando `node --test test/x.test.js` con su salida roja y su código de salida.
Mal: un script `scripts/x.check.mjs` que ningún workflow ni `npm test` ejecuta, o un caso malo que solo llama a la función a mano.
