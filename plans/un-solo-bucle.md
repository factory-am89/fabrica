# Plan: una sola sesión planifica y construye; se parte por tamaño, no por rol

Verdict: el arquitecto se fusiona en el constructor y el revisor sigue aparte. La regla de tamaño es contar trozos: si el plan sale con un trozo, la misma sesión lo construye; si sale con varios, publica el plan en `plans/` y cada trozo lo hace una sesión nueva. Lo desagradable primero: no se mide si la fusión mejora o empeora la calidad. Lo decidió Pablo el 2026-10-29 en la sesión de Claude Code que escribe este plan (cita literal, sin enlace público: «No, pero no te pongas tú a comprobar si arquitecto sí o fusionado: hemos dicho que sí, no?»; su fila de `intervenciones.md` va en el PR del trozo 2, porque un PR de plan no puede tocar nada fuera de `plans/`, `PR_OUTSIDE_PLANS` de `scripts/lib/plan.mjs`), siguiendo el artículo de Anthropic «Building agents: when to fold subagents into your main agent loop»: cada traspaso pierde lo que vio quien pasa el trabajo.

## Lo que hay hoy (comprobado)

Código leído de `origin/main` con `git show origin/main:<ruta>`, el 2026-10-29: primero en d7d2ef5 y las búsquedas repetidas en 017b0f2, con la misma salida.

- Tres roles en `.claude/agents/`: `arquitecto.md` (opus, sin Edit ni Write, deja el plan), `constructor.md` (sonnet, construye un trozo y abre el PR) y `revisor.md` (opus, juzga con contexto limpio).
- «Trozo» ya está definido y lo comprueba una máquina: la forma, en `PLAN_FIELDS` y `PLAN_FAULTS` de `scripts/lib/plan.mjs` (`node scripts/check-plan.mjs --file <plan>`); que quepa en un PR, P4 de `standards/plan.md` («Is each chunk one idea that fits in one PR review?», revisor). Un PR demasiado grande ya recibe un «no» por C11 de `standards/code.md` («¿El PR es una sola idea y cabe en una sentada de revisión?»). Este plan no redefine el trozo: lo usa como unidad para decidir si se parte.
- Quién nombra al arquitecto (`git grep -n -i "arquitecto\|architect" origin/main -- ':!plans' ':!intervenciones.md'`): `constructor.md:3`; `scripts/lib/plan.mjs:1` (comentario); `standards/plan.md:3,23,84`; `test/plan-standard.test.js:47`; `test/principles-and-roles.test.js:60,67`; `test/questions.test.js:97`; y la fixture `test/fixtures/golden/review/caso-08/`, que es un PR histórico y no se toca.
- `.claude/agents/` no está en la lista cerrada de `standards/intervention.md` («the rest of `.claude/` (skills and roles), which agents edit every day»): este cambio no necesita decisión de Pablo antes de construirse.

## Chunks

### 1. El plan en `plans/`
Files: `plans/un-solo-bucle.md`
Depends on: none
Blocked by: none
Existing: `git ls-tree --name-only origin/main plans/` (en 017b0f2) -> `app-admin.md cockpit.md menuplan-separation.md puente-2-alvaro.md puente-homenu.md registro-de-no.md revisor-huerfano.md revisor-pendiente.md trabajar-solos.md`; ninguno trata los roles.
Not done: no toca ningún rol; solo deja el plan.
Done:
```sh
node scripts/check-plan.mjs --file plans/un-solo-bucle.md
```

