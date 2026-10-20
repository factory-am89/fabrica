// Computed triggers (scripts/lib/triggers.mjs): the closed list, one case per answer of triggerOf, one bad case per code of
// TRIGGER_FAULTS, and the real repo with no fault. Roots are temp folders built here and removed in t.after; the vocabulary is
// imported. Not covered: the workflows are read, never run (an `if:` that skips a step is C13's), and the real `node --test`
// is test/node-test.test.js. The "reviewer question of plan.md without C16" fault belongs to chunk 12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { CHECKED_BY } from '../scripts/lib/questions.mjs';
import { LESSONS_DIR, SIGNAL_MACHINE, SIGNAL_NONE, STANDARDS } from '../scripts/lib/lessons.mjs';
import { PLAN_BRIDGE_QUESTION, TRIGGER, TRIGGERS, TRIGGER_FAULTS, triggerFaults, triggerOf } from '../scripts/lib/triggers.mjs';
import {
  CORPUS_WORKFLOW, JUDGE_EVENT, JUDGE_WORKFLOW, NODE_TEST_SCRIPT, NPM_TEST, PR_EVENT, SCHEDULE_EVENT, STANDARD_VARIABLE, TESTS_WORKFLOW, WORKFLOWS_DIR,
} from '../scripts/lib/wiring.mjs';

