// scripts/veredicto.mjs run end to end with the GitHub API faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractRecord } from '../scripts/lib/record.mjs';
import { decidir } from '../scripts/veredicto.mjs';
import { preguntas, buenas, SHA, ctx, esCheck } from './apoyo/fabrica.mjs';

// Recorre el script entero como lo corre el workflow (variables de entorno y llamadas a la API),
// con la API de GitHub simulada: un PR que toca .github/workflows/revisor.yml, sin ninguna review
// de Pablo y con todas las respuestas en «sí». VEREDICTO_RUTA permite apuntarlo a otra copia del script.
const BASE_SHA = 'b'.repeat(40);
const corre = (extra) => {
  const ruta = process.env.VEREDICTO_RUTA ?? fileURLToPath(new URL('../scripts/veredicto.mjs', import.meta.url));
  const precarga = pathToFileURL(fileURLToPath(new URL('./fixtures/github-falso.mjs', import.meta.url))).href;
  const r = spawnSync(process.execPath, ['--import', precarga, ruta], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, REPO: 'o/r', REVISOR_APP_SLUG: 'app-de-prueba', PR: '2', SHA, BASE: BASE_SHA, TOKEN: 'falso', LECTOR: 'falso', CHECK_RUN: '4242', SALIDA: JSON.stringify({ respuestas: buenas() }), ...extra },
  });
  const publicado = r.stderr.split('\n').filter((l) => l.startsWith('PUBLICADO ')).map((l) => JSON.parse(l.slice(10)));
  return { r, publicado };
};

