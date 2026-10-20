// scripts/lib/free-values.mjs: the values of the fields that fields.json marks as text, which repeat, and when an enum is
// proposed. Each rule, each reader (by the values it returns) and the text line have a case that turns it red; the real registry must have a reader for every text field it declares.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTITY, FIELDS_FILE, KEYS, TEXT, VALUE_KINDS, fieldId, readFields } from '../scripts/lib/fields.mjs';
import {
  MAX_ENUM_VALUES, MIN_REPEATS, MIN_VALUES, VALUE_READERS, freeValues, humanFreeValues, summarize,
} from '../scripts/lib/free-values.mjs';
import { LESSONS_DIR, LESSON_NOTE, NO_LESSON_FILE, NO_LESSON_KEYS } from '../scripts/lib/lessons.mjs';
import { NONE_WORD, PLAN_DIR, PLAN_FIELDS } from '../scripts/lib/plan.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTE = LESSON_NOTE;
const OWNER = ENTITY.lesson;
const NOT_TEXT = VALUE_KINDS.find((k) => k !== TEXT);
const same = (n, v = 'same') => Array.from({ length: n }, () => v);
const distinct = (n) => Array.from({ length: n }, (_, i) => `v${i}`);

const field = (name, values = TEXT, owner = OWNER) => ({ [KEYS.name]: name, [KEYS.owner]: owner, [KEYS.values]: values });
function put(root, rel, text) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text);
}
// A throwaway root with a registry and one lesson file per note.
function root(t, fields, notes = []) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fabrica-free-values-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  put(dir, FIELDS_FILE, JSON.stringify({ fields }));
  notes.forEach((n, i) => put(dir, `${LESSONS_DIR}/l${i}.json`, JSON.stringify({ [NOTE]: n })));
  return dir;
}

test('summarize counts each value once cleaned (spaces and edges) and lists the repeated ones, most frequent first', () => {
  const s = summarize(['b', 'a  x', ' a x', 'a x', 'b', 'c']);
  assert.deepEqual(s.repeated, [{ value: 'a x', count: 3 }, { value: 'b', count: MIN_REPEATS }]);
  assert.equal(s.total, 6);
  assert.equal(s.distinct, 3);
});

test('summarize proposes an enum when enough values repeat among few different ones', () => {
  const values = [...same(MIN_VALUES, 'x'), 'y'];
  assert.deepEqual(summarize(values).proposal, ['x', 'y']);
});

test('summarize proposes nothing: too few values, too many different ones, or no repetition', () => {
  assert.equal(summarize(same(MIN_VALUES - 1)).proposal, null);
  assert.equal(summarize([...distinct(MAX_ENUM_VALUES + 1), ...distinct(MAX_ENUM_VALUES + 1)]).proposal, null);
  assert.equal(summarize([...distinct(MAX_ENUM_VALUES), ...distinct(MAX_ENUM_VALUES)]).proposal?.length, MAX_ENUM_VALUES);
  assert.equal(summarize(distinct(MIN_VALUES)).proposal, null);
  assert.equal(summarize([]).total, 0);
});

test('freeValues reads the values of a text field from the files and proposes its enum', (t) => {
  const r = freeValues(root(t, [field(NOTE)], [...same(MIN_VALUES, 'a'), 'b']));
  assert.equal(r.count, 1);
  assert.deepEqual(r.fields.map((f) => [f.field, f.total, f.proposal]), [[`${OWNER}.${NOTE}`, MIN_VALUES + 1, ['a', 'b']]]);
});

test('freeValues skips the fields that are not text', (t) => {
  assert.deepEqual(freeValues(root(t, [field(NOTE, NOT_TEXT)])).fields, []);
});

test('freeValues throws for a text field with no reader: a hole is never read as «no values»', (t) => {
  const bad = field('no-reader-field');
  assert.throws(() => freeValues(root(t, [bad])), (e) => e.message.includes(fieldId(bad)));
});

