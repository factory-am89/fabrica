// Plan form check: every fault code has at least one mutation of the green fixture that must raise it.
// Deterministic: literal fixture text, temp folder only, no clock, network, git or real repo data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAN_FIELDS, PLAN_FAULTS, parsePlan, planFaults, checkPlan } from '../scripts/lib/plan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOOD_PATH = path.join(HERE, 'fixtures', 'plans', 'good.md');
const CLI = path.join(HERE, '..', 'scripts', 'check-plan.mjs');
const GOOD = readFileSync(GOOD_PATH, 'utf8');

// Replace the first occurrence of `from`; throws if absent so a stale mutation cannot pass silently.
const swap = (from, to) => (text) => {
  assert.ok(text.includes(from), `mutation anchor not found: ${from}`);
  return text.replace(from, to);
};
const drop = (line) => swap(line, '');
const cut = (startMark, endMark) => (text) => {
  const a = text.indexOf(startMark);
  const b = text.indexOf(endMark);
  assert.ok(a >= 0 && b > a, 'cut anchors not found');
  return text.slice(0, a) + text.slice(b);
};
const compose = (...fns) => (text) => fns.reduce((t, f) => f(t), text);

const EXTRA_DECISIONS = ['B', 'C', 'D'].map((id) => `### ${id}. Another question?\n1. One (recommended)\n2. Two\n3. Three\n\n`).join('');
const CLOSED = { closedPaths: ['apps/'] };
const TOUCH_APPS = swap('Files: `src/parser.js`, `test/parser.test.js`', 'Files: `apps/web/x.js`');
const FIELD_LINES = {
  files: 'Files: `src/parser.js`, `test/parser.test.js`\n',
  dependsOn: 'Depends on: none\n',
  blockedBy: 'Blocked by: none\n',
  existing: 'Existing: `git grep -n parser -- src` -> (no output)\n',
  notDone: 'Not done: Nothing outside the parser is changed.\n',
  done: 'Done:\n```sh\nnode --test test/parser.test.js\n```\n',
};

// One entry per fault code (checked below against PLAN_FAULTS): [name, mutate, options].
const MUTATIONS = {
  EMPTY_PLAN: [['empty string', () => ''], ['null', () => null], ['only whitespace', () => '  \n\n']],
  MISSING_TITLE: [['no title line', drop('# Plan: Example plan used as the green fixture\n')]],
  MISSING_VERDICT: [['no verdict line', drop('Verdict: Two small chunks, the second builds on the first; one decision is open.\n')]],
  MISSING_CHUNKS_SECTION: [['chunks heading renamed', swap('## Chunks', '## Pieces')]],
  MISSING_NOT_VERIFIED: [['not verified heading renamed', swap('## Not verified', '## Other')]],
  NO_CHUNKS: [['heading with zero chunks', cut('### 1.', '## Decisions')]],
  BAD_CHUNK_HEADER: [['header without number', swap('### 2. Wire', '### Two: Wire')]],
  NUMBERING: [['chunk 2 renumbered 3', swap('### 2. Wire', '### 3. Wire')]],
  MISSING_FIELD: [
    ...Object.entries(PLAN_FIELDS).map(([key, label]) => [`field ${label} removed`, drop(FIELD_LINES[key])]),
    ['Files without any path', swap('Files: `src/parser.js`, `test/parser.test.js`', 'Files: none')],
  ],
  EMPTY_NOT_DONE: [['Not done empty', swap('Not done: Nothing outside the parser is changed.', 'Not done:')]],
  DONE_NOT_BLOCK: [
    ['no code block', swap('Done:\n```sh\nnode --test test/parser.test.js\n```', 'Done: run the tests')],
    ['unclosed block', swap('node --test test/command.test.js\n```', 'node --test test/command.test.js')],
    ['empty block', swap('```sh\nnode --test test/parser.test.js\n```', '```sh\n```')],
  ],
  DONE_PLACEHOLDER: [['unfilled marker', swap('node --test test/parser.test.js\n```', '<command(s)>\n```')]],
  UNKNOWN_DEPENDENCY: [
    ['chunk 9 does not exist', swap('Depends on: 1', 'Depends on: 9')],
    ['free text', swap('Depends on: 1', 'Depends on: soon')],
  ],
  DEPENDENCY_CYCLE: [['1 -> 2 -> 1', swap('Depends on: none', 'Depends on: 2')]],
  UNKNOWN_DECISION: [['Blocked by Z', swap('Blocked by: none', 'Blocked by: Z')]],
  BAD_DECISION_HEADER: [['header without letter', swap('### A. Should', '### Should')]],
  DECISION_OPTIONS: [
    ['two options', drop('3. Accept tabs with a warning\n')],
    ['four options', swap('3. Accept tabs with a warning\n', '3. Accept tabs with a warning\n4. Another\n')],
  ],
  DECISION_NO_RECOMMENDED: [['first option not recommended', swap(' (recommended)', '')]],
  TOO_MANY_DECISIONS: [['four decisions', swap('## Doubts', `${EXTRA_DECISIONS}## Doubts`)]],
  SHARED_FILE: [['same file, no dependency', compose(swap('Files: `src/command.js`', 'Files: `src/parser.js`'), swap('Depends on: 1', 'Depends on: none'))]],
  CLOSED_WITHOUT_DECISION: [['touches apps/ without Blocked by', TOUCH_APPS, CLOSED]],
};

