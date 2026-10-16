// Commands an agent can orchestrate: exit code per failure class, --json output and `npm run done`.
// Existing behaviour of tarea/retirar (messages, folders, branches) is covered by carpetas.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, RETIRE_RESULT, ExitError, runCommand } from '../scripts/lib/exit.mjs';
import { prFusionado, cliRetirar } from '../scripts/retirar.mjs';
import { git as gitRaw } from '../scripts/lib/carpetas.mjs';
import { cliTarea } from '../scripts/tarea.mjs';
import { git, repo as baseRepo } from '../test-support/repo.mjs';
import { runDone, cliDone, npmStep, DONE_LINE } from '../scripts/done.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// The shared helper returns { padre, principal }; these tests read better with parent/main.
const repo = (opts) => {
  const { padre, principal } = baseRepo(opts);
  return { parent: padre, main: principal };
};

const tarea = (main, branch, extra = {}) => cliTarea([...(extra.json ? ['--json'] : []), branch], { cwd: main, instalar: false });
const retirar = (main, name, extra = {}) => cliRetirar([...(extra.json ? ['--json'] : []), name], { cwd: main, consultarPR: extra.consultarPR });
const noRepoDir = () => realpathSync(mkdtempSync(path.join(tmpdir(), 'sin-repo-')));

test('EXIT: one distinct code per failure class, frozen', () => {
  const codes = Object.values(EXIT);
  assert.equal(new Set(codes).size, codes.length, 'repeated code');
  assert.equal(EXIT.OK, 0);
  assert.ok(Object.isFrozen(EXIT));
  assert.ok(Object.isFrozen(RETIRE_RESULT));
});

test('tarea: exit code per failure class, each with a good and a bad case', () => {
  const { main } = repo();
  const good = tarea(main, 'feat/bueno');
  assert.equal(good.code, EXIT.OK, good.stderr);
  // without --json the output stays human: on stdout, nothing on stderr
  assert.match(good.stdout, /^tarea carpeta: .* rama: feat\/bueno base: main\n/);
  assert.equal(good.stderr, '');
  // INVALID_BRANCH
  assert.equal(tarea(main, 'rama-rara').code, EXIT.INVALID_BRANCH);
  assert.equal(cliTarea([], { cwd: main, instalar: false }).code, EXIT.INVALID_BRANCH);
  // FOLDER_EXISTS: the same branch twice
  assert.equal(tarea(main, 'feat/bueno').code, EXIT.FOLDER_EXISTS);
  // GIT_FAILED: not a git repository
  assert.equal(tarea(noRepoDir(), 'feat/otro').code, EXIT.GIT_FAILED);
  // INSTALL_FAILED: npm ci works with a lockfile, fails without package files
  const withLock = repo({ lockfile: true });
  const installOk = cliTarea(['feat/con-npm'], { cwd: withLock.main, instalar: true });
  assert.equal(installOk.code, EXIT.OK, installOk.stderr);
  const installBad = cliTarea(['feat/sin-npm'], { cwd: main, instalar: true });
  assert.equal(installBad.code, EXIT.INSTALL_FAILED, installBad.stderr);
});

test('retirar: exit code per failure class, each with a good and a bad case', () => {
  const { main } = repo();
  const work = (name, file) => {
    const t = JSON.parse(tarea(main, `feat/${name}`, { json: true }).stdout);
    writeFileSync(path.join(t.carpeta, file), 'x\n');
    git(t.carpeta, 'add', file);
    git(t.carpeta, 'commit', '-q', '-m', 'work');
    return t.carpeta;
  };
  // NOT_FOUND and USAGE
  assert.equal(retirar(main, 'nada').code, EXIT.NOT_FOUND);
  assert.equal(cliRetirar([], { cwd: main }).code, EXIT.USAGE);
  // UNSAVED_CHANGES
  const dirty = work('sucia', 'b.txt');
  writeFileSync(path.join(dirty, 'sin-guardar.txt'), 'x\n');
  assert.equal(retirar(main, 'sucia').code, EXIT.UNSAVED_CHANGES);
  // INSIDE_FOLDER: launched from inside the folder it would delete
  assert.equal(cliRetirar(['sucia'], { cwd: dirty }).code, EXIT.INSIDE_FOLDER);
  // NOT_MERGED (clean but unmerged), then OK once merged
  work('limpia', 'c.txt');
  assert.equal(retirar(main, 'limpia').code, EXIT.NOT_MERGED);
  git(main, 'merge', '-q', '--no-ff', '-m', 'merge', 'feat/limpia');
  const ok = retirar(main, 'limpia');
  assert.equal(ok.code, EXIT.OK, ok.stderr);
  // DETACHED_HEAD
  const loose = work('suelta', 'd.txt');
  git(loose, 'checkout', '-q', '--detach');
  assert.equal(retirar(main, 'suelta').code, EXIT.DETACHED_HEAD);
  // GIT_FAILED: not a git repository
  assert.equal(retirar(noRepoDir(), 'x').code, EXIT.GIT_FAILED);
});