test('freeValues stops when a source cannot be read: a lesson that is not JSON', (t) => {
  const dir = root(t, [field(NOTE)]);
  put(dir, `${LESSONS_DIR}/roto.json`, 'not json');
  assert.throws(() => freeValues(dir), SyntaxError);
});

test('the plan readers give the value of each field of every chunk; absent fields give no value and a .md file is the only plan', (t) => {
  const label = PLAN_FIELDS;
  const dir = root(t, []);
  const fence = '`'.repeat(3);
  const chunk = (n, blocked) => [
    `### ${n}. t`, `${label.files}: \`a\``, `${label.dependsOn}: ${NONE_WORD}`, `${label.blockedBy}: ${blocked}`,
    `${label.existing}: ex-${n}`, `${label.notDone}: nd-${n}`, `${label.done}:`, `${fence}sh`, `cmd-${n}`, fence, '',
  ].join('\n');
  const bare = `### 3. bare\n${label.files}: \`a\`\n`;
  put(dir, `${PLAN_DIR}p.md`, `# Plan: x\n\n## Chunks\n\n${chunk(1, NONE_WORD)}\n${chunk(2, '1, 2')}\n${bare}`);
  put(dir, `${PLAN_DIR}notes.txt`, `# Plan: y\n\n## Chunks\n\n${chunk(9, '7')}`);
  const read = (name) => VALUE_READERS[ENTITY.plan][name](dir);
  assert.deepEqual(read(label.blockedBy), [NONE_WORD, '1, 2']);
  assert.deepEqual(read(label.existing), ['ex-1', 'ex-2']);
  assert.deepEqual(read(label.notDone), ['nd-1', 'nd-2']);
  assert.deepEqual(read(label.done), ['cmd-1', 'cmd-2']);
});

test('freeValues counts only the fields with a proposal and reports its own thresholds', (t) => {
  const noteOfNoLesson = field(NO_LESSON_KEYS.note, TEXT, ENTITY.noLesson);
  const dir = root(t, [field(NOTE), noteOfNoLesson], [...same(MIN_VALUES, 'a'), 'b']);
  put(dir, NO_LESSON_FILE, JSON.stringify({ entries: [] }));
  const r = freeValues(dir);
  assert.equal(r.fields.length, 2);
  assert.equal(r.count, 1);
  assert.deepEqual([r.minValues, r.maxEnumValues], [MIN_VALUES, MAX_ENUM_VALUES]);
});

test('summarize orders repeated values of the same count by value, not by arrival', () => {
  assert.deepEqual(summarize(['b', 'b', 'a', 'a']).repeated, [{ value: 'a', count: 2 }, { value: 'b', count: 2 }]);
});

test('the no-lesson reader gives the notes of the entries that have one', (t) => {
  const dir = root(t, []);
  put(dir, NO_LESSON_FILE, JSON.stringify({ entries: [{ [NO_LESSON_KEYS.note]: 'n1' }, {}, { [NO_LESSON_KEYS.note]: 'n2' }] }));
  assert.deepEqual(VALUE_READERS[ENTITY.noLesson][NO_LESSON_KEYS.note](dir), ['n1', 'n2']);
});

test('summarize returns the proposal sorted, whatever the order the values came in', () => {
  assert.deepEqual(summarize(['b', 'b', 'a', 'a', 'c', 'c']).proposal, ['a', 'b', 'c']);
});

test('the real registry: every text field it declares has a reader, and the result lists exactly those fields', () => {
  const declared = readFields(RAIZ).fields.filter((f) => f[KEYS.values] === TEXT).map(fieldId);
  assert.ok(declared.length > 0);
  assert.deepEqual(freeValues(RAIZ).fields.map((f) => f.field), declared);
});

test('humanFreeValues names the indicator, how many fields have a proposal, and each proposal', () => {
  const lines = humanFreeValues('id-x', { count: 1, fields: [{ field: 'a.b', proposal: ['p'] }, { field: 'c.d', proposal: null }] });
  assert.deepEqual(lines, ['id-x: 1 of 2 text fields with a proposal of enum', '  a.b: ["p"]']);
});
