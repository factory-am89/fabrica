// The per-PR verdict record: built by scripts/veredicto.mjs, read by scripts/records.mjs. Literal fixtures, no clock, no network, no git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { RUTA_ESTANDAR } from '../scripts/veredicto.mjs';
import { CHECKED_BY, FIELDS, ID_PARTS, ID_SOURCE, readQuestions } from '../scripts/lib/questions.mjs';
import { ANSWERS, ERRORS, answersSummary, RECORD_VERSION, STANDARD_SOURCE, aggregate, buildRecord, extractRecord, formatBlock, parseRecord, readCheckRuns, runFromEnv } from '../scripts/lib/record.mjs';

const SHA = 'a'.repeat(40);
const base = { repo: 'o/r', pr: 2, sha: SHA, standard: 'standards/code.md', veredicto: { ok: false, fallos: ['C5: no'] }, respuestas: { answers: { C1: 'sí', C5: 'no', C6: 'no aplica', C7: null }, invalid: 0 }, run: { id: 99, attempt: 1 } };
const expected = { v: 1, repo: 'o/r', pr: 2, sha: SHA, standard: 'standards/code.md', ok: false, answers: { C1: 'sí', C5: 'no', C6: 'no aplica', C7: null }, invalid: 0, error: null, run: { id: 99, attempt: 1 } };

test('buildRecord and parseRecord: round trip, and the version is the one constant', () => {
  assert.equal(RECORD_VERSION, 1);
  const r = buildRecord(base);
  assert.deepEqual(r, expected);
  assert.deepEqual(parseRecord(JSON.stringify(r)), expected);
  assert.deepEqual(extractRecord(`x\n${formatBlock(r)}\n`), expected);
});

test('buildRecord: never carries model text (no proof, no message) and a null run stays null', () => {
  const r = buildRecord({ ...base, run: null, veredicto: { ok: false, fallos: ['TEXTO_DEL_MODELO'] }, respuestas: { answers: { C1: 'sí' }, invalid: 1, prueba: 'TEXTO_DEL_MODELO' } });
  assert.doesNotMatch(JSON.stringify(r), /TEXTO_DEL_MODELO/);
  assert.equal(r.run, null);
  assert.equal(r.invalid, 1);
});

test('buildRecord: error values are recorded, an unknown one throws', () => {
  assert.equal(buildRecord({ ...base, error: 'output-unreadable' }).error, 'output-unreadable');
  assert.throws(() => buildRecord({ ...base, error: 'otra' }));
  assert.throws(() => buildRecord({ ...base, sha: 'zz' }));
  assert.throws(() => buildRecord({ ...base, pr: 'x' }));
});

