// The verdict logic (decidir, rutaEstandar, cargarPreguntas) without running the script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decidir, rutaEstandar, cargarPreguntas } from '../scripts/veredicto.mjs';
import { preguntas, buenas, ctx, juzga } from './support/factory.mjs';

test('veredicto: sí solo si todo lo del revisor es sí o no aplica con prueba', () => {
  assert.equal(juzga(buenas()).ok, true);
});

test('veredicto: un no, un hueco, una respuesta sin prueba o una salida rota son no', () => {
  const r = buenas();
  assert.equal(juzga([{ ...r[0], respuesta: 'no' }, ...r.slice(1)]).ok, false);
  assert.equal(juzga(r.slice(1)).ok, false);
  assert.equal(juzga([{ ...r[0], prueba: ' ' }, ...r.slice(1)]).ok, false);
  assert.equal(juzga([{ ...r[0], respuesta: 'tal vez' }, ...r.slice(1)]).ok, false);
  assert.equal(decidir('', preguntas, ctx()).ok, false);
  assert.equal(decidir('{no json', preguntas, ctx()).ok, false);
});

test('veredicto: ids duplicados son no, aunque uno diga sí', () => {
  const r = buenas();
  assert.equal(juzga([...r, { ...r[0], respuesta: 'no' }]).ok, false);
  assert.equal(juzga([...r, { ...r[0] }]).ok, false);
});

test('veredicto: un id desconocido es no, y el fallo dice cuántos sin escribir el id del modelo', () => {
  const v = juzga([...buenas(), { id: 'C999', respuesta: 'sí', prueba: 'x.js:1' }]);
  assert.equal(v.ok, false);
  assert.deepEqual(v.fallos, ['1 ids desconocidos']);
});

test('veredicto: si la cabeza del PR ya no es el SHA juzgado, es no', () => {
  assert.equal(juzga(buenas(), ctx({ cabeza: 'b'.repeat(40) })).ok, false);
  assert.equal(decidir(JSON.stringify({ respuestas: buenas() }), preguntas, {}).ok, false);
});

test('rutaEstandar: acepta standards/<nombre>.md con o sin .fabrica/ y rechaza el resto', () => {
  const raiz = path.resolve('/r');
  assert.equal(rutaEstandar('standards/code.md', raiz), path.join(raiz, 'standards', 'code.md'));
  assert.equal(rutaEstandar('.fabrica/standards/plans.md', raiz), path.join(raiz, 'standards', 'plans.md'));
  for (const mala of [undefined, '', '../x.md', 'standards/../x.md', 'standards/a/b.md', '/standards/code.md', 'standards/code.MD', 'standards/code.md\n', '.fabrica/.fabrica/standards/code.md', 'plans/x.md']) {
    assert.throws(() => rutaEstandar(mala, raiz), /STANDARD/, String(mala));
  }
});

test('cargarPreguntas: un estándar sin ninguna pregunta del revisor falla; el real carga', () => {
  const raiz = mkdtempSync(path.join(tmpdir(), 'est-'));
  mkdirSync(path.join(raiz, 'standards'));
  writeFileSync(path.join(raiz, 'standards', 'solo.md'), '### C1 — Pregunta de máquina\nQuién: máquina\n');
  assert.throws(() => cargarPreguntas('standards/solo.md', raiz), /revisor/);
  assert.ok(cargarPreguntas('standards/code.md').some((p) => p.quien === 'revisor'));
});

test('decidir: sin ninguna pregunta del revisor es no, aunque la salida sea perfecta (nunca sí por vacío)', () => {
  const soloMaquina = [{ id: 'C1', pregunta: 'x', quien: 'máquina' }];
  for (const lista of [[], soloMaquina]) {
    const v = decidir(JSON.stringify({ respuestas: [] }), lista, ctx());
    assert.equal(v.ok, false);
    assert.match(v.fallos.join(), /sin preguntas del revisor/);
  }
});

test('veredicto: sin una respuesta del revisor sigue siendo no', () => {
  assert.equal(juzga(buenas().slice(1)).ok, false);
});

test('veredicto: ningún texto del modelo se publica, solo ids de la lista de preguntas', () => {
  const clave = 'C1234567890-ghs_SECRETO';
  const clave2 = 'ghs_SECRETO_SUELTO';
  const r = buenas();
  const v = juzga([...r, { id: clave, respuesta: 'no', prueba: 'x' }, { id: clave2, respuesta: 'sí', prueba: 'x' }, { id: clave, respuesta: 'no', prueba: 'y' }, { id: { a: 1 }, respuesta: 'sí', prueba: 'x' }]);
  assert.equal(v.ok, false);
  const publicado = JSON.stringify(v);
  assert.doesNotMatch(publicado, /SECRETO/);
  assert.match(v.fallos.join(), /\d+ ids desconocidos/);
  for (const f of v.fallos) assert.match(f, /^(C\d+: [a-zá-ú ]+|\d+ ids desconocidos|la cabeza .*|no, requiere .*|salida ilegible)$/);
});