test('retirar: GH_FAILED when GitHub cannot be asked, good case when it answers (no real gh)', () => {
  assert.equal(prFusionado('feat/x', 'abc', () => ({ status: 0, stdout: 'zzz\nabc\n', stderr: '' })), true);
  assert.equal(prFusionado('feat/x', 'abc', () => ({ status: 0, stdout: 'zzz\n', stderr: '' })), false);
  const bad = () => prFusionado('feat/x', 'abc', () => ({ status: 1, stdout: '', stderr: 'no auth' }));
  assert.throws(bad, (e) => e.exit === EXIT.GH_FAILED && /no auth/.test(e.message));
  // Same class through the CLI: a remote exists and the PR lookup fails.
  const { parent, main } = repo();
  const remote = path.join(parent, 'remote.git');
  git(parent, 'init', '-q', '--bare', '-b', 'main', remote);
  git(main, 'remote', 'add', 'origin', remote);
  git(main, 'push', '-q', 'origin', 'main');
  const t = JSON.parse(tarea(main, 'feat/remota', { json: true }).stdout);
  writeFileSync(path.join(t.carpeta, 'e.txt'), 'x\n');
  git(t.carpeta, 'add', 'e.txt');
  git(t.carpeta, 'commit', '-q', '-m', 'work');
  const punta = git(t.carpeta, 'rev-parse', 'HEAD');
  const failing = retirar(main, 'remota', { consultarPR: () => prFusionado('feat/remota', punta, () => ({ status: 1, stdout: '', stderr: 'down' })) });
  assert.equal(failing.code, EXIT.GH_FAILED);
  assert.equal(retirar(main, 'remota', { consultarPR: () => true }).code, EXIT.OK);
});

test('--json: stdout is exactly one JSON object, human text goes to stderr', () => {
  const { main } = repo();
  const t = tarea(main, 'feat/datos', { json: true });
  assert.equal(t.code, EXIT.OK);
  const data = JSON.parse(t.stdout);
  assert.deepEqual(Object.keys(data).sort(), ['base', 'carpeta', 'ok', 'rama']);
  assert.equal(data.ok, true);
  assert.equal(data.rama, 'feat/datos');
  assert.equal(data.base, 'main');
  assert.equal(t.stdout.trim().split('\n').length, 1);
  assert.match(t.stderr, /tarea carpeta:/);

  const bad = tarea(main, 'rama-rara', { json: true });
  assert.deepEqual(JSON.parse(bad.stdout), { ok: false, error: 'INVALID_BRANCH', exit: EXIT.INVALID_BRANCH });
  assert.match(bad.stderr, /no vale/);

  writeFileSync(path.join(data.carpeta, 'f.txt'), 'x\n');
  git(data.carpeta, 'add', 'f.txt');
  git(data.carpeta, 'commit', '-q', '-m', 'work');
  const refused = retirar(main, 'datos', { json: true });
  assert.equal(refused.code, EXIT.NOT_MERGED);
  assert.deepEqual(JSON.parse(refused.stdout), { result: RETIRE_RESULT.REFUSED, ok: false, error: 'NOT_MERGED', exit: EXIT.NOT_MERGED });

  git(main, 'merge', '-q', '--no-ff', '-m', 'merge', 'feat/datos');
  const res = JSON.parse(retirar(main, 'datos', { json: true }).stdout);
  assert.equal(res.result, RETIRE_RESULT.REMOVED);
  assert.equal(res.rama, 'feat/datos');
  assert.equal(res.union, false);
});