const REPO = path.join(import.meta.dirname, '..');
const [CODE, PLAN] = STANDARDS;
const workflow = (events, runs = [], env = {}) => yaml.dump({ on: events, jobs: { j: { steps: [{ uses: 'some/action' }, ...runs.map((run) => ({ run })), { env, run: 'true' }] } } });
const question = (id, who) => `### ${id} — a question\nQuién: ${who}\n\n`;
const lesson = (mechanism, signal = SIGNAL_MACHINE) => JSON.stringify({ signal, mechanism });
// A repo where everything is wired: C1 and P1 are machine questions, C2 and P2 reviewer ones.
const wired = () => ({
  'package.json': JSON.stringify({ scripts: { test: NODE_TEST_SCRIPT, hora: 'x', hitl: 'x', nightly: 'x', 'nightly-all': 'x' } }),
  [`${WORKFLOWS_DIR}/${TESTS_WORKFLOW}`]: workflow({ [PR_EVENT]: null, push: null }, [`npm ci\n${NPM_TEST}`]),
  [`${WORKFLOWS_DIR}/${JUDGE_WORKFLOW}`]: workflow({ [JUDGE_EVENT]: null }, [], { [STANDARD_VARIABLE]: `.fabrica/${CODE}` }),
  [`${WORKFLOWS_DIR}/${CORPUS_WORKFLOW}`]: 'on: workflow_dispatch\n', // a string for `on:` and no jobs at all
  [CODE]: question('C1', CHECKED_BY.machine) + question('C2', CHECKED_BY.reviewer),
  [PLAN]: question('P1', CHECKED_BY.machine) + question('P2', CHECKED_BY.reviewer),
});
function repo(t, changes = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'fabrica-triggers-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries({ ...wired(), ...changes })) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}
const tests = (t, events, runs, extra = {}) => repo(t, { [`${WORKFLOWS_DIR}/${TESTS_WORKFLOW}`]: workflow(events, runs), ...extra });
const codes = (root) => triggerFaults(root).map((f) => f.code).sort();
const at = (root, code) => triggerFaults(root).filter((f) => f.code === code).map((f) => f.where);

test('TRIGGERS is the closed list, and every fault code carries the TRIGGER_ prefix', () => {
  assert.deepEqual([...TRIGGERS], ['ci-test', 'ci-judge', 'corpus', 'manual', 'arranque', 'cron']);
  assert.equal(Object.isFrozen(TRIGGERS), true);
  assert.deepEqual(Object.keys(TRIGGER_FAULTS).sort(), ['TRIGGER_LESSON_UNFIRED', 'TRIGGER_NO_NODE_TEST', 'TRIGGER_NO_NPM_TEST', 'TRIGGER_READER_UNFIRED', 'TRIGGER_TEST_UNCOLLECTED', 'TRIGGER_WORKFLOW_SILENT']);
  for (const [key, code] of Object.entries(TRIGGER_FAULTS)) assert.ok(key === code && code.startsWith('TRIGGER_'), key);
});

test('a wired repo has no fault, and each question resolves to the trigger of who checks it', (t) => {
  const root = repo(t);
  assert.deepEqual(triggerFaults(root), []);
  assert.equal(triggerOf('C1', root), TRIGGER.CI_TEST);
  assert.equal(triggerOf('P1', root), TRIGGER.CI_TEST);
  assert.equal(triggerOf('C2', root), TRIGGER.CI_JUDGE);
  assert.equal(triggerOf('P2', root), null, 'a reviewer question of plan.md is not judged without C16');
});

test('C16 in code.md is the way into the reviewer questions of plan.md', (t) => {
  const root = repo(t, { [CODE]: question('C2', CHECKED_BY.reviewer) + question(PLAN_BRIDGE_QUESTION, CHECKED_BY.reviewer) });
  assert.equal(triggerOf('P2', root), TRIGGER.CI_JUDGE);
  assert.equal(triggerOf('P1', root), TRIGGER.CI_TEST);
});

test('a path is ci-test when node --test collects it, and null when it does not', (t) => {
  const root = repo(t);
  assert.equal(triggerOf('test/a.test.js', root), TRIGGER.CI_TEST);
  assert.equal(triggerOf('test/b.ps1', root), null);
  assert.equal(triggerOf('scripts/check.mjs', root), null);
  assert.equal(triggerOf('test/.hidden.test.js', root), null);
});

test('the workflow may say `on:` as a list, and a trailing space after npm test is still npm test', (t) => {
  assert.equal(triggerOf('C1', tests(t, [PR_EVENT], [NPM_TEST + ' '])), TRIGGER.CI_TEST);
  assert.equal(triggerOf('C2', repo(t, { [`${WORKFLOWS_DIR}/${JUDGE_WORKFLOW}`]: workflow([JUDGE_EVENT], [], { [STANDARD_VARIABLE]: CODE }) })), TRIGGER.CI_JUDGE);
});

test('a workflow without `on:` throws', (t) => {
  const root = repo(t, { [`${WORKFLOWS_DIR}/${TESTS_WORKFLOW}`]: yaml.dump({ jobs: {} }) });
  assert.throws(() => triggerFaults(root), new RegExp(`${TESTS_WORKFLOW} has no .on:`));
  assert.throws(() => triggerFaults(repo(t, { [`${WORKFLOWS_DIR}/${TESTS_WORKFLOW}`]: 'on:\n' })), /has no .on:/);
  assert.throws(() => triggerFaults(repo(t, { [`${WORKFLOWS_DIR}/${TESTS_WORKFLOW}`]: '' })), /has no .on:/, 'an empty file');
});

test('the other files of the workflows folder do not matter, and a scheduled workflow may have no steps or no jobs', (t) => {
  const schedule = { [SCHEDULE_EVENT]: [{ cron: '0 5 * * 1' }] };
  const root = repo(t, {
    [`${WORKFLOWS_DIR}/README.md`]: 'not a workflow\n',
    [`${WORKFLOWS_DIR}/llama.yml`]: yaml.dump({ on: schedule, jobs: { j: { uses: 'some/repo/.github/workflows/x.yml@main' } } }),
    [`${WORKFLOWS_DIR}/vacio.yml`]: yaml.dump({ on: schedule }),
  });
  assert.deepEqual(triggerFaults(root), []);
  assert.equal(triggerOf('hitl', root), TRIGGER.MANUAL);
});

test('a collected test is not ci-test if the wiring is broken (script, npm test step, PR event)', (t) => {
  const broken = [
    repo(t, { 'package.json': JSON.stringify({ scripts: { test: 'echo' } }) }),
    tests(t, { [PR_EVENT]: null }, ['npm ci']),
    tests(t, { push: null }, [NPM_TEST]),
  ];
  for (const root of broken) assert.equal(triggerOf('test/a.test.js', root), null);
});

test('a command is arranque when a startup step has its name, cron when a scheduled workflow runs it, else manual', (t) => {
  const scheduled = (...lines) => repo(t, { [`${WORKFLOWS_DIR}/semanal.yml`]: workflow({ [SCHEDULE_EVENT]: [{ cron: '0 5 * * 1' }] }, lines) });
  const root = scheduled('npm ci', `echo hi && npm run nightly`);
  assert.equal(triggerOf('hora', root), TRIGGER.ARRANQUE, 'the real PASOS has a step called hora');
  assert.equal(triggerOf('hitl', root), TRIGGER.MANUAL);
  assert.equal(triggerOf('nightly', root), TRIGGER.CRON);
  assert.equal(triggerOf('nightly-all', root), TRIGGER.MANUAL, 'a longer name is another command');
  assert.equal(triggerOf('nightly', scheduled('xnpm run nightly')), TRIGGER.MANUAL);
  assert.equal(triggerOf('nightly', scheduled('npm run nightly-all')), TRIGGER.MANUAL);
  assert.equal(triggerOf('nightly', scheduled('npm run nightly')), TRIGGER.CRON, 'the line may be the whole command');
  assert.equal(triggerOf('nightly', repo(t, { [`${WORKFLOWS_DIR}/manual.yml`]: workflow({ workflow_dispatch: null }, ['npm run nightly']) })), TRIGGER.MANUAL);
  const yamlName = repo(t, { [`${WORKFLOWS_DIR}/semanal.yaml`]: workflow({ [SCHEDULE_EVENT]: [{ cron: '0 5 * * 1' }] }, ['npm run nightly']) });
  assert.equal(triggerOf('nightly', yamlName), TRIGGER.CRON, 'a .yaml workflow counts too');
  const dotted = repo(t, { 'package.json': JSON.stringify({ scripts: { test: NODE_TEST_SCRIPT, 'a.b': 'x' } }), [`${WORKFLOWS_DIR}/semanal.yml`]: workflow({ [SCHEDULE_EVENT]: [{ cron: '0 5 * * 1' }] }, ['npm run aXb']) });
  assert.equal(triggerOf('a.b', dotted), TRIGGER.MANUAL, 'the dot of a name is a dot, not any character');
  assert.equal(triggerOf('nightly', root, { pasos: [{ nombre: 'nightly' }] }), TRIGGER.ARRANQUE, 'a startup step wins over cron');
  assert.equal(triggerOf('nightly', root, { pasos: [] }), TRIGGER.CRON);
});

test('a path is corpus when golden.yml watches it on push, but a collected test stays ci-test', (t) => {
  const root = repo(t, { [`${WORKFLOWS_DIR}/${CORPUS_WORKFLOW}`]: workflow({ push: { paths: ['standards/**', 'test/**'] } }) });
  assert.equal(triggerOf(CODE, root), TRIGGER.CORPUS);
  assert.equal(triggerOf('docs/a.md', root), null);
  assert.equal(triggerOf('test/a.test.js', root), TRIGGER.CI_TEST);
  assert.equal(triggerOf('test/data.json', root), TRIGGER.CORPUS);
});

test('an unknown reader throws instead of answering "no trigger"', (t) => {
  const root = repo(t);
  for (const odd of ['xC1', 'C1x', 'c1', 'C']) assert.throws(() => triggerOf(odd, root), /unknown reader/, odd);
  assert.throws(() => triggerOf('nightly', repo(t, { 'package.json': '{}' })), /unknown reader/, 'a package.json without scripts has no commands');
  assert.throws(() => triggerOf('C99', root), /unknown question C99/);
  assert.throws(() => triggerOf('whatever', root), /unknown reader "whatever"/);
});

test('TRIGGER_NO_NODE_TEST: the test script is not node --test (and the machine questions lose their trigger with it)', (t) => {
  const root = repo(t, { 'package.json': JSON.stringify({ scripts: { test: 'echo' } }) });
  assert.deepEqual(codes(root), [TRIGGER_FAULTS.TRIGGER_NO_NODE_TEST, TRIGGER_FAULTS.TRIGGER_READER_UNFIRED, TRIGGER_FAULTS.TRIGGER_READER_UNFIRED].sort());
  assert.deepEqual(at(root, TRIGGER_FAULTS.TRIGGER_READER_UNFIRED).sort(), ['C1', 'P1'], 'only the machine questions, not C2 or P2');
  assert.deepEqual(at(root, TRIGGER_FAULTS.TRIGGER_NO_NODE_TEST), ['package.json']);
  assert.deepEqual(codes(repo(t, { 'package.json': JSON.stringify({ scripts: {} }) })).slice(0, 1), [TRIGGER_FAULTS.TRIGGER_NO_NODE_TEST]);
});

test('TRIGGER_NO_NPM_TEST: no step runs npm test (a line that only mentions it does not count)', (t) => {
  for (const runs of [['npm ci'], [`echo ${NPM_TEST}`], []]) {
    const root = tests(t, { [PR_EVENT]: null }, runs);
    assert.deepEqual(at(root, TRIGGER_FAULTS.TRIGGER_NO_NPM_TEST), [TESTS_WORKFLOW]);
    assert.equal(triggerFaults(root).some((f) => f.code === TRIGGER_FAULTS.TRIGGER_READER_UNFIRED), true);
  }
});

test('TRIGGER_WORKFLOW_SILENT: tests.yml or revisor.yml stops firing on a PR, or the judge stops reading code.md', (t) => {
  const SILENT = TRIGGER_FAULTS.TRIGGER_WORKFLOW_SILENT;
  const noPr = tests(t, { push: null }, [NPM_TEST]);
  assert.deepEqual(at(noPr, SILENT), [TESTS_WORKFLOW]);
  const judge = (events, env) => repo(t, { [`${WORKFLOWS_DIR}/${JUDGE_WORKFLOW}`]: workflow(events, [], env) });
  const noEvent = judge({ [PR_EVENT]: null }, { [STANDARD_VARIABLE]: `.fabrica/${CODE}` });
  assert.deepEqual(at(noEvent, SILENT), [JUDGE_WORKFLOW]);
  const otherStandard = judge({ [JUDGE_EVENT]: null }, { [STANDARD_VARIABLE]: `.fabrica/${PLAN}` });
  assert.deepEqual(at(otherStandard, SILENT), [JUDGE_WORKFLOW]);
  assert.deepEqual(at(judge({ [JUDGE_EVENT]: null }, {}), SILENT), [JUDGE_WORKFLOW], 'no STANDARD at all');
  for (const root of [noEvent, otherStandard]) assert.deepEqual(at(root, TRIGGER_FAULTS.TRIGGER_READER_UNFIRED), ['C2'], 'the reviewer question of code.md, not the machine ones');
  assert.deepEqual(codes(noPr), [SILENT, TRIGGER_FAULTS.TRIGGER_READER_UNFIRED, TRIGGER_FAULTS.TRIGGER_READER_UNFIRED].sort());
});

test('TRIGGER_TEST_UNCOLLECTED and TRIGGER_LESSON_UNFIRED: the mechanism of a machine lesson must fire', (t) => {
  const lessons = (m) => repo(t, Object.fromEntries(Object.entries(m).map(([name, text]) => [`${LESSONS_DIR}/${name}.json`, text])));
  assert.deepEqual(triggerFaults(lessons({ ok: lesson('test/a.test.js'), none: lesson('scripts/x.mjs', SIGNAL_NONE) })), []);
  const bad = lessons({ ps: lesson('test/b.ps1'), hidden: lesson('test/.c.test.js'), script: lesson('scripts/x.mjs'), hook: lesson('.githooks/pre-commit') });
  assert.deepEqual(at(bad, TRIGGER_FAULTS.TRIGGER_TEST_UNCOLLECTED).sort(), ['test/.c.test.js', 'test/b.ps1']);
  assert.deepEqual(at(bad, TRIGGER_FAULTS.TRIGGER_LESSON_UNFIRED).sort(), ['.githooks/pre-commit', 'scripts/x.mjs']);
  assert.equal(triggerFaults(bad).length, 4);
  const unwired = repo(t, { 'package.json': JSON.stringify({ scripts: { test: 'echo' } }), [`${LESSONS_DIR}/ok.json`]: lesson('test/a.test.js') });
  assert.deepEqual(at(unwired, TRIGGER_FAULTS.TRIGGER_LESSON_UNFIRED), ['test/a.test.js'], 'collected but nothing runs node --test');
});

test('a machine lesson with no usable mechanism, or a lesson that is not JSON, throws', (t) => {
  const withLesson = (text) => repo(t, { [`${LESSONS_DIR}/x.json`]: text });
  assert.throws(() => triggerFaults(withLesson(JSON.stringify({ signal: SIGNAL_MACHINE }))), /x\.json: a machine lesson needs a mechanism/);
  assert.throws(() => triggerFaults(withLesson(lesson('standards/code.md'))), /x\.json: a machine lesson needs a mechanism/);
  assert.throws(() => triggerFaults(withLesson('{')), SyntaxError);
});

test('the real repo: every reader fires, and the known readers resolve as expected', () => {
  assert.deepEqual(triggerFaults(REPO), []);
  assert.equal(triggerOf('test/triggers.test.js', REPO), TRIGGER.CI_TEST);
  assert.equal(triggerOf('C1', REPO), TRIGGER.CI_TEST);
  assert.equal(triggerOf('C5', REPO), TRIGGER.CI_JUDGE);
  assert.equal(triggerOf('hora', REPO), TRIGGER.ARRANQUE);
  assert.equal(triggerOf('audit', REPO), TRIGGER.MANUAL);
});