test('every fault code has a mutation row and every row names a real code', () => {
  assert.deepEqual(Object.keys(MUTATIONS).sort(), Object.keys(PLAN_FAULTS).sort());
});

test('the green fixture has no faults', () => {
  assert.deepEqual(planFaults(GOOD, { gateFiles: [], closedPaths: [] }), []);
  assert.deepEqual(planFaults(GOOD), []);
});

for (const [code, rows] of Object.entries(MUTATIONS)) {
  for (const [name, mutate, options] of rows) {
    test(`${code}: ${name}`, () => {
      const faults = planFaults(mutate(GOOD), options);
      assert.ok(faults.some((f) => f.code === PLAN_FAULTS[code]), `expected ${code}, got ${JSON.stringify(faults)}`);
      for (const f of faults) {
        assert.ok(f.code in PLAN_FAULTS, `unknown code ${f.code}`);
        assert.equal(typeof f.where, 'string');
        assert.equal(typeof f.message, 'string');
      }
    });
  }
}

test('a #25 PR reference in Depends on is valid', () => {
  assert.deepEqual(planFaults(swap('Depends on: none', 'Depends on: #25')(GOOD)), []);
  assert.deepEqual(parsePlan(swap('Depends on: none', 'Depends on: #25, 2')(GOOD)).chunks[0].dependsOn, ['#25', 2]);
});

test('two chunks sharing a file: fault without a dependency path, green with one', () => {
  const sameFile = swap('Files: `src/command.js`', 'Files: `src/parser.js`');
  assert.deepEqual(planFaults(sameFile(GOOD)), []);
  const faults = planFaults(compose(sameFile, swap('Depends on: 1', 'Depends on: none'))(GOOD));
  assert.deepEqual(faults.map((f) => f.code), [PLAN_FAULTS.SHARED_FILE]);
});

test('a transitive dependency path also makes a shared file legal', () => {
  const three = swap('## Decisions for Pablo', '### 3. Third\nFiles: `src/parser.js`\nDepends on: 2\nBlocked by: none\nExisting: `x` -> y\nNot done: z\nDone:\n```sh\ntrue\n```\n\n## Decisions for Pablo');
  assert.deepEqual(planFaults(three(GOOD)), []);
});

test('a chunk touching closedPaths needs Blocked by a real decision; then it is green and needsPablo', () => {
  const lacking = checkPlan(TOUCH_APPS(GOOD), CLOSED);
  assert.deepEqual(lacking.faults.map((f) => f.code), [PLAN_FAULTS.CLOSED_WITHOUT_DECISION]);
  const blocked = checkPlan(compose(TOUCH_APPS, swap('Blocked by: none', 'Blocked by: A'))(GOOD), CLOSED);
  assert.deepEqual(blocked.faults, []);
  assert.deepEqual(blocked.chunks[0].needsPablo, ['apps/web/x.js']);
  assert.deepEqual(blocked.chunks[1].needsPablo, []);
});

