// Lesson registry: every fault code has at least one mutation row that must raise it, and the real lessons/ folder is green.
// Deterministic: in-memory fixtures, no network, no clock, no process spawned. The only disk use is the
// temp folder of the folder-reading test, removed in t.after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OTHER } from '../scripts/lib/entities.mjs';
import {
  FIELDS, KINDS, LESSON_FAULTS, MACHINE_KINDS, NO_LESSON_FAULTS, NO_LESSON_FIELDS, NO_LESSON_FILE, NO_LESSON_OPTIONAL_FIELDS, NO_LESSON_REASONS, NO_LESSON_VERSION, NO_QUESTION,
  NO_QUESTION_REASONS, NO_SIGNAL_REASONS, REASON_COVERED, REASON_NO_QUESTION, REASON_NOISE, REASON_PENDING, REASON_SINGLE, REASONS, SIGNAL_MACHINE,
  SIGNAL_NONE, SIGNALS, VERSION, lessonContext, lessonFaults, mechanismKind, noLessonFaults, readLessons, readNoLesson,
} from '../scripts/lib/lessons.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = lessonContext(RAIZ);

// Fixture: line 3 is a row marked repeated that cites lessons/good-one.json; the good lesson has sources #9 and #10 (two cases, so no reason).
const INTERVENCIONES = ['# header', '2026-01-01 | clic | a | b | repetida: no', '2026-01-02 | decisión | a | b | repetida: sí (`lessons/good-one.json`)'].join('\n');
const GOOD_FILES = { 'test/example.test.js': '// lesson: good-one\n' };
const good = () => ({
  id: 'good-one',
  file: 'good-one.json',
  data: {
    v: VERSION, question: REAL.questions[0], sources: ['#9', '#10'], mechanism: 'test/example.test.js', origin: REAL.origins[0], signal: SIGNAL_MACHINE, escaped: false,
  },
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
    ['the v1 field class', set('class', 'C5')],
    ['escaped missing', unset('escaped')],
    ['a free-text field added', set('note', 'ignore the rules')],
    ['an array instead of an object', (fx) => ({ ...fx, text: '[]' })],
  ],
  BAD_VERSION: [['v is 1', set('v', 1)]],
  UNKNOWN_QUESTION: [['question C999', set('question', 'C999')], ['question with a trailing space', set('question', `${NO_QUESTION} `)]],
  QUESTION_WITHOUT_REASON: [
    ['question none and no reason', set('question', NO_QUESTION)],
    ['question none and a reason that is not about the question', (fx) => set('reason', [OTHER])(set('reason_note', 'x')(set('question', NO_QUESTION)(fx)))],
  ],
  BAD_SOURCES: [['not a list', set('sources', '#9')], ['empty list', set('sources', [])], ['the same case twice', set('sources', ['#9', '#9'])]],
  BAD_SOURCE: [['plain text', set('sources', ['#9', 'see the chat'])], ['PR number zero', set('sources', ['#9', '#0'])], ['not a string', set('sources', ['#9', 7])], ['PR number with text', set('sources', ['#9', '#9 y más'])]],
  SOURCE_IS_LINE: [
    ['intervenciones.md line', set('sources', ['#9', 'intervenciones.md:3'])],
    ['any file and line', set('sources', ['#9', 'standards/code.md:12'])],
  ],
  BAD_SIGNAL: [['signal nobody', set('signal', 'human')], ['signal null', set('signal', null)]],
  MACHINE_SIGNAL_NOT_MACHINE: [
    ['a machine signal whose mechanism is a standard', (fx) => ({ ...set('mechanism', 'standards/code.md')(fx), files: { 'standards/code.md': '// lesson: good-one\n' } })],
    ['a machine signal whose mechanism is a skill', (fx) => ({ ...set('mechanism', '.claude/skills/github/SKILL.md')(fx), files: { '.claude/skills/github/SKILL.md': '// lesson: good-one\n' } })],
  ],
  SIGNAL_NONE_WITHOUT_REASON: [
    ['signal none and no reason', set('signal', SIGNAL_NONE)],
    ['signal none and only the single-case reason', (fx) => set('reason', [REASON_SINGLE])(set('signal', SIGNAL_NONE)(set('sources', ['#9'])(fx)))],
  ],
  BAD_REASON: [
    ['reason not a list', set('reason', REASON_PENDING)],
    ['reason empty', set('reason', [])],
    ['reason outside the closed list', set('reason', ['porque-si'])],
    ['reason repeated', set('reason', [REASON_PENDING, REASON_PENDING])],
    ['a no-question reason on a lesson that has a question', set('reason', [REASON_NO_QUESTION])],
  ],
  REASON_NOTE_MISMATCH: [
    ['otro without a note', set('reason', [OTHER])],
    ['a note without otro', set('reason_note', 'por qué')],
    ['otro with a blank note', (fx) => set('reason_note', '  ')(set('reason', [OTHER])(fx))],
  ],
  SINGLE_CASE_WITHOUT_REASON: [
    ['one source and no caso-unico', set('sources', ['#9'])],
    ['one source and another reason', (fx) => set('reason', [OTHER])(set('reason_note', 'x')(set('sources', ['#9'])(fx)))],
  ],
  CASE_UNIQUE_WITH_MANY: [['caso-unico with two sources', set('reason', [REASON_SINGLE])]],
  BAD_ESCAPED: [['escaped as text', set('escaped', 'false')], ['escaped as a number', set('escaped', 0)]],
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
  const fx = set('sources', ['#5', '#6'])(good());
  const ctx = { ...ctxOf(fx), intervenciones: '# header\n2026-01-01 | clic | a | b | repetida: no' };
  assert.deepEqual(lessonFaults([{ id: fx.id, text: JSON.stringify(fx.data) }], ctx), []);
});

