// Commands an agent can orchestrate: exit code per failure class, --json output and `npm run done`.
// Existing behaviour of tarea/retirar (messages, folders, branches) is covered by carpetas.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, RETIRE_RESULT } from '../scripts/lib/exit.mjs';
import { prFusionado, cliRetirar } from '../scripts/retirar.mjs';
import { cliTarea } from '../scripts/tarea.mjs';
import { runDone, DONE_LINE } from '../scripts/done.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

// <tmp>/fabrica with one commit on main (and optionally an npm lockfile with no dependencies).
function repo({ lockfile = false } = {}) {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'comandos-')));
  const main = path.join(parent, 'fabrica');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false']]) git(main, 'config', k, v);
  writeFileSync(path.join(main, 'a.txt'), 'a\n');
  git(main, 'add', 'a.txt');
  if (lockfile) {
    writeFileSync(path.join(main, 'package.json'), '{"name":"x","version":"1.0.0"}\n');
    writeFileSync(path.join(main, 'package-lock.json'), '{"name":"x","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"x","version":"1.0.0"}}}\n');
    git(main, 'add', 'package.json', 'package-lock.json');
  }
  git(main, 'commit', '-q', '-m', 'initial');
  return { parent, main };
}

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

test('without --json the current output does not change (human on stdout, nothing on stderr)', () => {
  const { main } = repo();
  const t = tarea(main, 'feat/humano');
  assert.match(t.stdout, /^tarea carpeta: .* rama: feat\/humano base: main\n/);
  assert.equal(t.stderr, '');
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
