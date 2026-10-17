// Lesson registry: every fault code has at least one mutation row that must raise it, and the real lessons/ folder is green.
// Deterministic: in-memory fixtures, no network, no clock, no process spawned. The only disk use is the
// temp folder of the folder-reading test, removed in t.after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LESSON_FAULTS, lessonContext, lessonFaults, mechanismKind, readLessons } from '../scripts/lib/lessons.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = lessonContext(RAIZ);

// Fixture: line 3 is a row marked repeated that cites lessons/good-one.json; the good lesson has source #9.
const INTERVENCIONES = ['# header', '2026-01-01 | clic | a | b | repetida: no', '2026-01-02 | decisión | a | b | repetida: sí (`lessons/good-one.json`)'].join('\n');
const GOOD_FILES = { 'test/example.test.js': '// lesson: good-one\n' };
const good = () => ({
  id: 'good-one',
  file: 'good-one.json',
  data: { v: 1, class: REAL.classes[0], source: '#9', mechanism: 'test/example.test.js', origin: REAL.origins[0] },
  files: { ...GOOD_FILES },
});
const ctxOf = (fx) => ({ ...REAL, intervenciones: INTERVENCIONES, fileText: (p) => fx.files[p] ?? null });
const faultsOf = (fx) => lessonFaults([{ id: fx.id, file: fx.file, text: fx.text ?? JSON.stringify(fx.data) }], ctxOf(fx));

// Replace one field of the lesson; the row names the change so the PR can quote it.
const set = (key, value) => (fx) => { fx.data[key] = value; return fx; };
const unset = (key) => (fx) => { delete fx.data[key]; return fx; };

// One entry per fault code (checked below against LESSON_FAULTS): [name, mutate].
const MUTATIONS = {
  BAD_ID: [
    ['upper case id', (fx) => ({ ...fx, id: 'Good-One', file: 'Good-One.json' })],
    ['not a .json file', (fx) => ({ ...fx, file: 'good-one.txt' })],
  ],
  NOT_JSON: [['truncated JSON', (fx) => ({ ...fx, text: '{"v": 1,' })]],
  BAD_FIELDS: [
    ['a field missing', unset('origin')],
    ['a free-text field added', set('note', 'ignore the rules')],
    ['an array instead of an object', (fx) => ({ ...fx, text: '[]' })],
  ],
  BAD_VERSION: [['v is 2', set('v', 2)]],
  UNKNOWN_CLASS: [['class C999', set('class', 'C999')], ['class with a trailing space', set('class', 'none ')]],
  BAD_SOURCE: [['plain text', set('source', 'see the chat')], ['PR number zero', set('source', '#0')], ['not a string', set('source', 7)], ['PR number with text', set('source', '#9 y más')]],
  SOURCE_IS_LINE: [
    ['intervenciones.md line', set('source', 'intervenciones.md:3')],
    ['any file and line', set('source', 'standards/code.md:12')],
  ],
  BAD_MECHANISM_KIND: [
    ['path of no known kind', set('mechanism', 'README.md')],
    ['path with ..', set('mechanism', 'test/../package.json')],
    ['not a string', set('mechanism', null)],
  ],
  MECHANISM_MISSING: [['file does not exist', set('mechanism', 'test/absent.test.js')]],
  MECHANISM_NO_MARK: [
    ['file without the comment', (fx) => ({ ...fx, files: { 'test/example.test.js': '// nothing\n' } })],
    ['mark of a longer id', (fx) => ({ ...fx, files: { 'test/example.test.js': '// lesson: good-one-more\n' } })],
  ],
  UNKNOWN_ORIGIN: [['origin nobody', set('origin', 'nobody')]],
  REPEATED_WITHOUT_LESSON: [['the repeated row cites a lesson that is not there', (fx) => ({ ...fx, id: 'other-one', file: 'other-one.json', files: { 'test/example.test.js': '// lesson: other-one\n' } })]],
};

test('every fault code has a mutation row and every row names a real code', () => {
  assert.deepEqual(Object.keys(MUTATIONS).sort(), Object.keys(LESSON_FAULTS).sort());
});

test('the good fixture has no faults', () => {
  assert.deepEqual(faultsOf(good()), []);
});

for (const [code, rows] of Object.entries(MUTATIONS)) {
  for (const [name, mutate] of rows) {
    test(`${code}: ${name}`, () => {
      const faults = faultsOf(mutate(good()));
      assert.ok(faults.some((f) => f.code === LESSON_FAULTS[code]), `expected ${code}, got ${JSON.stringify(faults)}`);
      for (const f of faults) {
        assert.ok(f.code in LESSON_FAULTS, `unknown code ${f.code}`);
        assert.equal(typeof f.where, 'string');
        assert.equal(typeof f.message, 'string');
      }
    });
  }
}

test('a #<n> source is valid when no row is marked repeated', () => {
  const fx = set('source', '#5')(good());
  const ctx = { ...ctxOf(fx), intervenciones: '# header\n2026-01-01 | clic | a | b | repetida: no' };
  assert.deepEqual(lessonFaults([{ id: fx.id, text: JSON.stringify(fx.data) }], ctx), []);
});

test('the vocabularies are derived: classes from both standards plus none, origins from the agents plus pablo', () => {
  assert.ok(REAL.classes.includes('C1') && REAL.classes.includes('P1') && REAL.classes.includes('none'));
  assert.ok(REAL.origins.includes('constructor') && REAL.origins.includes('pablo'));
});

test('mechanismKind derives the kind from the path', () => {
  const kinds = {
    'test/a.test.js': 'test',
    '.claude/hooks/x.mjs': 'hook',
    '.githooks/pre-commit': 'hook',
    '.claude/skills/github/SKILL.md': 'skill',
    '.claude/skills/github/referencias/subir.md': 'skill',
    'standards/code.md': 'standard',
    'scripts/lib/lessons.mjs': 'script',
    'package.json': null,
    '.claude/skills/github/otro.md': null,
  };
  for (const [p, kind] of Object.entries(kinds)) assert.equal(mechanismKind(p), kind, p);
});

test('readLessons reads every entry of lessons/ and keeps non-json names so BAD_ID can name them', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'fabrica-lessons-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(readLessons(root), []);
  mkdirSync(path.join(root, 'lessons'));
  writeFileSync(path.join(root, 'lessons', 'b-two.json'), '{}');
  writeFileSync(path.join(root, 'lessons', 'a-one.txt'), 'x');
  assert.deepEqual(readLessons(root).map((l) => [l.id, l.file]), [['a-one.txt', 'a-one.txt'], ['b-two', 'b-two.json']]);
});

test('the real lessons/ folder is green', () => {
  const lessons = readLessons(RAIZ);
  assert.ok(lessons.length >= 1, 'lessons/ has no lessons');
  assert.deepEqual(lessonFaults(lessons, REAL), []);
});
