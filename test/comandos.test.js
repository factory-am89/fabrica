// Commands an agent can orchestrate: exit code per failure class, --json output.
// Existing behaviour of tarea/retirar (messages, folders, branches) is covered by folders.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, unlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, RETIRE_RESULT, ExitError, runCommand } from '../scripts/lib/exit.mjs';
import { cliRetirar } from '../scripts/retire.mjs';
import { prFusionado } from '../scripts/lib/can-delete.mjs';
import { git as gitRaw } from '../scripts/lib/folders.mjs';
import { cliTarea } from '../scripts/tarea.mjs';
import { git, repo as baseRepo } from './apoyo/repo.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// The shared helper returns { padre, principal }; these tests read better with parent/main.
const repo = (opts) => {
  const { padre, principal } = baseRepo(opts);
  return { parent: padre, main: principal };
};

const tarea = (main, branch, extra = {}) => cliTarea([...(extra.json ? ['--json'] : []), branch], { cwd: main, instalar: false });
const retirar = (main, name, extra = {}) => cliRetirar([...(extra.json ? ['--json'] : []), name], { cwd: main, consultarPR: extra.consultarPR });
const FALSO_TOKEN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'token-falso.mjs');
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

test('retirar: GH_FAILED when GitHub cannot be asked, OK when it answers (shared prFusionado, fake token script)', () => {
  const { parent, main } = repo();
  const remote = path.join(parent, 'remote.git');
  git(parent, 'init', '-q', '-b', 'main', '--bare', remote);
  git(main, 'remote', 'add', 'origin', remote);
  git(main, 'push', '-q', 'origin', 'main');
  const t = JSON.parse(tarea(main, 'feat/remota', { json: true }).stdout);
  writeFileSync(path.join(t.carpeta, 'e.txt'), 'x\n');
  git(t.carpeta, 'add', 'e.txt');
  git(t.carpeta, 'commit', '-q', '-m', 'work');
  const punta = git(t.carpeta, 'rev-parse', 'HEAD');
  const prs = path.join(parent, 'prs.json');
  writeFileSync(prs, JSON.stringify([{ number: 1, merged_at: '2026-10-16T10:00:00Z', head: { ref: 'feat/remota', sha: punta } }]));
  const consultarPR = (rama, p) => prFusionado(p, { repo: 'o/r', token: FALSO_TOKEN, cwd: main });
  const saved = { prs: process.env.FALSO_PRS, log: process.env.FALSO_LOG, falla: process.env.FALSO_FALLA };
  try {
    process.env.FALSO_PRS = prs;
    process.env.FALSO_LOG = path.join(parent, 'llamadas.log');
    process.env.FALSO_FALLA = '1';
    assert.throws(() => prFusionado(punta, { repo: 'o/r', token: FALSO_TOKEN, cwd: main }), (e) => e instanceof ExitError && e.exit === EXIT.GH_FAILED);
    const failing = retirar(main, 'remota', { consultarPR });
    assert.equal(failing.code, EXIT.GH_FAILED);
    delete process.env.FALSO_FALLA;
    assert.equal(retirar(main, 'remota', { consultarPR }).code, EXIT.OK);
  } finally {
    for (const [k, v] of [['FALSO_PRS', saved.prs], ['FALSO_LOG', saved.log], ['FALSO_FALLA', saved.falla]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('retirar: NODE_MODULES_SHARED when a node_modules junction of another folder points inside, OK once it does not', () => {
  const { main } = repo();
  const a = JSON.parse(tarea(main, 'feat/a', { json: true }).stdout).carpeta;
  const b = JSON.parse(tarea(main, 'feat/b', { json: true }).stdout).carpeta;
  mkdirSync(path.join(a, 'node_modules'));
  symlinkSync(path.join(a, 'node_modules'), path.join(b, 'node_modules'), 'junction');
  assert.equal(retirar(main, 'a').code, EXIT.NODE_MODULES_SHARED);
  unlinkSync(path.join(b, 'node_modules'));
  assert.equal(retirar(main, 'a').code, EXIT.OK);
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
  const r = run('retire.mjs', '--json', 'no-existe');
  assert.equal(r.status, EXIT.GIT_FAILED); // cwd is not a repository
  assert.equal(JSON.parse(r.stdout).error, 'GIT_FAILED');
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
