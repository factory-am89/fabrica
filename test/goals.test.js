// goals.json: the real registry is read against the real INDICATORS, standards, CLAUDE.md and wiring (`npm test` collects this file), and each
// fault code has a bad case that turns exactly it red. The debt `audit` lists and the record of its passes are in test/goals-debt.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INDICATORS } from '../scripts/audit.mjs';
import { loadPrinciples } from '../scripts/lib/decision.mjs';
import { OTHER } from '../scripts/lib/entities.mjs';
import {
  BASE_REASONS, CHECK, GOAL_FAULTS, HOLE, HOLE_REASONS, KEY, LIST, readAllQuestions,
} from '../scripts/lib/goals.mjs';
import {
  RAIZ, at, baseRow, clone, faultsOf, firstGoal, firstInvariant, goalRow, mutated, pairs, real,
} from './apoyo/goals-casos.mjs';
import { TRIGGERS, triggerOf } from '../scripts/lib/triggers.mjs';

test('the real registry has no fault, against the real INDICATORS, standards, CLAUDE.md and wiring', () => {
  assert.deepEqual(faultsOf(real()), []);
});

test('the real registry: every goal has an existing indicator (none is a hole today), every question has a row, every principle exists', () => {
  const r = real();
  const known = Object.values(INDICATORS);
  for (const g of r[LIST.goals]) {
    assert.ok(g[KEY.indicators].length > 0 && !g[KEY.indicators].includes(HOLE), g[KEY.id]);
    for (const i of g[KEY.indicators]) assert.ok(known.includes(i), `${g[KEY.id]}: ${i}`);
    for (const p of g[KEY.principles]) assert.ok(loadPrinciples(RAIZ).includes(p), `${g[KEY.id]}: principle ${p}`);
  }
  assert.deepEqual(r[LIST.questions].map((x) => x[KEY.id]).sort(), [...readAllQuestions(RAIZ).keys()].sort());
  assert.deepEqual(r[LIST.invariants].map((i) => i[KEY.id]), ['I1', 'I2', 'I3', 'I4', 'I5']);
  assert.deepEqual(r[LIST.goals].map((g) => g[KEY.id]), ['O1', 'O2', 'O3', 'O4']);
});

test('every reader of the real registry exists and resolves to one of the triggers', () => {
  for (const g of real()[LIST.goals]) {
    assert.ok(g[KEY.readers].length > 0, g[KEY.id]);
    for (const reader of g[KEY.readers]) assert.ok(TRIGGERS.includes(triggerOf(reader, RAIZ)), `${g[KEY.id]}: ${reader}`);
  }
});

test('the registry holds no trigger and no «no concluyente»: they are computed, so a key for them is an unknown key', () => {
  assert.deepEqual(pairs(mutated((r) => { r[LIST.goals][0].trigger = TRIGGERS[0]; })), [[GOAL_FAULTS.GOAL_UNKNOWN_KEY, at(LIST.goals, firstGoal())]]);
  assert.deepEqual(pairs(mutated((r) => { r[LIST.goals][0].conclusive = false; })), [[GOAL_FAULTS.GOAL_UNKNOWN_KEY, at(LIST.goals, firstGoal())]]);
  assert.deepEqual(pairs(mutated((r) => { r[LIST.invariants][0].chunk = 22; })), [[GOAL_FAULTS.GOAL_UNKNOWN_KEY, at(LIST.invariants, firstInvariant())]]);
  assert.deepEqual(pairs(mutated((r) => { r[LIST.questions][0].trigger = TRIGGERS[0]; })), [[GOAL_FAULTS.GOAL_UNKNOWN_KEY, at(LIST.questions, real()[LIST.questions][0][KEY.id])]]);
  assert.deepEqual(pairs(mutated((r) => { r.chunks = []; })), [[GOAL_FAULTS.GOAL_UNKNOWN_KEY, '-']]);
});

