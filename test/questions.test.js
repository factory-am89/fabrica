// readQuestions: the single reader of the questions of a standard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readQuestions, FIELDS } from '../scripts/lib/questions.mjs';

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
  assert.ok(qs.length >= 13);
  assert.deepEqual(qs.map((q) => ({ id: q.id, checkedBy: q.checkedBy })), expected);
  // Fixed ids that must stay machine-checked (lint, tests, function size, workflows).
  for (const id of ['C1', 'C2', 'C3', 'C4']) assert.equal(qs.find((q) => q.id === id).checkedBy, 'máquina', id);
  assert.equal(qs.find((q) => q.id === 'C5').checkedBy, 'revisor');
});