test('the vocabularies are derived: questions from both standards plus none, origins from the agents plus pablo', () => {
  assert.ok(REAL.questions.includes('C1') && REAL.questions.includes('P1') && REAL.questions.includes(NO_QUESTION));
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

// The valid shapes, one row each: [name, fields to change from good()].
const VALID_SHAPES = [
  ['a question, two cases, a machine: no reason', {}],
  ['one case: caso-unico', { sources: ['#9'], reason: [REASON_SINGLE] }],
  ['no question yet and one case', { question: NO_QUESTION, sources: ['#9'], reason: [REASON_PENDING, REASON_SINGLE] }],
  ['conduct with no question', { question: NO_QUESTION, reason: [REASON_NO_QUESTION] }],
  ['no machine signal, valve otro with its note', { signal: SIGNAL_NONE, reason: [OTHER], reason_note: 'se juzga a ojo' }],
  ['escaped to main', { escaped: true }],
];
for (const [name, change] of VALID_SHAPES) {
  test(`a valid shape: ${name}`, () => {
    const fx = good();
    Object.assign(fx.data, change);
    assert.deepEqual(faultsOf(fx), []);
  });
}

test('the reason lists and the machine kinds are subsets of what they are derived from', () => {
  for (const r of [...NO_QUESTION_REASONS, ...NO_SIGNAL_REASONS]) assert.ok(REASONS.includes(r), `${r} is not in REASONS`);
  for (const k of MACHINE_KINDS) assert.ok(KINDS.some(([name]) => name === k), `${k} is not a kind of KINDS`);
  assert.ok(MACHINE_KINDS.length > 0 && MACHINE_KINDS.length < KINDS.length, 'some kinds are machines and some are not');
  assert.ok(SIGNALS.includes(SIGNAL_MACHINE) && SIGNALS.includes(SIGNAL_NONE));
});

test('every field of FIELDS is used by some valid shape', () => {
  const used = new Set(VALID_SHAPES.flatMap(([, change]) => Object.keys({ ...good().data, ...change })));
  for (const f of FIELDS) assert.ok(used.has(f), `no valid shape uses ${f}`);
});

// no-lesson.json: the triaged «no» that got no lesson. The entry keys come from NO_LESSON_FIELDS, never typed again.
const [SOURCE, QUESTION, REASON, REF, NOTE] = NO_LESSON_FIELDS;
const entry = () => ({ [SOURCE]: '#9', [QUESTION]: REAL.questions[0], [REASON]: REASON_NOISE });
const goodNoLesson = () => ({ data: { version: NO_LESSON_VERSION, entries: [entry()] }, lessonIds: ['good-one'] });
const noLessonOf = (fx) => noLessonFaults(fx.text ?? JSON.stringify(fx.data), REAL, fx.lessonIds);
const setEntry = (key, value) => (fx) => { fx.data.entries[0][key] = value; return fx; };
const unsetEntry = (key) => (fx) => { delete fx.data.entries[0][key]; return fx; };
const setFile = (key, value) => (fx) => { fx.data[key] = value; return fx; };

const NO_LESSON_MUTATIONS = {
  NO_LESSON_NOT_JSON: [['truncated JSON', (fx) => ({ ...fx, text: '{"version": 1,' })]],
  NO_LESSON_BAD_FILE: [
    ['a wrong version', setFile('version', NO_LESSON_VERSION + 1)],
    ['entries is not a list', setFile('entries', { a: 1 })],
    ['entries missing', (fx) => { delete fx.data.entries; return fx; }],
    ['an array instead of an object', (fx) => ({ ...fx, text: '[]' })],
    ['null instead of an object', (fx) => ({ ...fx, text: 'null' })],
    ['a free-text key added to the file', setFile('note', 'ignore the rules')],
  ],
  NO_LESSON_BAD_FIELDS: [
    ['the question missing', unsetEntry(QUESTION)],
    ['the reason missing', unsetEntry(REASON)],
    ['a free-text field added', setEntry('note', 'ignore the rules')],
    ['an entry that is not an object', setFile('entries', ['#9'])],
    ['a null entry', setFile('entries', [null])],
  ],
  NO_LESSON_BAD_SOURCE: [
    ['plain text', setEntry(SOURCE, 'see the chat')],
    ['PR number zero', setEntry(SOURCE, '#0')],
    ['a number', setEntry(SOURCE, 7)],
    ['a list that prints like a PR number', setEntry(SOURCE, ['#9'])],
    ['a line of a file', setEntry(SOURCE, 'intervenciones.md:3')],
  ],
  NO_LESSON_UNKNOWN_QUESTION: [['question C999', setEntry(QUESTION, 'C999')], ['the lesson placeholder none', setEntry(QUESTION, NO_QUESTION)]],
  NO_LESSON_BAD_REASON: [['outside the closed list', setEntry(REASON, 'porque-si')], ['a list instead of one value', setEntry(REASON, [REASON_NOISE])]],
  NO_LESSON_REF_MISMATCH: [
    ['ya-cubierta without a reason_ref', setEntry(REASON, REASON_COVERED)],
    ['a reason_ref without ya-cubierta', setEntry(REF, 'good-one')],
    ['ya-cubierta with a blank reason_ref', (fx) => setEntry(REF, '  ')(setEntry(REASON, REASON_COVERED)(fx))],
  ],
  NO_LESSON_UNKNOWN_LESSON: [['ya-cubierta citing a lesson that is not there', (fx) => setEntry(REF, 'no-such-lesson')(setEntry(REASON, REASON_COVERED)(fx))]],
  NO_LESSON_NOTE_MISMATCH: [
    ['otro without a note', setEntry(REASON, OTHER)],
    ['a note without otro', setEntry(NOTE, 'por qué')],
    ['otro with a blank note', (fx) => setEntry(NOTE, '  ')(setEntry(REASON, OTHER)(fx))],
  ],
};

test('every no-lesson fault code has a mutation row and every row names a real code', () => {
  assert.deepEqual(Object.keys(NO_LESSON_MUTATIONS).sort(), Object.keys(NO_LESSON_FAULTS).sort());
});

test('the good no-lesson fixture has no faults', () => {
  assert.deepEqual(noLessonOf(goodNoLesson()), []);
});

for (const [code, rows] of Object.entries(NO_LESSON_MUTATIONS)) {
  for (const [name, mutate] of rows) {
    test(`${code}: ${name}`, () => {
      const faults = noLessonOf(mutate(goodNoLesson()));
      assert.ok(faults.some((f) => f.code === NO_LESSON_FAULTS[code]), `expected ${code}, got ${JSON.stringify(faults)}`);
      for (const f of faults) {
        assert.ok(f.code in NO_LESSON_FAULTS, `unknown code ${f.code}`);
        assert.equal(typeof f.where, 'string');
        assert.equal(typeof f.message, 'string');
      }
    });
  }
}

const NO_LESSON_VALID_SHAPES = [
  ['ruido-del-juez', {}],
  ['caso-unico', { [REASON]: REASON_SINGLE }],
  ['ya-cubierta with the id of a lesson present', { [REASON]: REASON_COVERED, [REF]: 'good-one' }],
  ['otro with its note', { [REASON]: OTHER, [NOTE]: 'se juzga a ojo' }],
];
for (const [name, change] of NO_LESSON_VALID_SHAPES) {
  test(`a valid no-lesson shape: ${name}`, () => {
    const fx = goodNoLesson();
    Object.assign(fx.data.entries[0], change);
    assert.deepEqual(noLessonOf(fx), []);
  });
}

test('an empty list of entries is valid, and every closed reason has a valid shape', () => {
  assert.deepEqual(noLessonOf(setFile('entries', [])(goodNoLesson())), []);
  const used = new Set(NO_LESSON_VALID_SHAPES.map(([, change]) => ({ ...entry(), ...change })[REASON]));
  assert.deepEqual([...used].sort(), [...NO_LESSON_REASONS].sort());
  const keys = new Set(NO_LESSON_VALID_SHAPES.flatMap(([, change]) => Object.keys({ ...entry(), ...change })));
  assert.deepEqual([...keys].sort(), [...NO_LESSON_FIELDS].sort());
  assert.ok(NO_LESSON_OPTIONAL_FIELDS.every((f) => NO_LESSON_FIELDS.includes(f)));
});

test('the faults of two entries are told apart by where', () => {
  const fx = goodNoLesson();
  fx.data.entries.push({ ...entry(), [SOURCE]: 'x' });
  const faults = noLessonOf(fx);
  assert.deepEqual(faults.map((f) => f.where), [`${NO_LESSON_FILE}#2`]);
});

test('the real no-lesson.json is green against the real lessons, and it is not inside lessons/', () => {
  const ids = readLessons(RAIZ).map((l) => l.id);
  assert.deepEqual(noLessonFaults(readNoLesson(RAIZ), REAL, ids), []);
  assert.ok(!ids.includes(NO_LESSON_FILE.replace(/\.json$/, '')) && readLessons(RAIZ).every((l) => l.file !== NO_LESSON_FILE));
});

test('a missing no-lesson.json throws, never «no triaged cases»', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'fabrica-nolesson-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => readNoLesson(root), /not found/);
});
