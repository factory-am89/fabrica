// Shared by the tests of the computed triggers: a repo where everything is wired, built in a temp folder and removed in t.after.
// C1 and P1 are machine questions, C2 and P2 reviewer ones, and C16 (the bridge to the questions of plan.md) is in code.md.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { CHECKED_BY } from '../../scripts/lib/questions.mjs';
import { SIGNAL_MACHINE, STANDARDS } from '../../scripts/lib/lessons.mjs';
import { PLAN_BRIDGE_QUESTION, triggerFaults } from '../../scripts/lib/triggers.mjs';
import {
  CORPUS_WORKFLOW, JUDGE_EVENT, JUDGE_WORKFLOW, NODE_TEST_SCRIPT, NPM_TEST, PR_EVENT, STANDARD_VARIABLE, TESTS_WORKFLOW, WORKFLOWS_DIR,
} from '../../scripts/lib/wiring.mjs';

export const [CODE, PLAN] = STANDARDS;
export const workflow = (events, runs = [], env = {}) => yaml.dump({ on: events, jobs: { j: { steps: [{ uses: 'some/action' }, ...runs.map((run) => ({ run })), { env, run: 'true' }] } } });
export const question = (id, who) => `### ${id} — a question\nQuién: ${who}\n\n`;
export const lesson = (mechanism, signal = SIGNAL_MACHINE) => JSON.stringify({ signal, mechanism });
const wired = () => ({
  'package.json': JSON.stringify({ scripts: { test: NODE_TEST_SCRIPT, hora: 'x', hitl: 'x', nightly: 'x', 'nightly-all': 'x' } }),
  [`${WORKFLOWS_DIR}/${TESTS_WORKFLOW}`]: workflow({ [PR_EVENT]: null, push: null }, [`npm ci\n${NPM_TEST}`]),
  [`${WORKFLOWS_DIR}/${JUDGE_WORKFLOW}`]: workflow({ [JUDGE_EVENT]: null }, [], { [STANDARD_VARIABLE]: `.fabrica/${CODE}` }),
  [`${WORKFLOWS_DIR}/${CORPUS_WORKFLOW}`]: 'on: workflow_dispatch\n', // a string for `on:` and no jobs at all
  [CODE]: question('C1', CHECKED_BY.machine) + question('C2', CHECKED_BY.reviewer) + question(PLAN_BRIDGE_QUESTION, CHECKED_BY.reviewer),
  [PLAN]: question('P1', CHECKED_BY.machine) + question('P2', CHECKED_BY.reviewer),
});
export function repo(t, changes = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'fabrica-triggers-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries({ ...wired(), ...changes })) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}
export const tests = (t, events, runs, extra = {}) => repo(t, { [`${WORKFLOWS_DIR}/${TESTS_WORKFLOW}`]: workflow(events, runs), ...extra });
export const codes = (root) => triggerFaults(root).map((f) => f.code).sort();
export const at = (root, code) => triggerFaults(root).filter((f) => f.code === code).map((f) => f.where);
