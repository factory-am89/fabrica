// What fires each reader (a test, a question, a command), computed from the repo and never stored: a stored
// trigger would be a copy of the wiring (principle 4). `triggerOf` answers one reader; `triggerFaults` checks the wiring.
// It only reads the workflows (scripts/lib/wiring.mjs); nothing here edits them.
// What it does not see: an `if:` that skips a step for some PRs (C13 stays the judge of that).
// A reviewer question of plan.md is judged only through C16 (the bridge in code.md): without it that question is a fault.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PASOS } from '../al-arrancar.mjs';
import { MACHINE_KINDS, SIGNAL_MACHINE, STANDARDS, mechanismKind, readLessons } from './lessons.mjs';
import { CHECKED_BY, ID_SOURCE, readQuestions } from './questions.mjs';
import { collectedByNodeTest } from './node-test.mjs';
import { JUDGE_EVENT, JUDGE_WORKFLOW, NODE_TEST_SCRIPT, PR_EVENT, STANDARD_VARIABLE, TEST_CONCURRENCY_FLAG, TESTS_WORKFLOW, isNodeTestScript, readWiring } from './wiring.mjs';

export const TRIGGER = Object.freeze({ CI_TEST: 'ci-test', CI_JUDGE: 'ci-judge', CORPUS: 'corpus', MANUAL: 'manual', ARRANQUE: 'arranque', CRON: 'cron' });
export const TRIGGERS = Object.freeze(Object.values(TRIGGER));

export const TRIGGER_FAULTS = Object.freeze(
  Object.fromEntries([
    'TRIGGER_READER_UNFIRED', // a question that no workflow answers
    'TRIGGER_TEST_UNCOLLECTED', // a test that `node --test` does not collect
    'TRIGGER_LESSON_UNFIRED', // the mechanism of a lesson that nothing fires
    'TRIGGER_NO_NODE_TEST', // package.json `test` is not `node --test` (bare or with its concurrency cap)
    'TRIGGER_NO_NPM_TEST', // tests.yml does not run `npm test`
    'TRIGGER_WORKFLOW_SILENT', // tests.yml or revisor.yml no longer fires on a PR, or the judge no longer reads code.md
    'TRIGGER_PLAN_NO_BRIDGE', // a reviewer question of plan.md while code.md has no C16: no judge reaches it
  ].map((c) => [c, c])),
);

const [CODE_STANDARD] = STANDARDS;
export const PLAN_BRIDGE_QUESTION = 'C16'; // the judge's way into the questions of plan.md (code.md, chunk 12)
const QUESTION_ID = new RegExp(`^${ID_SOURCE}$`);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function readContext(root, pasos) {
  const questions = new Map();
  for (const standard of STANDARDS) {
    for (const q of readQuestions(readFileSync(path.join(root, standard), 'utf8'))) questions.set(q.id, { ...q, standard });
  }
  const w = readWiring(root);
  const testsWired = isNodeTestScript(w.testScript) && w.runsNpmTest && w.testsEvents.includes(PR_EVENT);
  const judgeWired = w.judgeEvents.includes(JUDGE_EVENT) && w.judgeStandards.some((s) => s.endsWith(CODE_STANDARD));
  return { questions, w, pasos, testsWired, judgeWired };
}

function ofQuestion(id, ctx) {
  const q = ctx.questions.get(id);
  if (q === undefined) throw new Error(`unknown question ${id}: it is in none of ${STANDARDS.join(', ')}`);
  if (q.checkedBy === CHECKED_BY.machine) return ctx.testsWired ? TRIGGER.CI_TEST : null;
  const reachable = q.standard === CODE_STANDARD || ctx.questions.has(PLAN_BRIDGE_QUESTION);
  return reachable && ctx.judgeWired ? TRIGGER.CI_JUDGE : null;
}

function ofCommand(name, ctx) {
  if (ctx.pasos.some((p) => p.nombre === name)) return TRIGGER.ARRANQUE;
  const runs = new RegExp(`(^|\\s)npm run ${escapeRe(name)}(\\s|$)`);
  return ctx.w.scheduledLines.some((l) => runs.test(l)) ? TRIGGER.CRON : TRIGGER.MANUAL;
}

function ofPath(file, ctx) {
  if (collectedByNodeTest(file) && ctx.testsWired) return TRIGGER.CI_TEST;
  return ctx.w.corpusPaths.some((glob) => path.posix.matchesGlob(file, glob)) ? TRIGGER.CORPUS : null;
}

