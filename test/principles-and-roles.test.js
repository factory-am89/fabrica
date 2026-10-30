// What the Fábrica demands of itself (principle 5): CLAUDE.md, the two roles and the standard's questions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrinciples } from '../scripts/lib/decision.mjs';
import { readQuestions } from '../scripts/lib/questions.mjs';
import { KEY, LIST } from '../scripts/lib/goals.mjs';
import { REVIEWER_NO_FILE } from '../scripts/lib/reviewer-no.mjs';
import { leer, preguntas } from './apoyo/fabrica.mjs';
import { real } from './apoyo/goals-casos.mjs';

test('CLAUDE.md es corto y tiene los 6 principios por su palabra clave', () => {
  const texto = leer('CLAUDE.md');
  const lineas = texto.split('\n').filter((l) => l.trim());
  assert.ok(lineas.length <= 20, `tiene ${lineas.length} líneas con texto`);
  const claves = ['Verdad', 'Evidencia', 'Fallar en alto', 'Una idea, un sitio', 'Lo que comprueba una máquina', 'Preguntar antes de un atajo'];
  claves.forEach((clave, i) => {
    assert.match(texto, new RegExp(`^${i + 1}\\. ${clave}`, 'm'), `falta el principio ${i + 1}: ${clave}`);
  });
  // Lo que lee la puerta (el lector de decisiones) ve exactamente esos principios.
  assert.deepEqual(parsePrinciples(texto), claves.map((_, i) => i + 1));
});

// Palabras que cada principio debe decir (B1): los invariantes como valor por defecto con excepción apuntada, I2 en el 4, el disparador en el 5,
// el residuo en el 6. El 1 y el 3 no cambian de sentido. `faltan` devuelve lo que falta; los tests de abajo la prueban en positivo y en negativo.
const PALABRAS = { 2: ['hipótesis', 'cifra de antes y de después'], 4: ['lista cerrada', '«otro»', 'motivo'], 5: ['check que falla', 'disparador'], 6: ['residuo de intención y autoridad', 'en la medida que él fije'] };
const CABECERA = ['valor por defecto', 'excepción', 'motivo', 'coste'];
const principio = (texto, n) => texto.split('\n').find((l) => l.startsWith(`${n}. `)) ?? '';
const cabecera = (texto) => texto.split('\n').find((l) => l.startsWith('Principios (')) ?? '';
const faltan = (texto) => [
  ...CABECERA.filter((p) => !cabecera(texto).includes(p)).map((p) => `cabecera: ${p}`),
  ...Object.entries(PALABRAS).flatMap(([n, ps]) => ps.filter((p) => !principio(texto, n).includes(p)).map((p) => `principio ${n}: ${p}`)),
];

test('los principios dicen los invariantes: valor por defecto con excepción apuntada, I2 en el 4, el disparador en el 5, el residuo en el 6', () => {
  assert.deepEqual(faltan(leer('CLAUDE.md')), []);
});

test('quitar cualquier palabra clave nueva de su principio la hace faltar (y solo a ella)', () => {
  const texto = leer('CLAUDE.md');
  const todas = [...CABECERA.map((p) => [cabecera(texto), p, `cabecera: ${p}`]), ...Object.entries(PALABRAS).flatMap(([n, ps]) => ps.map((p) => [principio(texto, n), p, `principio ${n}: ${p}`]))];
  for (const [linea, palabra, etiqueta] of todas) {
    assert.ok(linea.includes(palabra), `el principio ya no dice ${palabra}`);
    assert.deepEqual(faltan(texto.replace(linea, linea.replace(palabra, 'XXX'))), [etiqueta]);
  }
  assert.deepEqual(faltan(texto.replace(principio(texto, 4), '')), PALABRAS[4].map((p) => `principio 4: ${p}`));
});

test('goals.json dice que el principio 4 sirve a I2 y el 5 a I3 (los invariantes que B1 mete en esos principios)', () => {
  const porId = new Map(real()[LIST.invariants].map((i) => [i[KEY.id], i[KEY.principles]]));
  assert.ok(porId.get('I2').includes(4), 'I2 sin el principio 4');
  assert.ok(porId.get('I3').includes(5), 'I3 sin el principio 5');
});

