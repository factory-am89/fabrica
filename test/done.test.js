// `npm run done`: the step runner, the real entry point and the spawn options it uses.
// Exit codes are read from the contract file (scripts/lib/exit-codes.json), never typed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from '../scripts/lib/exit.mjs';
import { CONTRACT_FILE } from '../scripts/contract.mjs';
import { runDone, cliDone, npmStep, DONE_LINE } from '../scripts/done.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract = () => JSON.parse(readFileSync(CONTRACT_FILE, 'utf8'));

test('done: exit 0 and fixed last line only when lint and tests both pass', () => {
  const ran = [];
  const runner = (failing) => (step) => { ran.push(step); return step === failing ? 1 : 0; };
  const ok = runDone(runner(null));
  assert.deepEqual(ran, ['lint', 'test']);
  assert.deepEqual([ok.code, ok.line], [EXIT.OK, DONE_LINE.ok]);
  ran.length = 0;
  const lint = runDone(runner('lint'));
  assert.deepEqual(ran, ['lint'], 'tests must not run after a lint failure');
  assert.deepEqual([lint.code, lint.line], [EXIT.DONE_LINT_FAILED, 'done: fail lint']);
  const tests = runDone(runner('test'));
  assert.deepEqual([tests.code, tests.line], [EXIT.DONE_TESTS_FAILED, 'done: fail test']);
  assert.equal(DONE_LINE.ok, 'done: ok');
});

test('done: npmStep runs the real step name, and a missing status or a launch error is a failure', () => {
  const calls = [];
  const launcher = (result) => (cmd, args) => { calls.push([cmd, ...args]); return result; };
  assert.equal(npmStep('lint', launcher({ status: 0 })), 0);
  assert.equal(npmStep('test', launcher({ status: 0 })), 0);
  assert.deepEqual(calls, [['npm', 'run', 'lint'], ['npm', 'run', 'test']]);
  assert.equal(npmStep('test', launcher({ status: 3 })), 3);
  assert.equal(npmStep('test', launcher({ status: null, signal: 'SIGTERM' })), 1);
  assert.equal(npmStep('test', launcher({ error: new Error('ENOENT'), status: null })), 1);
  assert.equal(npmStep('test', launcher({ error: new Error('ENOENT'), status: 0 })), 1);
  // both real steps wired the way the CLI does it
  calls.length = 0;
  assert.equal(runDone((s) => npmStep(s, launcher({ status: 0 }))).code, EXIT.OK);
  assert.deepEqual(calls.map((x) => x[2]), ['lint', 'test']);
});

test('done: cliDone prints the fixed last line with the right exit code (fake runner)', () => {
  const failing = (step) => (s) => (s === step ? 1 : 0);
  const ok = cliDone(failing(null));
  assert.deepEqual([ok.code, ok.stdout, ok.stderr], [EXIT.OK, 'done: ok\n', '']);
  const lint = cliDone(failing('lint'));
  assert.deepEqual([lint.code, lint.stdout], [EXIT.DONE_LINT_FAILED, 'done: fail lint\n']);
  const tests = cliDone(failing('test'));
  assert.deepEqual([tests.code, tests.stdout], [EXIT.DONE_TESTS_FAILED, 'done: fail test\n']);
});

test('package.json: the done entry runs exactly scripts/done.mjs', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.done, 'node scripts/done.mjs');
});

// A throwaway project whose lint and test scripts pass or fail on demand; `marker` proves that
// the test script ran.
function fakeProject({ lint, test: testExit }) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'done-')));
  const marker = path.join(dir, 'test-ran');
  const scripts = {
    lint: `node -e "process.exit(${lint})"`,
    test: `node -e "require('fs').writeFileSync('test-ran','x');process.exit(${testExit})"`,
  };
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fake', version: '1.0.0', scripts }));
  return { dir, marker };
}

const runDoneProcess = (dir) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'done.mjs')], { cwd: dir, encoding: 'utf8' });
  const lines = r.stdout.trimEnd().split('\n');
  return { status: r.status, last: lines[lines.length - 1], stdout: r.stdout };
};

test('done as a real process: lint and tests pass -> contract OK and last line "done: ok"', () => {
  const { dir, marker } = fakeProject({ lint: 0, test: 0 });
  const r = runDoneProcess(dir);
  assert.equal(r.status, contract().EXIT.OK, r.stdout);
  assert.equal(r.last, 'done: ok');
  assert.ok(existsSync(marker), 'tests must run after lint passes');
});

test('done as a real process: lint fails -> contract DONE_LINT_FAILED, last line "done: fail lint", tests not run', () => {
  const { dir, marker } = fakeProject({ lint: 1, test: 0 });
  const r = runDoneProcess(dir);
  assert.equal(r.status, contract().EXIT.DONE_LINT_FAILED, r.stdout);
  assert.equal(r.last, 'done: fail lint');
  assert.ok(!existsSync(marker), 'tests must not run after a lint failure');
});

test('done as a real process: tests fail -> contract DONE_TESTS_FAILED, last line "done: fail test"', () => {
  const { dir } = fakeProject({ lint: 0, test: 1 });
  const r = runDoneProcess(dir);
  assert.equal(r.status, contract().EXIT.DONE_TESTS_FAILED, r.stdout);
  assert.equal(r.last, 'done: fail test');
});

test('npmStep: spawn options use a shell only on Windows and never inherit stdin', () => {
  const seen = [];
  const launch = (cmd, args, opts) => { seen.push({ cmd, args, opts }); return { status: 0 }; };
  npmStep('lint', launch, 'win32');
  npmStep('lint', launch, 'linux');
  npmStep('lint', launch, 'darwin');
  assert.equal(seen[0].opts.shell, true, 'Windows needs a shell to start npm.cmd');
  assert.equal(seen[1].opts.shell, false);
  assert.equal(seen[2].opts.shell, false);
  for (const { cmd, args, opts } of seen) {
    assert.equal(cmd, 'npm');
    assert.deepEqual(args, ['run', 'lint']);
    assert.deepEqual(opts.stdio, ['ignore', 'inherit', 'inherit']);
  }
});