test('runFromEnv: from GITHUB_RUN_ID/ATTEMPT, explicit null without them, throws on half or junk', () => {
  assert.deepEqual(runFromEnv({ GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2' }), { id: 123, attempt: 2 });
  assert.equal(runFromEnv({}), null);
  assert.throws(() => runFromEnv({ GITHUB_RUN_ID: '123' }));
  assert.throws(() => runFromEnv({ GITHUB_RUN_ID: 'x', GITHUB_RUN_ATTEMPT: '1' }));
});

const mutar = (cambios) => JSON.stringify({ ...expected, ...cambios });
const rotos = {
  'version 2': mutar({ v: 2 }),
  'extra field': mutar({ prueba: 'x' }),
  'missing field': JSON.stringify(Object.fromEntries(Object.entries(expected).filter(([k]) => k !== 'run'))),
  'answer maybe': mutar({ answers: { C1: 'maybe' } }),
  'id with text': mutar({ answers: { 'C1 texto libre': 'sí' } }),
  'not json': '{no json',
  empty: '',
  'unknown error': mutar({ error: 'boom' }),
  'ok with error': mutar({ ok: true, error: 'output-unreadable' }),
  'bad run': mutar({ run: { id: 1 } }),
  'negative invalid': mutar({ invalid: -1 }),
  'array': '[]',
};
for (const [nombre, texto] of Object.entries(rotos)) {
  test(`parseRecord throws on: ${nombre}`, () => assert.throws(() => parseRecord(texto)));
}

const reg = (pr, ok, answers, error = null) => ({ ...expected, pr, ok, answers, error });
test('aggregate: rounds per PR, "no" per question, unreadable output apart', () => {
  const a = aggregate([
    reg(1, false, { C1: 'sí', C5: 'no' }),
    reg(1, true, { C1: 'sí', C5: 'sí' }),
    reg(2, true, { C1: 'no aplica', C5: 'sí' }),
    reg(3, false, { C1: null, C5: null }, 'output-unreadable'),
    reg(3, false, { C1: 'no', C5: 'no' }),
  ]);
  assert.deepEqual(a.porPr['o/r#1'], { rondas: 2, ok: 1, no: 1, 'output-unreadable': 0, 'standard-unloadable': 0 });
  assert.deepEqual(a.porPr['o/r#2'], { rondas: 1, ok: 1, no: 0, 'output-unreadable': 0, 'standard-unloadable': 0 });
  assert.deepEqual(a.porPr['o/r#3'], { rondas: 2, ok: 0, no: 1, 'output-unreadable': 1, 'standard-unloadable': 0 });
  assert.deepEqual(a.porPregunta.C1, { sí: 2, no: 1, 'no aplica': 1, 'sin-respuesta': 0 });
  assert.deepEqual(a.porPregunta.C5, { sí: 2, no: 2, 'no aplica': 0, 'sin-respuesta': 0 });
});

test('readCheckRuns: a check-run without record or with a broken one is unreadable, with its index', () => {
  const bueno = { output: { text: formatBlock(expected) } };
  const { records, unreadable } = readCheckRuns([bueno, { output: { text: 'sin registro' } }, { output: {} }, { output: { text: '```json\n{"v":2}\n```' } }, bueno]);
  assert.equal(records.length, 2);
  assert.deepEqual(unreadable.map((u) => u.index), [1, 2, 3]);
});

const cli = (...args) => spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'scripts', 'records.mjs'), ...args], { encoding: 'utf8' });
const tmp = (obj) => {
  const f = path.join(mkdtempSync(path.join(tmpdir(), 'rec-')), 'x.json');
  writeFileSync(f, JSON.stringify(obj));
  return f;
};

test('CLI: good file prints the figures and exits 0', () => {
  const r = cli('--file', path.join(import.meta.dirname, 'fixtures', 'records', 'ok.json'), '--json');
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(j).sort(), ['porPr', 'porPregunta', 'records', 'rondasMedias', 'unreadable']);
  assert.equal(j.records, 4);
  assert.equal(j.rondasMedias, 4 / 3);
  assert.equal(j.porPregunta.C5.no, 1);
});

test('CLI: a check-run without record gives exit 1 (a count that skips it would be false)', () => {
  const r = cli('--file', tmp([{ output: { text: formatBlock(expected) } }, { output: { text: 'nada' } }]), '--json');
  assert.equal(r.status, 1);
  assert.deepEqual(JSON.parse(r.stdout).unreadable.map((u) => u.index), [1]);
});

test('CLI: missing file, bad JSON or a non-array exit 1; no --file exits 1', () => {
  assert.equal(cli('--file', path.join(tmpdir(), 'no-existe-xyz.json')).status, 1);
  assert.equal(cli('--file', tmp({ a: 1 })).status, 1);
  assert.equal(cli().status, 1);
});

test('the standard path shape is one constant: the record and the judge both build their regex from STANDARD_SOURCE', () => {
  assert.equal(RUTA_ESTANDAR.source, new RegExp(String.raw`^(\.fabrica/)?(${STANDARD_SOURCE})$`).source);
  assert.ok(RUTA_ESTANDAR.test('.fabrica/standards/code.md') && RUTA_ESTANDAR.test('standards/code.md'));
  for (const f of ['scripts/veredicto.mjs', 'scripts/lib/record.mjs']) {
    const copias = readFileSync(path.join(import.meta.dirname, '..', f), 'utf8').split('a-z0-9-]+').length - 1;
    assert.equal(copias, f.endsWith('record.mjs') ? 1 : 0, `${f}: the path shape is written once, in record.mjs`);
  }
  assert.ok(!RUTA_ESTANDAR.test('standards/codeXmd') && !RUTA_ESTANDAR.test('x.fabrica/standards/code.md'));
  assert.throws(() => buildRecord({ ...base, standard: 'standards/codeXmd' }));
  assert.doesNotThrow(() => buildRecord(base));
  assert.throws(() => buildRecord({ ...base, standard: 'standards/a/b.md' }));
});

