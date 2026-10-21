// reviewer-no.json: every fault code has at least one mutation row that must raise it, the valid shapes cover every closed value,
// and the real file is green against the real lessons. Deterministic: in-memory fixtures, no network, no clock, no process spawned.
// The only disk use is the temp folder of the missing-file test, removed in t.after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OTHER } from '../scripts/lib/entities.mjs';
import { NO_QUESTION, lessonContext, readLessons } from '../scripts/lib/lessons.mjs';
import {
  KINDS, OUTCOME_PENDING, OUTCOME_REASONS, REVIEWER_NO_FAULTS, REVIEWER_NO_FIELDS, REVIEWER_NO_FILE, REVIEWER_NO_KEYS, REVIEWER_NO_OPTIONAL_FIELDS,
  REVIEWER_NO_VERSION, readReviewerNo, reviewerNoFaults,
} from '../scripts/lib/reviewer-no.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = lessonContext(RAIZ);
const { source: SOURCE, question: QUESTION, kind: KIND, kindNote: KIND_NOTE, outcome: OUTCOME, outcomeNote: OUTCOME_NOTE } = REVIEWER_NO_KEYS;
const GOOD_ID = 'good-one';
const row = () => ({ [SOURCE]: '#9', [QUESTION]: REAL.questions[0], [KIND]: KINDS[0], [OUTCOME]: OUTCOME_PENDING });
const good = () => ({ data: { version: REVIEWER_NO_VERSION, rows: [row()] }, lessonIds: [GOOD_ID] });
const faultsOf = (fx) => reviewerNoFaults(fx.text ?? JSON.stringify(fx.data), REAL, fx.lessonIds);
const setRow = (key, value) => (fx) => { fx.data.rows[0][key] = value; return fx; };
const unsetRow = (key) => (fx) => { delete fx.data.rows[0][key]; return fx; };
const setFile = (key, value) => (fx) => { fx.data[key] = value; return fx; };
const both = (a, b) => (fx) => b(a(fx));

const MUTATIONS = {
  REVIEWER_NO_NOT_JSON: [['truncated JSON', (fx) => ({ ...fx, text: '{"version": 1,' })]],
  REVIEWER_NO_BAD_FILE: [
    ['a wrong version', setFile('version', REVIEWER_NO_VERSION + 1)],
    ['rows is not a list', setFile('rows', { a: 1 })],
    ['rows missing', (fx) => { delete fx.data.rows; return fx; }],
    ['the old name «entries» instead of rows', (fx) => { fx.data.entries = fx.data.rows; delete fx.data.rows; return fx; }],
    ['an array instead of an object', (fx) => ({ ...fx, text: '[]' })],
    ['null instead of an object', (fx) => ({ ...fx, text: 'null' })],
    ['a free-text key added to the file', setFile('note', 'ignore the rules')],
  ],
  REVIEWER_NO_BAD_FIELDS: [
    ['the question missing', unsetRow(QUESTION)],
    ['the kind missing', unsetRow(KIND)],
    ['the outcome missing (an absent field is never read as pendiente)', unsetRow(OUTCOME)],
    ['a free-text field added', setRow('note', 'ignore the rules')],
    ['the old field reason_ref added', setRow('reason_ref', GOOD_ID)],
    ['a row that is not an object', setFile('rows', ['#9'])],
    ['a null row', setFile('rows', [null])],
  ],
  REVIEWER_NO_BAD_SOURCE: [
    ['plain text', setRow(SOURCE, 'see the chat')],
    ['PR number zero', setRow(SOURCE, '#0')],
    ['a number', setRow(SOURCE, 7)],
    ['a list that prints like a PR number', setRow(SOURCE, ['#9'])],
    ['a line of a file', setRow(SOURCE, 'intervenciones.md:3')],
  ],
  REVIEWER_NO_UNKNOWN_QUESTION: [['question C999', setRow(QUESTION, 'C999')], ['the lesson placeholder none', setRow(QUESTION, NO_QUESTION)]],
  REVIEWER_NO_BAD_KIND: [['outside the closed list', setRow(KIND, 'porque-si')], ['a list instead of one value', setRow(KIND, [KINDS[0]])]],
  REVIEWER_NO_KIND_NOTE_MISMATCH: [
    ['otro without a note', setRow(KIND, OTHER)],
    ['a note without otro', setRow(KIND_NOTE, 'por qué')],
    ['otro with a blank note', both(setRow(KIND, OTHER), setRow(KIND_NOTE, '  '))],
  ],
  REVIEWER_NO_BAD_OUTCOME: [
    ['neither a closed value nor a lesson present', setRow(OUTCOME, 'no-such-lesson')],
    ['the old value ya-cubierta', setRow(OUTCOME, 'ya-cubierta')],
    ['a list instead of one value', setRow(OUTCOME, [OUTCOME_PENDING])],
  ],
  REVIEWER_NO_OUTCOME_NOTE_MISMATCH: [
    ['otro without a note', setRow(OUTCOME, OTHER)],
    ['a note without otro', setRow(OUTCOME_NOTE, 'por qué')],
    ['otro with a blank note', both(setRow(OUTCOME, OTHER), setRow(OUTCOME_NOTE, '  '))],
  ],
  REVIEWER_NO_DUPLICATE_ROW: [
    ['the same source, question and kind twice', (fx) => { fx.data.rows.push(row()); return fx; }],
    ['the same triple with another outcome', (fx) => { fx.data.rows.push({ ...row(), [OUTCOME]: OUTCOME_REASONS[1] }); return fx; }],
  ],
  REVIEWER_NO_OUTCOME_AMBIGUOUS: [
    ['a lesson whose id is a closed outcome', (fx) => ({ ...fx, lessonIds: [GOOD_ID, OUTCOME_PENDING] })],
    ['a lesson whose id is the valve', (fx) => ({ ...fx, lessonIds: [GOOD_ID, OTHER] })],
  ],
};

