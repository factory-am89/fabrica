// Reads (never edits) the wiring that makes a reader fire: the `test` script of package.json and what the workflows
// do. Everything it needs is parsed from `root`; a file that is missing or not valid YAML/JSON throws.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export const WORKFLOWS_DIR = '.github/workflows';
export const TESTS_WORKFLOW = 'tests.yml';
export const JUDGE_WORKFLOW = 'revisor.yml';
export const CORPUS_WORKFLOW = 'golden.yml';
export const NODE_TEST_SCRIPT = 'node --test';
export const NPM_TEST = 'npm test';
export const PR_EVENT = 'pull_request';
export const JUDGE_EVENT = 'pull_request_target';
export const SCHEDULE_EVENT = 'schedule';
export const STANDARD_VARIABLE = 'STANDARD';

const readWorkflow = (root, name) => {
  const doc = yaml.load(readFileSync(path.join(root, WORKFLOWS_DIR, name), 'utf8'));
  if (doc === null || typeof doc !== 'object' || doc.on === undefined || doc.on === null) throw new Error(`${WORKFLOWS_DIR}/${name} has no \`on:\``);
  return doc;
};
// `on:` is a name, a list of names or a map of name -> options; the answer is always a map.
const eventsOf = (doc) => {
  if (typeof doc.on === 'string') return { [doc.on]: null };
  if (Array.isArray(doc.on)) return Object.fromEntries(doc.on.map((n) => [n, null]));
  return doc.on;
};
const stepsOf = (doc) => Object.values(doc.jobs ?? {}).flatMap((job) => job.steps ?? []);
const runLines = (doc) => stepsOf(doc).flatMap((s) => (typeof s.run === 'string' ? s.run.split('\n').map((l) => l.trim()) : []));

// {testScript, scripts, testsEvents, runsNpmTest, judgeEvents, judgeStandards, scheduledLines, corpusPaths}
export function readWiring(root) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const tests = readWorkflow(root, TESTS_WORKFLOW);
  const judge = readWorkflow(root, JUDGE_WORKFLOW);
  const corpus = readWorkflow(root, CORPUS_WORKFLOW);
  const names = readdirSync(path.join(root, WORKFLOWS_DIR)).filter((f) => /\.ya?ml$/.test(f)).sort();
  const scheduled = names.map((n) => readWorkflow(root, n)).filter((d) => SCHEDULE_EVENT in eventsOf(d));
  return {
    testScript: pkg.scripts?.test,
    scripts: Object.keys(pkg.scripts ?? {}),
    testsEvents: Object.keys(eventsOf(tests)),
    runsNpmTest: runLines(tests).includes(NPM_TEST),
    judgeEvents: Object.keys(eventsOf(judge)),
    judgeStandards: stepsOf(judge).map((s) => s.env?.[STANDARD_VARIABLE]).filter((v) => typeof v === 'string'),
    scheduledLines: scheduled.flatMap(runLines),
    corpusPaths: eventsOf(corpus).push?.paths ?? [],
  };
}