test('a file or a record of the wrong shape is GOAL_BAD_FILE, one per list that is missing or empty', () => {
  const lists = Object.values(LIST);
  assert.deepEqual(pairs({}), lists.map((l) => [GOAL_FAULTS.GOAL_BAD_FILE, l]));
  for (const notAnObject of [null, 'x', 5]) assert.deepEqual(pairs(notAnObject), [[GOAL_FAULTS.GOAL_BAD_FILE, '-']], String(notAnObject));
  assert.deepEqual(pairs([]), [[GOAL_FAULTS.GOAL_BAD_FILE, '-']]);
  assert.deepEqual(pairs(mutated((r) => { r[LIST.goals] = []; })), [[GOAL_FAULTS.GOAL_BAD_FILE, LIST.goals]]);
  assert.deepEqual(pairs(mutated((r) => { r[LIST.invariants].push(null); })), [[GOAL_FAULTS.GOAL_BAD_FILE, at(LIST.invariants, '?')]]);
  assert.deepEqual(pairs(mutated((r) => { r[LIST.questions].push([]); })), [[GOAL_FAULTS.GOAL_BAD_FILE, at(LIST.questions, '?')]]);
});

test('missing keys, repeated ids and wrong types are caught in each list, and they stop the reference checks', () => {
  const g = firstGoal();
  const i = firstInvariant();
  const row = goalRow()[KEY.id];
  const missing = (list, id) => [GOAL_FAULTS.GOAL_MISSING_KEY, at(list, id)];
  assert.deepEqual(pairs(mutated((r) => { delete r[LIST.goals][0][KEY.name]; })), [missing(LIST.goals, g)]);
  assert.deepEqual(pairs(mutated((r) => { delete r[LIST.invariants][0][KEY.text]; })), [missing(LIST.invariants, i)]);
  assert.deepEqual(pairs(mutated((r) => { delete r[LIST.questions].find((x) => x[KEY.id] === row)[KEY.id]; })), [[GOAL_FAULTS.GOAL_MISSING_KEY, at(LIST.questions, '?')]]);
  for (const list of Object.values(LIST)) {
    assert.deepEqual(pairs(mutated((r) => { r[list].push(clone(r[list][0])); })), [[GOAL_FAULTS.GOAL_DUPLICATE_ID, at(list, real()[list][0][KEY.id])]], list);
  }
  const bad = (list, key, value) => pairs(mutated((r) => { r[list][0][key] = value; }));
  const wrong = (list, key, value) => assert.deepEqual(bad(list, key, value), [[GOAL_FAULTS.GOAL_BAD_VALUE, at(list, real()[list][0][KEY.id])]], `${list}.${key}`);
  wrong(LIST.goals, KEY.name, 5);
  wrong(LIST.goals, KEY.name, '  ');
  wrong(LIST.goals, KEY.invariants, 'I1');
  wrong(LIST.goals, KEY.principles, ['4']);
  wrong(LIST.goals, KEY.readers, 'C8');
  wrong(LIST.goals, KEY.readers, null);
  wrong(LIST.goals, KEY.indicators, []);
  wrong(LIST.goals, KEY.indicators, 'base-holes');
  wrong(LIST.invariants, KEY.text, '');
  wrong(LIST.invariants, KEY.goals, 'O1');
  wrong(LIST.invariants, KEY.principles, [1.5]);
  wrong(LIST.invariants, KEY.questions, 'C8');
  wrong(LIST.questions, KEY.goals, []);
  wrong(LIST.questions, KEY.goals, 'O1');
  assert.deepEqual(pairs(mutated((r) => { delete r[LIST.goals][0][KEY.name]; r[LIST.goals][1][KEY.invariants].push('I9'); })), [missing(LIST.goals, g)]);
});

test('GOAL_BAD_CHECK and GOAL_CHECK_READERS: the check is one of the three words, and «nadie» goes exactly with no readers', () => {
  const g = at(LIST.goals, firstGoal());
  assert.deepEqual(pairs(mutated((r) => { r[LIST.goals][0][KEY.check] = 'maquina'; })), [[GOAL_FAULTS.GOAL_BAD_CHECK, g]]);
  assert.deepEqual(pairs(mutated((r) => { r[LIST.goals][0][KEY.check] = CHECK.nobody; })), [[GOAL_FAULTS.GOAL_CHECK_READERS, g]]);
  assert.deepEqual(pairs(mutated((r) => { r[LIST.goals][0][KEY.readers] = []; })), [[GOAL_FAULTS.GOAL_CHECK_READERS, g]]);
  assert.deepEqual(pairs(mutated((r) => { r[LIST.goals][0][KEY.readers] = []; r[LIST.goals][0][KEY.check] = CHECK.nobody; })), []);
  for (const word of Object.values(CHECK).filter((w) => w !== CHECK.nobody)) {
    assert.deepEqual(pairs(mutated((r) => { r[LIST.goals][0][KEY.check] = word; })), [], word);
  }
});

