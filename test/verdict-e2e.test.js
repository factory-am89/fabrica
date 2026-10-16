// End to end of the verdict: the real standard -> the real questions -> the real decision function,
// fed with fixed reviewer outputs. Nothing of the logic is reimplemented here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decidir, leerPreguntas } from '../scripts/veredicto.mjs';

const md = readFileSync(new URL('../estandares/codigo.md', import.meta.url), 'utf8');
const preguntas = leerPreguntas(md);
const delRevisor = preguntas.filter((q) => q.quien === 'revisor');
const ctx = { sha: 'abc', cabeza: 'abc' };

const salida = (respuestas) => JSON.stringify({ respuestas });
const todas = (respuesta) => delRevisor.map((q) => ({ id: q.id, respuesta, prueba: 'x:1' }));
const decide = (s) => decidir(s, preguntas, ctx);

test('the real standard has reviewer questions', () => {
  assert.ok(delRevisor.length > 0);
});

test('all yes -> success', () => {
  const v = decide(salida(todas('sí')));
  assert.deepEqual(v, { ok: true, fallos: [] });
});

test('all "no aplica" with proof -> success', () => {
  assert.equal(decide(salida(todas('no aplica'))).ok, true);
});

test('all no -> failure, one failure per question', () => {
  const v = decide(salida(todas('no')));
  assert.equal(v.ok, false);
  assert.equal(v.fallos.length, delRevisor.length);
});

test('a missing answer -> failure naming that question', () => {
  const v = decide(salida(todas('sí').slice(1)));
  assert.equal(v.ok, false);
  assert.ok(v.fallos.includes(`${delRevisor[0].id}: sin respuesta`), v.fallos.join('|'));
});

test('unreadable output -> failure', () => {
  for (const s of ['', 'no es json', '{"respuestas":']) {
    const v = decide(s);
    assert.equal(v.ok, false, `output ${JSON.stringify(s)} passed`);
    assert.ok(v.fallos.includes('salida ilegible'));
  }
});

test('a repeated id -> failure', () => {
  const v = decide(salida([...todas('sí'), { id: delRevisor[0].id, respuesta: 'sí', prueba: 'x:1' }]));
  assert.equal(v.ok, false);
  assert.ok(v.fallos.includes(`${delRevisor[0].id}: id repetido`), v.fallos.join('|'));
});

test('an unknown id -> failure', () => {
  const v = decide(salida([...todas('sí'), { id: 'C999', respuesta: 'sí', prueba: 'x:1' }]));
  assert.equal(v.ok, false);
  assert.ok(v.fallos.includes('1 ids desconocidos'), v.fallos.join('|'));
});

test('all yes but the PR head moved from the judged SHA -> failure', () => {
  const v = decidir(salida(todas('sí')), preguntas, { sha: 'abc', cabeza: 'def' });
  assert.equal(v.ok, false);
});