test('el principio 6 conserva las obligaciones del viejo: no adivinar, no interrumpir, parar y apuntar sin evidencia (C13)', () => {
  const linea = leer('CLAUDE.md').split('\n').find((l) => l.startsWith('6. '));
  assert.ok(linea, 'falta la línea del principio 6');
  for (const frase of ['no se adivina', 'ni se interrumpe', 'se para y se deja escrito', 'standards/intervention.md']) {
    assert.ok(linea.includes(frase), `el principio 6 perdió: ${frase}`);
  }
  const constructor = leer('.claude/agents/constructor.md');
  for (const frase of ['no preguntes ni adivines', 'marca el trozo como bloqueado', 'standards/intervention.md']) {
    assert.ok(constructor.includes(frase), `el constructor perdió: ${frase}`);
  }
});

test('los dos roles tienen su modelo y el revisor no escribe', () => {
  const modelos = { constructor: 'opus', revisor: 'opus' };
  for (const [rol, modelo] of Object.entries(modelos)) {
    const cabecera = leer(`.claude/agents/${rol}.md`).split('---')[1];
    assert.match(cabecera, new RegExp(`^name: ${rol}$`, 'm'));
    assert.match(cabecera, new RegExp(`^model: ${modelo}$`, 'm'));
    if (rol !== 'constructor') assert.doesNotMatch(cabecera, /Edit|Write/);
  }
});

test('el constructor empieza en esfuerzo medio y sube a alto solo tras un no del revisor', () => {
  const texto = leer('.claude/agents/constructor.md');
  assert.match(texto.split('---')[1], /^effort: medium$/m);
  const paso7 = texto.split('\n').find((linea) => linea.startsWith('7. Si el revisor dice no'));
  assert.ok(paso7, 'constructor.md perdió el paso 7 (el arreglo tras un no del revisor)');
  assert.ok(paso7.includes('effort: high'), 'el paso 7 no sube a effort: high el arreglo tras un no');
});

test('el constructor planifica primero y parte por tamaño: un trozo lo construye él, más de uno abre el plan y para', () => {
  const texto = leer('.claude/agents/constructor.md');
  for (const frase of ['standards/plan.md', 'scripts/check-plan.mjs', 'Con un trozo', 'Con más de un trozo', 'plans/', 'una sesión nueva', 'se resume']) {
    assert.ok(texto.includes(frase), `constructor.md no dice ${frase}`);
  }
});

test('el constructor apunta una fila por cada «no» en el registro y deja el desenlace a otra sesión', () => {
  const texto = leer('.claude/agents/constructor.md');
  assert.ok(texto.includes(REVIEWER_NO_FILE), `constructor.md no nombra ${REVIEWER_NO_FILE}`);
  for (const nombre of ['REVIEWER_NO_FIELDS', 'KINDS', 'OUTCOME_PENDING']) {
    assert.ok(texto.includes(nombre), `constructor.md no nombra ${nombre}`);
  }
  assert.match(texto, /otra sesión/, 'no dice que el desenlace lo pone otra sesión');
});

test('el constructor sabe trabajar en un repo que la Fábrica opera: --repo, FABRICA_REPO, evidence y el enlace a subir.md', () => {
  const texto = leer('.claude/agents/constructor.md');
  for (const palabra of ['--repo', 'FABRICA_REPO', 'CLAUDE.md', '.claude/rules/', 'npm run evidence', 'referencias/subir.md', 'prejuicio']) {
    assert.ok(texto.includes(palabra), `constructor.md no dice ${palabra}`);
  }
  assert.match(texto, /Repo ajeno/, 'falta la sección de repo ajeno');
});

test('el estándar tiene al menos 10 preguntas, C1..Cn seguidas, cada una con bien y mal', () => {
  assert.ok(preguntas.length >= 10, `hay ${preguntas.length}`);
  assert.deepEqual(preguntas.map((p) => p.id), preguntas.map((_, i) => `C${i + 1}`));
  for (const q of readQuestions(leer('standards/code.md'))) {
    assert.ok(q.good, `${q.id} sin Bien`);
    assert.ok(q.bad, `${q.id} sin Mal`);
  }
});

test('leerPreguntas da {id, pregunta, quien} y respeta quién comprueba cada una (C1 máquina, C5 revisor)', () => {
  assert.deepEqual(Object.keys(preguntas[0]), ['id', 'pregunta', 'quien']);
  assert.equal(preguntas.find((p) => p.id === 'C1').quien, 'máquina');
  assert.equal(preguntas.find((p) => p.id === 'C5').quien, 'revisor');
});
