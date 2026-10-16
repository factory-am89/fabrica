// standards/plan.md: the standard of the product «plan», and the role that links it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { readQuestions, CHECKED_BY, FIELDS, ID_PARTS } from '../scripts/lib/questions.mjs';
import { PLAN_FIELDS } from '../scripts/lib/plan.mjs';

const read = (f) => readFileSync(f, 'utf8');
const md = () => read('standards/plan.md');
const section = (text, name) => text.split(/^## /m).find((s) => s.startsWith(`${name}\n`));

// Who checks each question, written once as a table (ids are derived from its positions, not typed twice).
const { machine: M, reviewer: R } = CHECKED_BY;
const EXPECTED = [M, R, R, R, R, R, M, R, M];

test('plan.md has prefix P, ids 1..n in a row and the expected checkedBy per question', () => {
  const qs = readQuestions(md());
  assert.deepEqual(qs.map((q) => q.prefix), qs.map(() => 'P'));
  assert.deepEqual(qs.map((q) => q.n), EXPECTED.map((_, i) => i + 1));
  assert.deepEqual(qs.map((q) => q.checkedBy), EXPECTED);
  for (const q of qs) assert.ok(q.good && q.bad, `${q.id} needs Bien and Mal`);
});

test('every machine question names a script that exists', () => {
  const lines = md().split('\n').filter((l) => l.startsWith(`${FIELDS.checkedBy.label}: ${M}`));
  assert.equal(lines.length, EXPECTED.filter((c) => c === M).length);
  for (const l of lines) {
    const scripts = [...l.matchAll(/node (scripts\/[\w./-]+\.mjs)/g)].map((m) => m[1]);
    assert.ok(scripts.length > 0, `no command in: ${l}`);
    for (const s of scripts) assert.ok(existsSync(s), `${s} does not exist`);
  }
});

test('the fields listed in Shape are the ones of PLAN_FIELDS', () => {
  const listed = [...section(md(), 'Shape').matchAll(/^- `([^`:]+):`/gm)].map((m) => m[1]);
  assert.deepEqual(listed, Object.values(PLAN_FIELDS));
});

test('arquitecto.md links the plan standard and no longer carries its own list', () => {
  const role = read('.claude/agents/arquitecto.md');
  assert.match(role, /standards\/plan\.md/);
  assert.match(role, /scripts\/check-plan\.mjs/);
  assert.doesNotMatch(role, /Estándar del plan/);
});

test('no other standard or role uses the prefix P (one prefix, one standard)', () => {
  const files = [
    ...readdirSync('standards').filter((f) => f.endsWith('.md')).map((f) => `standards/${f}`),
    ...readdirSync('.claude/agents').filter((f) => f.endsWith('.md')).map((f) => `.claude/agents/${f}`),
  ].filter((f) => f !== 'standards/plan.md');
  assert.ok(files.length >= 4);
  for (const f of files) assert.doesNotMatch(read(f), new RegExp(`^### P${ID_PARTS.number} — `, 'm'), `${f} uses the plan prefix`);
});