### 2. El constructor planifica y decide por tamaño; el arquitecto desaparece
Files: `.claude/agents/constructor.md`, `.claude/agents/arquitecto.md`, `standards/plan.md`, `test/plan-standard.test.js`, `test/principles-and-roles.test.js`, `test/questions.test.js`, `intervenciones.md`
Depends on: 1
Blocked by: none
Existing: `git grep -n -E "más de un trozo|varios trozos|tamaño" origin/main -- .claude/agents` (en 017b0f2) -> sin salida, exit 1: ningún rol tiene hoy una regla de tamaño. «un trozo» solo aparece en `constructor.md:3` («Construye un trozo del plan»), que describe qué construye, no cuándo partir.
Not done: no toca el revisor, ni `scripts/lib/plan.mjs` (fichero de puerta; su comentario «architect plans» de la línea 1 se queda, es solo un comentario), ni la fixture `caso-08`. No cambia la forma del plan. Qué hace: (a) `constructor.md` gana un paso 0: lee el código y escribe el plan según `standards/plan.md`, comprobado con `scripts/check-plan.mjs`; con un trozo, lo construye en esta sesión y el plan va en el cuerpo del PR; con más de uno, abre solo el PR del plan en `plans/` y para, y cada trozo lo construye una sesión nueva que relee el código; si a mitad de trabajo la conversación se resume por llena, para, parte lo que queda en trozos y lo apunta. Hereda literal las obligaciones del arquitecto que hoy vigila `test/principles-and-roles.test.js:60` («no preguntes ni adivines», «marca el trozo como bloqueado», `standards/intervention.md`). (b) `constructor.md` pasa a `model: opus` (planificar lo hacía opus). (c) se borra `arquitecto.md`. (d) `test/plan-standard.test.js:47`, `test/questions.test.js:97` y las frases de `test/principles-and-roles.test.js:60` leen `constructor.md` con las mismas aserciones; uno nuevo comprueba que `constructor.md` lleva la regla de tamaño. La tabla de modelos de `test/principles-and-roles.test.js:67` sí cambia de valor: pierde `arquitecto: 'opus'` (el rol deja de existir) y `constructor` pasa de `sonnet` a `opus`; el test sigue comprobando el modelo de cada rol que existe y que el revisor no escribe. (e) añade a `intervenciones.md` la fila de la decisión de Pablo del 2026-10-29, con la cita del veredicto de este plan. (f) `standards/plan.md`: «architect plan» pasa a «plan» y «the architect decides» a «the constructor decides»; la fila P2 («the former `arquitecto.md` list») es historia y se queda. Lector de la regla: `test/principles-and-roles.test.js` (disparador `ci-test`) para que la regla esté escrita, y C11 del revisor para que un PR no se salte el reparto; ninguna máquina puede contar los trozos de un plan que no se escribió, y eso se apunta como deuda. Puerta: toca `standards/plan.md`, que está en `GATE_FILES` (`PLAN_GATE_FILES`, `scripts/lib/gate.mjs:53-55`); solo cambian dos palabras que nombran al rol, ninguna pregunta ni su `Quién`. Mantiene C13: ninguna pregunta del estándar cambia. En los tests, la única aserción que desaparece es el modelo del arquitecto, porque el rol ya no existe; las que vigilaban sus obligaciones pasan al constructor, que es quien las cumple ahora. Si rompe `main`: revertir el PR desde una rama nueva.
Done:
```sh
node --test test/principles-and-roles.test.js test/plan-standard.test.js test/questions.test.js
# caso malo en rojo: con el constructor.md de main el test nuevo de la regla de tamaño falla, y con arquitecto.md borrado y sin mover las aserciones fallan los tres
```

## Build order
Ola 1: 1. Ola 2: 2.

## Decisions taken
- excepción a principio 2 | motivo: Pablo decidió la fusión sin medirla el 2026-10-29, con el argumento del artículo de Anthropic y sin un banco de pruebas propio | coste: si la fusión empeora la calidad, nadie lo verá salvo que los «no» del revisor suban a ojos de alguien
- principio 4 | eligió: el plan de un trozo va en el cuerpo del PR | descartó: un fichero en plans/ también para un solo trozo, que repite lo que ya dice el cuerpo y añade un PR más | motivo: decidido
- excepción a principio 5 | motivo: ninguna máquina puede contar los trozos de un plan que el constructor no llegó a escribir, así que la regla de tamaño la vigilan un test que comprueba que está escrita en constructor.md y C11 del revisor sobre el tamaño del PR | coste: un constructor que se salta el reparto solo se para cuando el revisor juzga el PR grande, no antes
- principio 2 | eligió: constructor en opus, el modelo que planificaba hasta hoy | descartó: dejarlo en sonnet, que cambiaría sin prueba el modelo que hace los planes | motivo: decidido

## Dudas
- El coste: construir con opus gasta más cuota que con sonnet. Sin medir.

## Not verified
- Que fusionar mejore la calidad en la Fábrica: el artículo da cifras de sus clientes (unas 2 veces más rápido), no de un repo como este.
- Que una sesión de Claude Code note a tiempo que su conversación se llena: el resumen automático avisa, pero no está probado que la sesión pare y parta el trabajo.
