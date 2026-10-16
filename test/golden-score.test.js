// scripts/golden.mjs scores simulated reviewer outputs against the corpus: a perfect reviewer, one that always says sí,
// one with a missing file. No model is called; the outputs are written here.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKED_BY } from '../scripts/lib/questions.mjs';
import { CLEAN, CORPUS, STANDARD, answersOf, belowFloor, loadCorpus, run } from '../scripts/golden.mjs';
import { cargarPreguntas } from '../scripts/veredicto.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'golden.mjs');
const preguntas = cargarPreguntas(STANDARD);
const reviewerIds = preguntas.filter((q) => q.quien === CHECKED_BY.reviewer).map((q) => q.id);
const cases = loadCorpus(CORPUS, preguntas);
const temporales = [];
after(() => temporales.forEach((d) => rmSync(d, { recursive: true, force: true })));

// text of one simulated output: every reviewer question sí, except those in `noEn`.
const salida = (noEn = []) => JSON.stringify({ respuestas: reviewerIds.map((id) => ({ id, respuesta: noEn.includes(id) ? 'no' : 'sí', prueba: 'x' })) });
// A folder of outputs: porCaso(case, trial) -> text; trials 1..n.
function escribir(porCaso, trials = 1) {
  const dir = mkdtempSync(path.join(tmpdir(), 'golden-score-'));
  temporales.push(dir);
  for (const c of cases) {
    mkdirSync(path.join(dir, c.id));
    for (let t = 1; t <= trials; t += 1) writeFileSync(path.join(dir, c.id, `${t}.json`), porCaso(c, t));
  }
  return dir;
}
const perfecto = (c) => salida(c.expect === CLEAN ? [] : [c.expect]);
const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('corpus: 6 malos con su pregunta y 3 limpios, las seis preguntas distintas y todas del revisor', () => {
  assert.equal(cases.length, 9);
  assert.deepEqual(cases.filter((c) => c.expect !== CLEAN).map((c) => c.expect).sort(), ['C12', 'C13', 'C5', 'C6', 'C8', 'C9']);
  assert.equal(cases.filter((c) => c.expect === CLEAN).length, 3);
});

test('corpus: un revisor perfecto detecta las 6 y no da ningún no falso', () => {
  const { informe, faults } = run({ outputs: escribir(perfecto) });
  assert.deepEqual(faults, []);
  for (const id of ['C5', 'C6', 'C8', 'C9', 'C12', 'C13']) assert.equal(informe.deteccion[id].tasa, 1, id);
  assert.deepEqual(informe.falsosNo, { limpios: 3, falsos: 0, tasa: 0 });
});

test('corpus: por autor, 1 caso malo de opus es «no concluyente» y 5 de sonnet ya cuentan', () => {
  const { informe } = run({ outputs: escribir(perfecto) });
  assert.deepEqual(Object.keys(informe.porAutor).sort(), ['opus', 'sonnet']);
  assert.deepEqual(informe.porAutor.opus, { malos: 1, cazados: 1, tasa: 1, concluyente: false });
  assert.deepEqual(informe.porAutor.sonnet, { malos: 5, cazados: 5, tasa: 1, concluyente: true });
  assert.match(cli('--outputs', escribir(perfecto)).stdout, /detection by author opus: 1\/1 \(100%\), no concluyente/);
});

test('un revisor que siempre dice sí no detecta nada y el suelo lo para', () => {
  const outputs = escribir(() => salida());
  const { informe, faults } = run({ outputs });
  for (const id of ['C5', 'C6', 'C8', 'C9', 'C12', 'C13']) assert.equal(informe.deteccion[id].tasa, 0, id);
  assert.deepEqual(faults, []);
  const suelo = path.join(outputs, 'suelo.json');
  writeFileSync(suelo, JSON.stringify({ deteccion: { C5: 1, C13: 0.5 }, falsosNo: 0 }));
  const r = cli('--outputs', outputs, '--floor', suelo);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /under the floor: C5: detection 0 under the floor 1/);
  assert.match(r.stdout, /under the floor: C13/);
});

test('un revisor que dice no a todo detecta todo pero se pasa en falsos no', () => {
  const outputs = escribir(() => salida(reviewerIds));
  const { informe, faults } = run({ outputs });
  assert.equal(informe.deteccion.C5.tasa, 1);
  assert.equal(informe.falsosNo.tasa, 1);
  assert.deepEqual(faults, []);
  assert.deepEqual(belowFloor(informe, { deteccion: { C5: 1 }, falsosNo: 0.1 }), ['false no 1 over the floor 0.1']);
});

test('con un fichero que falta sale 1 y dice cuál; no se da por sí', () => {
  const outputs = escribir(perfecto);
  rmSync(path.join(outputs, 'caso-04', '1.json'));
  assert.throws(() => run({ outputs }), /missing outputs \(1\): caso-04\/1\.json/);
  const r = cli('--outputs', outputs);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /caso-04\/1\.json/);
});