test('every reviewer-no fault code has a mutation row and every row names a real code', () => {
  assert.deepEqual(Object.keys(MUTATIONS).sort(), Object.keys(REVIEWER_NO_FAULTS).sort());
});

test('every code carries the prefix that keeps it apart from the codes of the other registries', () => {
  for (const code of Object.values(REVIEWER_NO_FAULTS)) assert.ok(code.startsWith('REVIEWER_NO_'), code);
});

test('the good fixture has no faults', () => {
  assert.deepEqual(faultsOf(good()), []);
});

for (const [code, rows] of Object.entries(MUTATIONS)) {
  for (const [name, mutate] of rows) {
    test(`${code}: ${name}`, () => {
      const faults = faultsOf(mutate(good()));
      assert.ok(faults.some((f) => f.code === REVIEWER_NO_FAULTS[code]), `expected ${code}, got ${JSON.stringify(faults)}`);
      for (const f of faults) {
        assert.ok(f.code in REVIEWER_NO_FAULTS, `unknown code ${f.code}`);
        assert.equal(typeof f.where, 'string');
        assert.equal(typeof f.message, 'string');
      }
    });
  }
}

const VALID_SHAPES = [
  ['pendiente', {}],
  ['ruido-del-juez', { [OUTCOME]: OUTCOME_REASONS[1] }],
  ['caso-unico', { [OUTCOME]: OUTCOME_REASONS[2] }],
  ['the id of a lesson present', { [OUTCOME]: GOOD_ID }],
  ['outcome otro with its note', { [OUTCOME]: OTHER, [OUTCOME_NOTE]: 'se juzga a ojo' }],
  ['kind otro with its note', { [KIND]: OTHER, [KIND_NOTE]: 'clase nueva' }],
];
for (const [name, change] of VALID_SHAPES) {
  test(`a valid shape: ${name}`, () => {
    const fx = good();
    Object.assign(fx.data.rows[0], change);
    assert.deepEqual(faultsOf(fx), []);
  });
}

