// The cases shared by test/goals.test.js and test/goals-refs.test.js: the real goals.json, copies of it changed on purpose, and its faults.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDICATORS } from '../../scripts/audit.mjs';
import { KEY, LIST, goalFaults, readGoals } from '../../scripts/lib/goals.mjs';

export const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const real = () => readGoals(RAIZ);
export const clone = (x) => JSON.parse(JSON.stringify(x));
export const faultsOf = (registry) => goalFaults(registry, RAIZ, { indicators: Object.values(INDICATORS) });
export const pairs = (registry) => faultsOf(registry).map((f) => [f.code, f.where]);
export const at = (list, id) => `${list}:${id}`;
// A copy of the real registry changed by `change`.
export const mutated = (change) => { const r = clone(real()); change(r); return r; };
export const firstGoal = () => real()[LIST.goals][0][KEY.id];
export const firstInvariant = () => real()[LIST.invariants][0][KEY.id];
// A question row that is a base reason (so no invariant names it) and one that serves a goal.
export const baseRow = () => real()[LIST.questions].find((r) => r[KEY.base] !== undefined);
export const goalRow = () => real()[LIST.questions].find((r) => r[KEY.goals] !== undefined);