test('aggregate: counters come from the answer vocabulary, so a new answer never gives NaN; an unknown one throws', () => {
  const nuevo = [...ANSWERS, 'quizás'];
  const r = { ...expected, answers: { C1: 'quizás' } };
  const a = aggregate([r, { ...expected, answers: { C1: 'sí' } }], nuevo);
  assert.deepEqual(a.porPregunta.C1, { sí: 1, no: 0, 'no aplica': 0, quizás: 1, 'sin-respuesta': 0 });
  assert.throws(() => aggregate([r]), /vocabulary/);
});

test('aggregate: counters per error come from ERRORS, so a new error is counted apart (never as a no) and an unknown one throws', () => {
  const nuevo = [...ERRORS, 'otro-error'];
  const r = { ...expected, ok: false, error: 'otro-error', answers: {} };
  const a = aggregate([r, reg(1, false, { C1: 'no' })], ANSWERS, nuevo);
  assert.deepEqual(a.porPr['o/r#2'], { rondas: 1, ok: 0, no: 0, 'standard-unloadable': 0, 'output-unreadable': 0, 'otro-error': 1 });
  assert.throws(() => aggregate([r]), /error outside the vocabulary/);
});

test('the question id shape is one constant (questions.mjs): the record, the reader and the judge derive from it', () => {
  const leer = (f) => readFileSync(path.join(import.meta.dirname, '..', f), 'utf8');
  const cuenta = (texto, trozo) => texto.split(trozo).length - 1;
  assert.equal(cuenta(leer('scripts/lib/questions.mjs'), '[A-Z]'), 1);
  assert.equal(cuenta(leer('scripts/lib/record.mjs'), '[A-Z]'), 0);
  assert.equal(cuenta(leer('scripts/veredicto.mjs'), '[A-Z]'), 0);
  assert.equal(cuenta(leer('scripts/veredicto.mjs'), String.raw`C\d+`), 0, 'the judge builds its id check from ID_SOURCE and PREFIJO_DEL_JUEZ, not from a literal');
  assert.match(leer('scripts/veredicto.mjs'), /new RegExp\(`\^\(\?=\$\{ID_SOURCE\}\$\)\$\{PREFIJO_DEL_JUEZ\}`\)/);
  assert.equal(cuenta(leer('scripts/lib/record.mjs'), String.raw`/^\d+$/`), 1, 'DIGITS is written once');
  assert.equal(ID_SOURCE, ID_PARTS.prefix + ID_PARTS.number);
  for (const id of ['C1', 'P12']) {
    assert.ok(readQuestions(`### ${id} — t\nQuién: ${CHECKED_BY.reviewer}\n`).length === 1);
    assert.doesNotThrow(() => buildRecord({ ...base, respuestas: { answers: { [id]: 'sí' }, invalid: 0 } }));
  }
  for (const id of ['c1', 'CC1', 'C', 'C1x', 'ghs_X']) {
    assert.throws(() => readQuestions(`### ${id} — t\nQuién: ${CHECKED_BY.reviewer}\n`));
    assert.throws(() => buildRecord({ ...base, respuestas: { answers: { [id]: 'sí' }, invalid: 0 } }));
  }
});

test('who checks a question is one constant (CHECKED_BY), and the record answers shape is built by answersSummary', () => {
  assert.deepEqual(FIELDS.checkedBy.values, Object.values(CHECKED_BY));
  assert.deepEqual(answersSummary(), { answers: {}, invalid: 0 });
  assert.deepEqual(answersSummary({ C1: 'sí' }, 2), { answers: { C1: 'sí' }, invalid: 2 });
});