test('veredicto de punta a punta: un PR que toca el workflow sin review de Pablo, con todo sí, da sí y publica la aprobación', () => {
  const { r, publicado } = corre({ STANDARD: 'standards/code.md' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(publicado.find((p) => esCheck(p))?.cuerpo.conclusion, 'success', r.stdout);
  assert.equal(publicado.find((p) => p.ruta.endsWith('/reviews'))?.cuerpo.event, 'APPROVE', 'falta la aprobación de la App');
  assert.match(r.stdout, /^veredicto: sí/);
});

const check = (publicado) => publicado.find((p) => esCheck(p)).cuerpo;
const sinRegistro = (c) => ({ title: c.output.title, summary: c.output.summary });

test('veredicto de punta a punta: el check lleva el registro, con las respuestas y sin la prueba del modelo; title y summary no cambian', () => {
  const PRUEBA = 'PRUEBA_RECONOCIBLE_DEL_MODELO';
  const respuestas = buenas().map((r, i) => (i === 0 ? { ...r, prueba: PRUEBA } : r));
  const { r, publicado } = corre({ STANDARD: 'standards/code.md', SALIDA: JSON.stringify({ respuestas }), GITHUB_RUN_ID: '555', GITHUB_RUN_ATTEMPT: '2' });
  assert.equal(r.status, 0, r.stderr);
  const c = check(publicado);
  const reg = extractRecord(c.output.text);
  assert.deepEqual(reg.answers, Object.fromEntries(buenas().map((b) => [b.id, 'sí'])));
  assert.deepEqual({ ok: reg.ok, pr: reg.pr, sha: reg.sha, standard: reg.standard, error: reg.error, invalid: reg.invalid, run: reg.run }, { ok: true, pr: 2, sha: SHA, standard: 'standards/code.md', error: null, invalid: 0, run: { id: 555, attempt: 2 } });
  assert.ok(!c.output.text.includes(PRUEBA), 'la prueba del modelo no debe estar en el registro');
  assert.deepEqual(sinRegistro(c), { title: 'Veredicto: sí', summary: 'Todas las respuestas del revisor son sí o no aplica, con prueba.' });
});

test('veredicto de punta a punta: un no deja title y summary de siempre y el registro dice qué pregunta fue no; sin variables de run, run es null', () => {
  const rs = buenas();
  const { r, publicado } = corre({ STANDARD: 'standards/code.md', SALIDA: JSON.stringify({ respuestas: [{ ...rs[0], respuesta: 'no' }, ...rs.slice(1), { id: 'C999', respuesta: 'sí', prueba: 'x' }] }) });
  assert.equal(r.status, 0, r.stderr);
  const c = check(publicado);
  assert.deepEqual(sinRegistro(c), { title: 'Veredicto: no', summary: `- 1 ids desconocidos
- ${rs[0].id}: no` });
  const reg = extractRecord(c.output.text);
  assert.equal(reg.answers[rs[0].id], 'no');
  assert.equal(reg.invalid, 1);
  assert.equal(reg.run, null);
});

test('veredicto de punta a punta: answers del registro es lo mismo que respuestas de decidir (hueco, id repetido, id desconocido)', () => {
  const rs = buenas();
  const lista = [{ ...rs[1], respuesta: 'no' }, rs[2], { ...rs[2], respuesta: 'no' }, ...rs.slice(3, -1), { id: 'C999', respuesta: 'sí', prueba: 'x' }];
  const salida = JSON.stringify({ respuestas: lista });
  const v = decidir(salida, preguntas, ctx());
  const esperado = Object.fromEntries(rs.map((r) => [r.id, null]));
  Object.assign(esperado, { [rs[1].id]: 'no' }, Object.fromEntries(rs.slice(3, -1).map((r) => [r.id, 'sí'])));
  assert.deepEqual(v.respuestas, { answers: esperado, invalid: 2 });
  const { publicado } = corre({ STANDARD: 'standards/code.md', SALIDA: salida });
  assert.deepEqual(extractRecord(check(publicado).output.text).answers, v.respuestas.answers);
});

// The judge knows one prefix (PREFIJO_DEL_JUEZ). A standard whose questions have another prefix must give the same verdict
// as on main: its answers are unknown ids and the verdict is no. The script runs from a temporary copy of scripts/ so STANDARD resolves there.
test('veredicto de punta a punta: un estándar de prefijo P da «ids desconocidos» y no, como en main (el juez solo conoce un prefijo)', () => {
  const raiz = mkdtempSync(path.join(tmpdir(), 'juez-p-'));
  mkdirSync(path.join(raiz, 'scripts', 'lib'), { recursive: true });
  mkdirSync(path.join(raiz, 'standards'));
  for (const f of ['veredicto.mjs', 'lib/questions.mjs', 'lib/record.mjs', 'lib/repo.mjs', 'lib/golden-guard.mjs']) writeFileSync(path.join(raiz, 'scripts', f), readFileSync(new URL(`../scripts/${f}`, import.meta.url)));
  writeFileSync(path.join(raiz, 'standards', 'p.md'), '### P1 — First question\nQuién: revisor\n\n### P2 — Second question\nQuién: revisor\n');
  const precarga = pathToFileURL(fileURLToPath(new URL('./fixtures/github-falso.mjs', import.meta.url))).href;
  const salida = JSON.stringify({ respuestas: [{ id: 'P1', respuesta: 'sí', prueba: 'x' }, { id: 'P2', respuesta: 'sí', prueba: 'x' }] });
  const r = spawnSync(process.execPath, ['--import', precarga, path.join(raiz, 'scripts', 'veredicto.mjs')], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, REPO: 'o/r', REVISOR_APP_SLUG: 'app-de-prueba', PR: '2', SHA, BASE: BASE_SHA, TOKEN: 'falso', LECTOR: 'falso', CHECK_RUN: '4242', SALIDA: salida, STANDARD: 'standards/p.md' },
  });
  const c = r.stderr.split('\n').filter((l) => l.startsWith('PUBLICADO ')).map((l) => JSON.parse(l.slice(10))).find((p) => esCheck(p)).cuerpo;
  assert.equal(c.conclusion, 'failure', r.stderr);
  assert.deepEqual(sinRegistro(c), { title: 'Veredicto: no', summary: '- 2 ids desconocidos\n- P1: sin respuesta\n- P2: sin respuesta' });
});

test('veredicto de punta a punta: salida ilegible y estándar que no carga también dejan registro, con error', () => {
  const ilegible = check(corre({ STANDARD: 'standards/code.md', SALIDA: '{no json' }).publicado);
  assert.deepEqual(sinRegistro(ilegible), { title: 'Veredicto: no', summary: '- salida ilegible' });
  const reg = extractRecord(ilegible.output.text);
  assert.equal(reg.error, 'output-unreadable');
  assert.equal(reg.ok, false);
  const malo = corre({ STANDARD: 'standards/no-existe.md' });
  assert.equal(malo.r.status, 1);
  const reg2 = extractRecord(check(malo.publicado).output.text);
  assert.equal(reg2.error, 'standard-unloadable');
  assert.equal(reg2.standard, 'standards/no-existe.md');
});

