// What the Fábrica demands of itself (principle 5): CLAUDE.md, the three roles and the standard's questions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrinciples } from '../scripts/lib/decision.mjs';
import { readQuestions } from '../scripts/lib/questions.mjs';
import { leer, preguntas } from './apoyo/fabrica.mjs';

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

test('el principio 6 conserva las obligaciones del viejo: no adivinar, no interrumpir, parar y apuntar sin evidencia (C13)', () => {
  const linea = leer('CLAUDE.md').split('\n').find((l) => l.startsWith('6. '));
  assert.ok(linea, 'falta la línea del principio 6');
  for (const frase of ['no se adivina', 'ni se interrumpe', 'se para y se deja escrito', 'standards/intervention.md']) {
    assert.ok(linea.includes(frase), `el principio 6 perdió: ${frase}`);
  }
  const arquitecto = leer('.claude/agents/arquitecto.md');
  for (const frase of ['no preguntes ni adivines', 'marca el trozo como bloqueado', 'standards/intervention.md']) {
    assert.ok(arquitecto.includes(frase), `el arquitecto perdió: ${frase}`);
  }
});

test('los tres roles tienen su modelo y el revisor no escribe', () => {
  const modelos = { arquitecto: 'opus', constructor: 'sonnet', revisor: 'opus' };
  for (const [rol, modelo] of Object.entries(modelos)) {
    const cabecera = leer(`.claude/agents/${rol}.md`).split('---')[1];
    assert.match(cabecera, new RegExp(`^name: ${rol}$`, 'm'));
    assert.match(cabecera, new RegExp(`^model: ${modelo}$`, 'm'));
    if (rol !== 'constructor') assert.doesNotMatch(cabecera, /Edit|Write/);
  }
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