test('gate is derived from gateFiles: exact paths and prefixes ending in /', () => {
  assert.deepEqual(checkPlan(GOOD, { gateFiles: ['src/command.js'] }).chunks.map((c) => c.gate), [false, true]);
  assert.deepEqual(checkPlan(GOOD, { gateFiles: ['src/'] }).chunks.map((c) => c.gate), [true, true]);
  assert.deepEqual(checkPlan(GOOD, { gateFiles: ['src'] }).chunks.map((c) => c.gate), [false, false]);
});

test('lists that are not arrays throw instead of passing', () => {
  assert.throws(() => planFaults(GOOD, { closedPaths: 'apps/' }), TypeError);
  assert.throws(() => planFaults(GOOD, { closedPaths: null }), TypeError);
  assert.throws(() => planFaults(GOOD, { gateFiles: 'src/' }), TypeError);
});

test('field lines inside a Done code block are not read as fields', () => {
  const plan = swap('node --test test/parser.test.js', 'echo "x"\nFiles: `fake.js`\n### 7. not a chunk')(GOOD);
  assert.deepEqual(planFaults(plan), []);
  assert.deepEqual(parsePlan(plan).chunks[0].files, ['src/parser.js', 'test/parser.test.js']);
});

test('parsePlan returns the documented shape', () => {
  const p = parsePlan(GOOD);
  assert.equal(p.title, 'Example plan used as the green fixture');
  assert.equal(p.chunks.length, 2);
  assert.deepEqual(p.chunks[1].dependsOn, [1]);
  assert.deepEqual(p.chunks[0].dependsOn, []);
  assert.equal(p.chunks[0].done.closed, true);
  assert.equal(p.decisions[0].id, 'A');
  assert.equal(p.decisions[0].options.length, 3);
  assert.match(p.notVerified, /10 MB/);
});

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}
const tmp = mkdtempSync(path.join(tmpdir(), 'check-plan-'));
const write = (name, content) => {
  const p = path.join(tmp, name);
  writeFileSync(p, content);
  return p;
};

test('CLI: missing file exits 1', () => {
  const r = run(['--file', path.join(tmp, 'nope.md')]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cannot read/);
});

test('CLI: no --file exits 1', () => {
  assert.equal(run([]).status, 1);
});

test('CLI: good plan exits 0 and prints check-plan: ok', () => {
  const r = run(['--file', GOOD_PATH]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^check-plan: ok\n/);
});

test('CLI: bad plan exits 1 with faults on stderr', () => {
  const r = run(['--file', write('bad.md', swap('Not done: Nothing outside the parser is changed.', 'Not done:')(GOOD))]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /EMPTY_NOT_DONE/);
  assert.equal(r.stdout, '');
});

test('CLI: --json on a bad plan gives one parseable object with ok:false and exit 1', () => {
  const r = run(['--file', write('bad2.md', ''), '--json']);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.faults[0].code, PLAN_FAULTS.EMPTY_PLAN);
  assert.deepEqual(out.chunks, []);
});

test('CLI: --json on the good plan gives ok:true; list files feed gate and needsPablo', () => {
  const closed = write('closed.txt', 'src/\n');
  const gate = write('gate.txt', 'src/command.js\n');
  const out = JSON.parse(run(['--file', GOOD_PATH, '--json', '--gate-files', gate]).stdout);
  assert.equal(out.ok, true);
  assert.deepEqual(out.chunks.map((c) => c.gate), [false, true]);
  const r = run(['--file', GOOD_PATH, '--json', '--closed-paths', closed]);
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).faults.every((f) => f.code === PLAN_FAULTS.CLOSED_WITHOUT_DECISION), true);
});