test('veredicto de punta a punta: si el registro no se puede construir, el veredicto sale igual, sin registro, y el script falla en alto', () => {
  const { r, publicado } = corre({ STANDARD: 'standards/code.md', GITHUB_RUN_ID: '555' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /GITHUB_RUN_ID/);
  const c = check(publicado);
  assert.equal(c.conclusion, 'success');
  assert.equal(c.output.text, undefined);
  assert.equal(publicado.find((p) => p.ruta.endsWith('/reviews'))?.cuerpo.event, 'APPROVE');
});

test('veredicto de punta a punta: STANDARD con el prefijo .fabrica/ (como en el workflow) da lo mismo que sin él', () => {
  const { r } = corre({ STANDARD: '.fabrica/standards/code.md' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^veredicto: sí/);
});

// Sin STANDARD, o con uno inválido, el script falla en alto: sale con 1, publica un no (nunca un sí) y no aprueba.
for (const [nombre, extra] of [['falta', {}], ['vacío', { STANDARD: '' }], ['con ../', { STANDARD: '../x.md' }], ['con subcarpeta', { STANDARD: 'standards/a/b.md' }], ['inexistente', { STANDARD: 'standards/no-existe.md' }]]) {
  test(`veredicto de punta a punta: STANDARD ${nombre} falla en alto y publica un no`, () => {
    const { r, publicado } = corre(extra);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /STANDARD/);
    assert.equal(publicado.find((p) => esCheck(p))?.cuerpo.conclusion, 'failure');
    assert.equal(publicado.find((p) => p.ruta.endsWith('/reviews')), undefined, 'no debe aprobar');
  });
}

// El freno del corpus dorado de punta a punta: la API simulada devuelve el compare y los ficheros del corpus en la base y en la cabeza.
const DIR = 'test/fixtures/golden/review';
const corpus = (baseJson, headJson) => ({
  COMPARE_FALSO: JSON.stringify([{ filename: `${DIR}/expected.json`, status: 'modified' }]),
  CONTENIDOS_FALSOS: JSON.stringify({ [`${BASE_SHA}:${DIR}/expected.json`]: baseJson, [`${SHA}:${DIR}/expected.json`]: headJson }),
});
const BASE_CORPUS = { 'caso-01': { author: 'opus', expect: 'C5' }, 'caso-02': { author: 'sonnet', expect: 'clean' } };
const fk = (publicado) => publicado.find((p) => esCheck(p)).cuerpo;

test('freno dorado de punta a punta: un PR que rebaja un caso da no con motivo cerrado, aunque todas las respuestas sean sí', () => {
  const rebajado = { ...BASE_CORPUS, 'caso-01': { author: 'opus', expect: 'clean' } };
  const { r, publicado } = corre({ STANDARD: 'standards/code.md', ...corpus(JSON.stringify(BASE_CORPUS), JSON.stringify(rebajado)) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fk(publicado).conclusion, 'failure');
  assert.equal(fk(publicado).output.summary, '- corpus dorado: expect rebajado de no a clean (caso-01)');
  assert.equal(publicado.find((p) => p.ruta.endsWith('/reviews')), undefined, 'un no no lleva aprobación');
});

test('freno dorado de punta a punta: un caso nuevo y un expect nuevo no frenan (sí y aprobación)', () => {
  const nuevo = { ...BASE_CORPUS, 'caso-03': { author: 'sonnet', expect: 'clean' }, 'caso-04': { author: 'sonnet', expect: 'C9' } };
  const { r, publicado } = corre({ STANDARD: 'standards/code.md', ...corpus(JSON.stringify(BASE_CORPUS), JSON.stringify(nuevo)) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fk(publicado).conclusion, 'success');
  assert.equal(publicado.find((p) => p.ruta.endsWith('/reviews'))?.cuerpo.event, 'APPROVE');
});

test('freno dorado de punta a punta: un corpus que no se puede leer en la cabeza es no, no un pase', () => {
  const { r, publicado } = corre({ STANDARD: 'standards/code.md', ...corpus(JSON.stringify(BASE_CORPUS), '{ no es json') });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fk(publicado).conclusion, 'failure');
  assert.equal(fk(publicado).output.summary, '- corpus dorado: no se pudo comprobar');
});

test('freno dorado de punta a punta: sin la variable BASE el juez falla en alto', () => {
  const { r } = corre({ STANDARD: 'standards/code.md', BASE: '' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /falta la variable BASE/);
});
