// standards/plan.md: the standard of the product «plan», and the role that links it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { readQuestions, CHECKED_BY, FIELDS, ID_PARTS } from '../scripts/lib/questions.mjs';
import { PLAN_FIELDS } from '../scripts/lib/plan.mjs';
import { KEY, LIST, readGoals } from '../scripts/lib/goals.mjs';

const read = (f) => readFileSync(f, 'utf8');
const md = () => read('standards/plan.md');
const section = (text, name) => text.split(/^## /m).find((s) => s.startsWith(`${name}\n`));

// Who checks each question, written once as a table (ids are derived from its positions, not typed twice).
const { machine: M, reviewer: R } = CHECKED_BY;
const EXPECTED = [M, R, R, R, R, R, M, R, M, R, R, R];

// The reviewer questions of chunk 11 (P10 to P12): the goal of the row each has in goals.json, and the invariants that list it.
// They have no automatic judge yet, so they are in no goal's `readers` (a reviewer question of plan.md does not resolve to a trigger).
const CHUNK_11 = { P10: { goal: 'O1', invariants: ['I1', 'I2'] }, P11: { goal: 'O2', invariants: ['I4'] }, P12: { goal: 'O3', invariants: ['I3'] } };
const FILE_IN_BACKTICKS = /`((?:[\w.-]+\/)*[\w.-]+\.(?:mjs|json|md|js))`/g;

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

const block = (id) => md().split(/^### /m).find((b) => b.startsWith(`${id} — `));
const NAMES = { P10: ['entities.json', 'fields.json'], P11: ['scripts/lib/decision.mjs'], P12: ['scripts/lib/triggers.mjs'] };

test('P10 to P12 each have a row in goals.json for their goal, and only their invariants list them', () => {
  const registry = readGoals('.');
  for (const [id, { goal, invariants }] of Object.entries(CHUNK_11)) {
    const rows = registry[LIST.questions].filter((r) => r[KEY.id] === id);
    assert.equal(rows.length, 1, `${id} needs exactly one row`);
    assert.deepEqual(rows[0][KEY.goals], [goal], id);
    const listing = registry[LIST.invariants].filter((i) => i[KEY.questions].includes(id)).map((i) => i[KEY.id]);
    assert.deepEqual(listing, invariants, id);
    for (const g of registry[LIST.goals]) assert.ok(!g[KEY.readers].includes(id), `${id} has no judge yet, so it is no reader of ${g[KEY.id]}`);
  }
});

test('P10 to P12 name the files they depend on and every file they name exists', () => {
  for (const [id, names] of Object.entries(NAMES)) {
    const text = block(id);
    assert.ok(text, `${id} is missing`);
    for (const n of names) assert.ok(text.includes(`\`${n}\``), `${id} must name ${n}`);
    for (const [, file] of text.matchAll(FILE_IN_BACKTICKS)) assert.ok(existsSync(file), `${id} names ${file}, which does not exist`);
  }
});

test('«Where it comes from» has one row per question', () => {
  const rows = [...section(md(), 'Where it comes from').matchAll(/^\| (P\d+) \|/gm)].map((m) => m[1]);
  assert.deepEqual(rows, readQuestions(md()).map((q) => q.id));
});

test('no other standard or role uses the prefix P (one prefix, one standard)', () => {
  const files = [
    ...readdirSync('standards').filter((f) => f.endsWith('.md')).map((f) => `standards/${f}`),
    ...readdirSync('.claude/agents').filter((f) => f.endsWith('.md')).map((f) => `.claude/agents/${f}`),
  ].filter((f) => f !== 'standards/plan.md');
  assert.ok(files.length >= 4);
  for (const f of files) assert.doesNotMatch(read(f), new RegExp(`^### P${ID_PARTS.number} — `, 'm'), `${f} uses the plan prefix`);
});