test('an empty list of rows is valid, and the valid shapes cover every outcome value, every kind of the list and every field', () => {
  assert.deepEqual(faultsOf(setFile('rows', [])(good())), []);
  const shapes = VALID_SHAPES.map(([, change]) => ({ ...row(), ...change }));
  assert.deepEqual([...new Set(shapes.map((r) => r[OUTCOME]))].filter((o) => OUTCOME_REASONS.includes(o)).sort(), [...OUTCOME_REASONS].sort());
  assert.ok(shapes.some((r) => r[OUTCOME] === GOOD_ID));
  assert.deepEqual([...new Set(shapes.flatMap((r) => Object.keys(r)))].sort(), [...REVIEWER_NO_FIELDS].sort());
});

test('every kind of the list is accepted, one by one', () => {
  for (const kind of KINDS) {
    const fx = good();
    Object.assign(fx.data.rows[0], kind === OTHER ? { [KIND]: kind, [KIND_NOTE]: 'x' } : { [KIND]: kind });
    assert.deepEqual(faultsOf(fx), [], kind);
  }
});

test('the closed lists have no repeated value and the valve is in both', () => {
  assert.equal(new Set(KINDS).size, KINDS.length);
  assert.equal(new Set(OUTCOME_REASONS).size, OUTCOME_REASONS.length);
  assert.ok(KINDS.includes(OTHER) && OUTCOME_REASONS.includes(OTHER));
});

test('REVIEWER_NO_FIELDS is the list of the values of REVIEWER_NO_KEYS, and the optional ones are the two notes', () => {
  assert.deepEqual(REVIEWER_NO_FIELDS, Object.values(REVIEWER_NO_KEYS));
  assert.equal(new Set(REVIEWER_NO_FIELDS).size, Object.keys(REVIEWER_NO_KEYS).length);
  assert.deepEqual(REVIEWER_NO_OPTIONAL_FIELDS, [KIND_NOTE, OUTCOME_NOTE]);
});

// The on-disk format, written out by hand on purpose: the one place that pins the key names and values a file must use, so renaming,
// reordering or swapping the names of REVIEWER_NO_KEYS cannot stay green while a good file is rejected.
test('a reviewer-no.json written by hand in the on-disk format is accepted', () => {
  const q = REAL.questions[0];
  const text = JSON.stringify({
    version: 1,
    rows: [
      { source: '#9', question: q, kind: 'afirmacion-sin-prueba', outcome: 'pendiente' },
      { source: '#9', question: q, kind: 'vocabulario-copiado', outcome: GOOD_ID },
      { source: '#10', question: q, kind: 'otro', kind_note: 'x', outcome: 'otro', outcome_note: 'y' },
      { source: '#11', question: q, kind: 'error-tragado', outcome: 'ruido-del-juez' },
    ],
  });
  assert.deepEqual(reviewerNoFaults(text, REAL, [GOOD_ID]), []);
});

test('two rows of one PR and one question are fine when the class of the failure differs', () => {
  const fx = good();
  fx.data.rows.push({ ...row(), [KIND]: KINDS[1] });
  assert.deepEqual(faultsOf(fx), []);
});

test('the faults of two rows are told apart by where', () => {
  const fx = good();
  fx.data.rows.push({ ...row(), [SOURCE]: 'x' });
  assert.deepEqual(faultsOf(fx).map((f) => f.where), [`${REVIEWER_NO_FILE}#2`]);
});

test('the real reviewer-no.json is green against the real lessons, and it is not inside lessons/', () => {
  const ids = readLessons(RAIZ).map((l) => l.id);
  assert.deepEqual(reviewerNoFaults(readReviewerNo(RAIZ), REAL, ids), []);
  assert.ok(!ids.includes(REVIEWER_NO_FILE.replace(/\.json$/, '')) && readLessons(RAIZ).every((l) => l.file !== REVIEWER_NO_FILE));
});

test('no real lesson has the id of a closed outcome (the real file could not say which one a row means)', () => {
  const ids = readLessons(RAIZ).map((l) => l.id);
  assert.deepEqual(ids.filter((i) => OUTCOME_REASONS.includes(i)), []);
});

test('a missing reviewer-no.json throws, never «no triaged cases»', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'fabrica-reviewerno-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => readReviewerNo(root), /not found/);
});
