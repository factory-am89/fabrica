// readQuestions: the single reader of the questions of a standard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readQuestions, FIELDS, CHECKED_BY } from '../scripts/lib/questions.mjs';
import { KEY, LIST, readAllQuestions, readGoals } from '../scripts/lib/goals.mjs';
import { STANDARDS } from '../scripts/lib/lessons.mjs';
import { PLAN_BRIDGE_QUESTION } from '../scripts/lib/triggers.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

const block = (head, who = 'Quién: revisor.') => `### ${head}\n${who}\nBien: a\nMal: b\n\n`;

test('a standard with prefix P is parsed into id, prefix, n, text and checkedBy (good)', () => {
  const md = `# Plans\n\n${block('P1 — Is it small?', 'Quién: máquina (`npm test`).')}${block('P2 — Is it clear?')}`;
  assert.deepEqual(readQuestions(md).map(({ id, prefix, n, text, checkedBy }) => ({ id, prefix, n, text, checkedBy })), [
    { id: 'P1', prefix: 'P', n: 1, text: 'Is it small?', checkedBy: 'máquina' },
    { id: 'P2', prefix: 'P', n: 2, text: 'Is it clear?', checkedBy: 'revisor' },
  ]);
});

test('FIELDS names the labels and the allowed values of Quién', () => {
  assert.deepEqual(FIELDS.checkedBy.values, ['máquina', 'revisor']);
  assert.deepEqual([FIELDS.checkedBy.label, FIELDS.good, FIELDS.bad], ['Quién', 'Bien', 'Mal']);
});

test('bad: mixed prefixes, hyphen instead of em dash, no id, missing or invalid Quién, no questions, duplicate ids', () => {
  const bad = {
    'mixed prefixes': block('C1 — a?') + block('P2 — b?'),
    'hyphen': block('C1 - a?'),
    'no id': block('Is it?'),
    'missing Quién': '### C1 — a?\nBien: a\nMal: b\n',
    'invalid Quién': block('C1 — a?', 'Quién: nadie'),
    'no questions': '# Title\n\nJust text.\n',
    'empty': '',
    'duplicate ids': block('C1 — a?') + block('C1 — b?'),
  };
  for (const [name, md] of Object.entries(bad)) assert.throws(() => readQuestions(md), Error, name);
});

test('the real standards/code.md: C1..Cn in order, checkedBy follows its own Quién lines', () => {
  const md = readFileSync(new URL('../standards/code.md', import.meta.url), 'utf8');
  const qs = readQuestions(md);
  // Expected from the file itself: the Quién line of each "### C<n>" block, read with a different method.
  const lines = md.split('\n');
  const expected = [];
  lines.forEach((l, i) => {
    const m = l.match(/^### (C\d+) /);
    if (m) expected.push({ id: m[1], checkedBy: lines[i + 1].match(/^Quién: (máquina|revisor)/)[1] });
  });
  assert.deepEqual(qs.map((q) => ({ id: q.id, checkedBy: q.checkedBy })), expected);
  // The count is not typed here: it is the number of questions of code.md that the other readers (goals.json rows, audit) see too.
  const [CODE] = STANDARDS;
  assert.equal(qs.length, [...readAllQuestions(ROOT).values()].filter((q) => q.standard === CODE).length);
  assert.deepEqual(qs.map((q) => q.id), qs.map((_, i) => `${qs[0].prefix}${i + 1}`), 'no gap and no renumbering');
  // Fixed ids that must stay machine-checked (lint, tests, function size, workflows).
  for (const id of ['C1', 'C2', 'C3', 'C4']) assert.equal(qs.find((q) => q.id === id).checkedBy, 'máquina', id);
  assert.equal(qs.find((q) => q.id === 'C5').checkedBy, 'revisor');
});

// Chunk 12: C14 (I2), C15 (I4), C16 (I3, the bridge to the reviewer questions of plan.md) and C17 (I3). All judged by the reviewer, none by a machine.
const CHUNK_12 = { C14: /fields\.json/, C15: /Decisions/, [PLAN_BRIDGE_QUESTION]: /plan\.md/, C17: /caso malo/ };

test('C14 to C17 are in code.md, judged by the reviewer, with Bien and Mal, and each names what it asks about', () => {
  const qs = readQuestions(readFileSync(new URL('../standards/code.md', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(CHUNK_12).sort(), ['C14', 'C15', 'C16', 'C17']);
  for (const [id, mention] of Object.entries(CHUNK_12)) {
    const q = qs.find((x) => x.id === id);
    assert.ok(q, `${id} is missing`);
    assert.equal(q.checkedBy, CHECKED_BY.reviewer, id);
    assert.ok(q.good && q.bad, `${id} needs Bien and Mal`);
    assert.match(q.text + q.good + q.bad, mention, id);
  }
});

test('goals.json: C14 to C17 each have a row, and C16 is a reader of the goal of every reviewer question of plan.md', () => {
  const registry = readGoals(ROOT);
  const rows = new Map(registry[LIST.questions].map((r) => [r[KEY.id], r]));
  const listed = new Set(registry[LIST.invariants].flatMap((i) => i[KEY.questions]));
  for (const id of Object.keys(CHUNK_12)) {
    assert.ok(rows.has(id), `${id} has no row in goals.json`);
    assert.ok(listed.has(id), `${id} is in no invariant of goals.json`);
  }
  const [, PLAN] = STANDARDS;
  const planReviewer = [...readAllQuestions(ROOT).values()].filter((q) => q.standard === PLAN && q.checkedBy === CHECKED_BY.reviewer);
  assert.ok(planReviewer.length > 0);
  for (const q of planReviewer) {
    for (const goal of rows.get(q.id)[KEY.goals]) {
      const readers = registry[LIST.goals].find((g) => g[KEY.id] === goal)[KEY.readers];
      assert.ok(readers.includes(PLAN_BRIDGE_QUESTION), `${q.id}: goal ${goal} does not list ${PLAN_BRIDGE_QUESTION} as a reader`);
    }
  }
  assert.deepEqual(rows.get(PLAN_BRIDGE_QUESTION)[KEY.goals], registry[LIST.goals].map((g) => g[KEY.id]), 'the bridge serves every goal');
});

test('constructor.md does not copy the count of the questions of plan.md (it goes stale when a question is added)', () => {
  assert.doesNotMatch(readFileSync(new URL('../.claude/agents/constructor.md', import.meta.url), 'utf8'), /\bP\d+ (to|a) P\d+\b/);
});

test('C16 says «no aplica» without a plan, and C17 without a new check (the way C1..C13 mark what does not apply)', () => {
  const md = readFileSync(new URL('../standards/code.md', import.meta.url), 'utf8');
  for (const id of [PLAN_BRIDGE_QUESTION, 'C17']) {
    const block = md.split(/^### /m).find((b) => b.startsWith(`${id} — `));
    assert.match(block, /no aplica/, id);
  }
});