test('una salida ilegible sale 1: no cuenta como respuesta vacía', () => {
  const outputs = escribir((c) => (c.id === 'caso-02' ? 'esto no es JSON' : perfecto(c)));
  assert.throws(() => run({ outputs }), /unreadable output: caso-02\/1\.json/);
  assert.equal(cli('--outputs', outputs).status, 1);
});

test('una salida que es JSON pero viene vacía o incompleta sale 1: sin respuesta no es «no hay no»', () => {
  const incompleta = JSON.stringify({ respuestas: [{ id: 'C5', respuesta: 'sí', prueba: 'x' }] });
  const sinPrueba = JSON.stringify({ respuestas: reviewerIds.map((id) => ({ id, respuesta: 'basura', prueba: 'x' })) });
  for (const texto of ['{}', '{"respuestas":[]}', incompleta, sinPrueba]) {
    const outputs = escribir((c) => (c.id === 'caso-07' ? texto : perfecto(c)));
    assert.throws(() => run({ outputs }), /incomplete output: caso-07\/1\.json/, texto);
    assert.equal(cli('--outputs', outputs).status, 1, texto);
  }
});

test('con 3 intentos manda la mayoría: 2 de 3 detectan, 1 de 3 no', () => {
  const dos = escribir((c, t) => (c.expect === 'C6' && t === 3 ? salida() : perfecto(c)), 3);
  assert.equal(run({ outputs: dos, trials: 3 }).informe.deteccion.C6.tasa, 1);
  const uno = escribir((c, t) => (c.expect === 'C6' && t > 1 ? salida() : perfecto(c)), 3);
  assert.equal(run({ outputs: uno, trials: 3 }).informe.deteccion.C6.tasa, 0);
  assert.throws(() => run({ outputs: dos, trials: 4 }), /missing outputs \(9\)/);
});

test('answersOf lee por decidir: un id repetido no vale como respuesta y uno ajeno no cambia nada', () => {
  const respuestas = (extra) => JSON.stringify({ respuestas: [...reviewerIds.map((id) => ({ id, respuesta: id === 'C6' ? 'no' : 'sí', prueba: 'x' })), ...extra] });
  const ajeno = { id: 'P1', respuesta: 'no', prueba: 'x' };
  assert.equal(answersOf(respuestas([ajeno]), preguntas, 'x').C6, 'no');
  assert.throws(() => answersOf(respuestas([{ id: 'C6', respuesta: 'sí', prueba: 'x' }]), preguntas, 'x'), /no usable answer for C6/);
});

test('un corpus roto falla en alto: carpeta sin expectativa, pregunta que no es del revisor, fichero vacío', () => {
  const raiz = mkdtempSync(path.join(tmpdir(), 'golden-corpus-'));
  temporales.push(raiz);
  const nuevo = (expected, vacio = false) => {
    const dir = mkdtempSync(path.join(raiz, 'c-'));
    mkdirSync(path.join(dir, 'a'));
    writeFileSync(path.join(dir, 'a', 'pr.diff'), vacio ? '' : 'diff');
    writeFileSync(path.join(dir, 'a', 'body.md'), 'body');
    writeFileSync(path.join(dir, 'expected.json'), JSON.stringify(expected));
    return dir;
  };
  assert.throws(() => loadCorpus(nuevo({ a: { author: 'opus', expect: 'C6' }, b: { author: 'opus', expect: 'C6' } }), preguntas), /differ/);
  assert.throws(() => loadCorpus(nuevo({ a: { author: 'opus', expect: 'C1' } }), preguntas), /not a reviewer question/);
  assert.throws(() => loadCorpus(nuevo({ a: { author: 'robot', expect: 'C6' } }), preguntas), /author outside/);
  assert.throws(() => loadCorpus(nuevo({ a: { author: 'opus', expect: 'C6' } }, true), preguntas), /missing or empty/);
  assert.equal(loadCorpus(nuevo({ a: { author: 'opus', expect: 'C6' } }), preguntas).length, 1);
});

test('los ficheros de caso no nombran el corpus ni llevan nada que parezca un secreto', () => {
  const nombra = /golden|dorado|expected|seeded/i;
  const secreto = [/[0-9a-f]{40}/i, /-----BEGIN [A-Z ]*PRIVATE KEY/, /\b(?:ghp_|github_pat_|ghs_|sk-ant-|ops_ey)[A-Za-z0-9_]{8,}/, /\b\d{1,3}(?:\.\d{1,3}){3}\b/, /\b[a-z]+:\/\/[^\s:@/]+:[^\s@/]+@/];
  for (const c of cases) {
    assert.deepEqual(readdirSync(path.join(CORPUS, c.id)).sort(), ['body.md', 'pr.diff'], c.id);
    assert.doesNotMatch(c.id, nombra);
    for (const f of ['pr.diff', 'body.md']) {
      const texto = readFileSync(path.join(CORPUS, c.id, f), 'utf8');
      assert.doesNotMatch(texto, nombra, `${c.id}/${f} nombra el corpus`);
      for (const re of secreto) assert.doesNotMatch(texto, re, `${c.id}/${f} parece llevar un secreto (${re})`);
    }
  }
});