test('GOAL_BAD_HUECO: «hueco» stands alone, with a closed reason; the valve «otro» needs a note and only it takes one', () => {
  const g = at(LIST.goals, firstGoal());
  const hole = (props) => mutated((r) => { Object.assign(r[LIST.goals][0], { [KEY.indicators]: [HOLE] }, props); });
  assert.deepEqual(pairs(hole({ [KEY.holeReason]: HOLE_REASONS[0] })), []);
  assert.deepEqual(pairs(hole({ [KEY.holeReason]: OTHER, [KEY.holeNote]: 'porque sí' })), []);
  assert.deepEqual(pairs(hole({})), [[GOAL_FAULTS.GOAL_BAD_HUECO, g]]);
  assert.deepEqual(pairs(hole({ [KEY.indicators]: [HOLE, 'base-holes'], [KEY.holeReason]: HOLE_REASONS[0] })), [[GOAL_FAULTS.GOAL_BAD_HUECO, g]]);
  assert.deepEqual(pairs(hole({ [KEY.holeReason]: 'porque-si' })), [[GOAL_FAULTS.GOAL_BAD_HUECO, g]]);
  assert.deepEqual(pairs(hole({ [KEY.holeReason]: OTHER })), [[GOAL_FAULTS.GOAL_BAD_HUECO, g]]);
  assert.deepEqual(pairs(hole({ [KEY.holeReason]: OTHER, [KEY.holeNote]: ' ' })), [[GOAL_FAULTS.GOAL_BAD_HUECO, g]]);
  assert.deepEqual(pairs(hole({ [KEY.holeReason]: HOLE_REASONS[0], [KEY.holeNote]: 'sobra' })), [[GOAL_FAULTS.GOAL_BAD_HUECO, g]]);
  assert.deepEqual(pairs(mutated((r) => { r[LIST.goals][0][KEY.indicators].push(HOLE); })), [[GOAL_FAULTS.GOAL_BAD_HUECO, g]]);
  assert.deepEqual(pairs(mutated((r) => { r[LIST.goals][0][KEY.holeReason] = HOLE_REASONS[0]; })), [[GOAL_FAULTS.GOAL_BAD_HUECO, g]]);
  assert.deepEqual(pairs(mutated((r) => { r[LIST.goals][0][KEY.holeNote] = 'sobra'; })), [[GOAL_FAULTS.GOAL_BAD_HUECO, g]]);
});

test('GOAL_BAD_BASE: a question row has exactly one of goals or base; base is a closed reason, «otro» needs a note and only it takes one', () => {
  const id = baseRow()[KEY.id];
  const row = (props) => mutated((r) => { r[LIST.questions].find((x) => x[KEY.id] === id)[KEY.goals] = undefined; Object.assign(r[LIST.questions].find((x) => x[KEY.id] === id), props); });
  const w = [[GOAL_FAULTS.GOAL_BAD_BASE, at(LIST.questions, id)]];
  assert.deepEqual(pairs(row({ [KEY.base]: OTHER, [KEY.baseNote]: 'razón' })), []);
  assert.deepEqual(pairs(row({ [KEY.base]: BASE_REASONS[0] })), []);
  assert.deepEqual(pairs(row({ [KEY.base]: 'porque-si' })), w);
  assert.deepEqual(pairs(row({ [KEY.base]: OTHER })), w);
  assert.deepEqual(pairs(row({ [KEY.base]: OTHER, [KEY.baseNote]: ' ' })), w);
  assert.deepEqual(pairs(row({ [KEY.base]: BASE_REASONS[0], [KEY.baseNote]: 'sobra' })), w);
  assert.deepEqual(pairs(row({ [KEY.base]: undefined })), w);
  assert.deepEqual(pairs(row({ [KEY.goals]: [firstGoal()] })), w);
  const both = goalRow()[KEY.id];
  assert.deepEqual(pairs(mutated((r) => { r[LIST.questions].find((x) => x[KEY.id] === both)[KEY.base] = BASE_REASONS[0]; })), [[GOAL_FAULTS.GOAL_BAD_BASE, at(LIST.questions, both)]]);
});
