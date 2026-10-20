// goals.json against the repo: every name points at something that exists, goal and invariant name each other, the rows match the questions of the
// standards, and every reader exists and resolves to a trigger. Each case turns exactly one fault code red. The shape of the file is in test/goals.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadPrinciples } from '../scripts/lib/decision.mjs';
import { OTHER } from '../scripts/lib/entities.mjs';
import { BASE_REASONS, CHECK, GOALS_FILE, GOAL_FAULTS, HOLE_REASONS, KEY, LIST, readGoals } from '../scripts/lib/goals.mjs';
import { CHECKED_BY } from '../scripts/lib/questions.mjs';
import {
  RAIZ, at, baseRow, firstGoal, firstInvariant, goalRow, mutated, pairs, real,
} from './apoyo/goals-casos.mjs';

test('references: an indicator, an invariant, a goal, a question row or a principle that does not exist is a fault with the name of the record', () => {
  const g = at(LIST.goals, firstGoal());
  const i = at(LIST.invariants, firstInvariant());
  const ref = (where) => [GOAL_FAULTS.GOAL_UNKNOWN_REF, where];
  assert.deepEqual(pairs(mutated((r) => { r[LIST.goals][0][KEY.indicators] = ['nope']; })), [[GOAL_FAULTS.GOAL_UNKNOWN_INDICATOR, g]]);
  assert.deepEqual(pairs(mutated((r) => { r[LIST.goals][0][KEY.invariants].push('I9'); })), [ref(g)]);
  assert.deepEqual(pairs(mutated((r) => { r[LIST.invariants][0][KEY.goals].push('O9'); })), [ref(i)]);
  assert.deepEqual(pairs(mutated((r) => { r[LIST.invariants][0][KEY.questions].push('C99'); })), [ref(i)]);
  assert.deepEqual(pairs(mutated((r) => { r[LIST.questions].find((x) => x[KEY.goals] !== undefined)[KEY.goals].push('O9'); })), [ref(at(LIST.questions, goalRow()[KEY.id]))]);
  assert.deepEqual(pairs(mutated((r) => { r[LIST.goals][0][KEY.principles].push(loadPrinciples(RAIZ).length + 1); })), [[GOAL_FAULTS.GOAL_UNKNOWN_PRINCIPLE, g]]);
  assert.deepEqual(pairs(mutated((r) => { r[LIST.invariants][0][KEY.principles].push(0); })), [[GOAL_FAULTS.GOAL_UNKNOWN_PRINCIPLE, i]]);
});

test('GOAL_MIRROR and GOAL_INVARIANT_LOOSE: goal and invariant name each other, and an invariant serves a goal and sits in a principle or a question', () => {
  const g = real()[LIST.goals][0];
  const i = real()[LIST.invariants].find((x) => x[KEY.id] === g[KEY.invariants][0]);
  const withI = (change) => mutated((r) => change(r[LIST.invariants].find((x) => x[KEY.id] === i[KEY.id])));
  assert.deepEqual(pairs(mutated((r) => { r[LIST.goals][0][KEY.invariants].shift(); })), [[GOAL_FAULTS.GOAL_MIRROR, at(LIST.invariants, i[KEY.id])]]);
  assert.deepEqual(pairs(withI((x) => { x[KEY.goals] = x[KEY.goals].filter((o) => o !== g[KEY.id]); })), [[GOAL_FAULTS.GOAL_MIRROR, at(LIST.goals, g[KEY.id])]]);
  const loose = [GOAL_FAULTS.GOAL_INVARIANT_LOOSE, at(LIST.invariants, i[KEY.id])];
  assert.deepEqual(pairs(withI((x) => { x[KEY.principles] = []; x[KEY.questions] = []; })), [loose]);
  assert.ok(i[KEY.principles].length > 0 && i[KEY.questions].length > 0, 'the invariant of the test has both');
  assert.deepEqual(pairs(withI((x) => { x[KEY.principles] = []; })), []);
  assert.deepEqual(pairs(withI((x) => { x[KEY.questions] = []; })), []);
  assert.deepEqual(pairs(withI((x) => { x[KEY.goals] = []; })).filter(([c]) => c === loose[0]), [loose]);
});

test('GOAL_QUESTION_NO_ROW and GOAL_ROW_NO_QUESTION: the rows and the questions of the standards match both ways', () => {
  const id = baseRow()[KEY.id];
  assert.deepEqual(pairs(mutated((r) => { r[LIST.questions] = r[LIST.questions].filter((x) => x[KEY.id] !== id); })), [[GOAL_FAULTS.GOAL_QUESTION_NO_ROW, id]]);
  assert.deepEqual(pairs(mutated((r) => { r[LIST.questions].push({ [KEY.id]: 'C999', [KEY.goals]: [firstGoal()] }); })), [[GOAL_FAULTS.GOAL_ROW_NO_QUESTION, 'C999']]);
});

test('readers: one that does not exist is GOAL_READER_MISSING, one that exists but nothing fires is GOAL_READER_UNFIRED, one fired by hand is fine', () => {
  const g = at(LIST.goals, firstGoal());
  const readers = (...add) => pairs(mutated((r) => { r[LIST.goals][0][KEY.readers].push(...add); }));
  assert.deepEqual(readers('test/no-existe.test.js'), [[GOAL_FAULTS.GOAL_READER_MISSING, g]]);
  assert.deepEqual(readers('C999'), [[GOAL_FAULTS.GOAL_READER_MISSING, g]]);
  assert.deepEqual(readers('no-es-un-comando'), [[GOAL_FAULTS.GOAL_READER_MISSING, g]]);
  assert.deepEqual(readers('scripts/lib/goals.mjs'), [[GOAL_FAULTS.GOAL_READER_UNFIRED, g]]);
  assert.deepEqual(readers('audit'), []);
  assert.deepEqual(readers('C1', 'test/goals.test.js'), []);
});

test('readGoals throws when the file is missing or is not JSON, and the vocabularies keep the valve', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fabrica-goals-'));
  try {
    assert.throws(() => readGoals(root), new RegExp(`${GOALS_FILE} not found`));
    writeFileSync(path.join(root, GOALS_FILE), '{ no');
    assert.throws(() => readGoals(root), new RegExp(`${GOALS_FILE} in .* is not readable JSON`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.ok(HOLE_REASONS.includes(OTHER) && BASE_REASONS.includes(OTHER));
  assert.equal(CHECK.machine, CHECKED_BY.machine);
});