test('the real scripts exit with the class code; --json leaves only JSON on stdout', () => {
  const run = (script, ...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { encoding: 'utf8', cwd: noRepoDir() });
  const plain = run('tarea.mjs', 'rama-rara');
  assert.equal(plain.status, EXIT.INVALID_BRANCH);
  assert.equal(plain.stdout, '');
  const t = run('tarea.mjs', '--json', 'rama-rara');
  assert.equal(t.status, EXIT.INVALID_BRANCH);
  assert.equal(JSON.parse(t.stdout).error, 'INVALID_BRANCH');
  const r = run('retirar.mjs', '--json', 'no-existe');
  assert.equal(r.status, EXIT.GIT_FAILED); // cwd is not a repository
  assert.equal(JSON.parse(r.stdout).error, 'GIT_FAILED');
});

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

test('--json with a real npm ci: the whole stdout is one JSON object (npm output goes to stderr)', () => {
  const { main } = repo({ lockfile: true });
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'tarea.mjs'), '--json', 'feat/con-npm'], { cwd: main, encoding: 'utf8' });
  assert.equal(r.status, EXIT.OK, r.stderr);
  const data = JSON.parse(r.stdout); // throws if npm wrote anything else to stdout
  assert.equal(data.ok, true);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  assert.match(r.stderr, /tarea carpeta:/);
});

test('UNEXPECTED: an unclassified error exits 1 with its message on stderr, in both modes', () => {
  const run = () => { throw new TypeError('boom'); };
  const plain = runCommand([], { run, human: String });
  assert.deepEqual([plain.code, plain.stdout, plain.stderr], [EXIT.UNEXPECTED, '', 'boom\n']);
  const json = runCommand(['--json'], { run, human: String });
  assert.equal(json.code, EXIT.UNEXPECTED);
  assert.deepEqual(JSON.parse(json.stdout), { ok: false, error: 'UNEXPECTED', exit: EXIT.UNEXPECTED });
  assert.equal(json.stderr, 'boom\n');
});

test('GIT_FAILED when git cannot even start (bad working directory)', () => {
  const missing = path.join(tmpdir(), 'no-existe-esta-carpeta-ni-de-broma');
  assert.throws(() => gitRaw(['status'], missing), (e) => e instanceof ExitError && e.exit === EXIT.GIT_FAILED && /No pude lanzar git/.test(e.message));
  assert.equal(gitRaw(['--version'], tmpdir()).status, 0);
});

test('ExitError: accepts only own failure classes of EXIT, never OK or inherited names', () => {
  for (const key of ['INVALID_BRANCH', 'NOT_MERGED', 'GH_FAILED']) assert.equal(new ExitError(key, 'x').exit, EXIT[key]);
  for (const bad of ['OK', 'toString', 'constructor', '__proto__', 'NOPE', undefined]) {
    assert.throws(() => new ExitError(bad, 'x'), /unknown failure class/, String(bad));
  }
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

test('tarea: npm ci runs with stdin ignored, and npm stdout goes to stderr only with --json', () => {
  const { main } = repo();
  const seen = [];
  const lanzar = (cmd, args, opts) => { seen.push([cmd, args, opts.stdio]); return { status: 0 }; };
  assert.equal(cliTarea(['feat/stdin-a'], { cwd: main, lanzar }).code, EXIT.OK);
  assert.equal(cliTarea(['--json', 'feat/stdin-b'], { cwd: main, lanzar }).code, EXIT.OK);
  assert.deepEqual(seen.map((s) => s.slice(0, 2)), [['npm', ['ci']], ['npm', ['ci']]]);
  assert.deepEqual(seen[0][2], ['ignore', 'inherit', 'inherit']);
  assert.deepEqual(seen[1][2], ['ignore', 2, 'inherit']);
});