function resolve(reader, ctx) {
  if (QUESTION_ID.test(reader)) return ofQuestion(reader, ctx);
  if (ctx.w.scripts.includes(reader)) return ofCommand(reader, ctx);
  if (reader.includes('/')) return ofPath(reader, ctx);
  throw new Error(`unknown reader ${JSON.stringify(reader)}: it is not a question id, a package.json script or a path`);
}

// One of TRIGGERS, or null when nothing fires the reader. `reader`: a question id (C5), a package.json script (hora) or a
// path with "/" (test/x.test.js). An unknown reader throws. `pasos`: the startup steps, those of al-arrancar.mjs by default.
export const triggerOf = (reader, root, { pasos = PASOS } = {}) => resolve(reader, readContext(root, pasos));

const fault = (code, where, message) => ({ code, where, message });

function lessonFaults(root, ctx) {
  const out = [];
  for (const { file, text } of readLessons(root)) {
    const lesson = JSON.parse(text);
    if (lesson.signal !== SIGNAL_MACHINE) continue;
    const mechanism = lesson.mechanism;
    if (!MACHINE_KINDS.includes(mechanismKind(mechanism))) throw new Error(`lessons/${file}: a machine lesson needs a mechanism of a machine kind`);
    if (mechanismKind(mechanism) === 'test' && !collectedByNodeTest(mechanism)) out.push(fault(TRIGGER_FAULTS.TRIGGER_TEST_UNCOLLECTED, mechanism, `lessons/${file}: node --test does not run this test`));
    else if (resolve(mechanism, ctx) === null) out.push(fault(TRIGGER_FAULTS.TRIGGER_LESSON_UNFIRED, mechanism, `lessons/${file}: nothing fires this mechanism`));
  }
  return out;
}

// Every fault of the wiring of `root`: [{code, where, message}], empty when every reader fires. The readers it walks are the
// questions of standards/code.md, the machine questions of standards/plan.md and the mechanism of every machine lesson.
export function triggerFaults(root) {
  const ctx = readContext(root, PASOS);
  const { w } = ctx;
  const out = [];
  if (!isNodeTestScript(w.testScript)) out.push(fault(TRIGGER_FAULTS.TRIGGER_NO_NODE_TEST, 'package.json', `the test script is ${JSON.stringify(w.testScript)}, not ${JSON.stringify(NODE_TEST_SCRIPT)} (bare or with ${TEST_CONCURRENCY_FLAG}=<n>)`));
  if (!w.runsNpmTest) out.push(fault(TRIGGER_FAULTS.TRIGGER_NO_NPM_TEST, TESTS_WORKFLOW, 'no step runs `npm test`'));
  if (!w.testsEvents.includes(PR_EVENT)) out.push(fault(TRIGGER_FAULTS.TRIGGER_WORKFLOW_SILENT, TESTS_WORKFLOW, `does not fire on ${PR_EVENT}`));
  if (!w.judgeEvents.includes(JUDGE_EVENT)) out.push(fault(TRIGGER_FAULTS.TRIGGER_WORKFLOW_SILENT, JUDGE_WORKFLOW, `does not fire on ${JUDGE_EVENT}`));
  if (!w.judgeStandards.some((s) => s.endsWith(CODE_STANDARD))) out.push(fault(TRIGGER_FAULTS.TRIGGER_WORKFLOW_SILENT, JUDGE_WORKFLOW, `no step sets ${STANDARD_VARIABLE} to ${CODE_STANDARD}`));
  for (const q of ctx.questions.values()) {
    const walked = q.standard === CODE_STANDARD || q.checkedBy === CHECKED_BY.machine;
    if (walked && ofQuestion(q.id, ctx) === null) out.push(fault(TRIGGER_FAULTS.TRIGGER_READER_UNFIRED, q.id, `nothing fires ${q.id} (${q.checkedBy}, ${q.standard})`));
    const unbridged = q.standard !== CODE_STANDARD && q.checkedBy === CHECKED_BY.reviewer && !ctx.questions.has(PLAN_BRIDGE_QUESTION);
    if (unbridged) out.push(fault(TRIGGER_FAULTS.TRIGGER_PLAN_NO_BRIDGE, q.id, `${q.id} is a reviewer question of ${q.standard} and ${CODE_STANDARD} has no ${PLAN_BRIDGE_QUESTION}`));
  }
  return [...out, ...lessonFaults(root, ctx)];
}
