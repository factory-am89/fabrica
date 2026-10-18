// La carpeta principal no se toca, se escriba como se escriba la orden: el hook de Claude
// (.claude/hooks/carpeta-principal.mjs) y los hooks de git (.githooks/), que no miran el texto.
// lesson: git-not-from-main-folder
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, realpathSync, cpSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearTarea } from '../scripts/tarea.mjs';
import { instalarHooks } from '../scripts/install-hooks.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(RAIZ, '.claude', 'hooks', 'carpeta-principal.mjs');

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const crudo = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

function repo() {
  const padre = realpathSync(mkdtempSync(path.join(tmpdir(), 'principal-')));
  const principal = path.join(padre, 'fabrica');
  mkdirSync(principal);
  git(principal, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false']]) git(principal, 'config', k, v);
  writeFileSync(path.join(principal, 'a.txt'), 'a\n');
  git(principal, 'add', 'a.txt');
  git(principal, 'commit', '-q', '-m', 'inicial');
  return principal;
}

const tarea = (principal, rama) => crearTarea(rama, { cwd: principal, instalar: false });

// El hook de verdad, como lo lanza Claude Code: JSON por stdin y un «deny» por stdout.
function hook(cwd, herramienta, orden) {
  const r = spawnSync('node', [HOOK], { cwd, input: JSON.stringify({ cwd, tool_name: herramienta, tool_input: { command: orden } }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : null;
}

// Cada salto que se encontró en la revisión: la orden cambia de forma, la carpeta destino no.
test('hook: no se deja engañar por Set-Location, subshells, prefijos, env, command ni shells anidadas', () => {
  const principal = repo();
  const { carpeta } = tarea(principal, 'feat/ocho');
  const barras = principal.replace(/\\/g, '/');
  const unix = barras.replace(/^([a-zA-Z]):/, (_, d) => `/${d.toLowerCase()}`);
  // la variable de identidad de git se arma por partes: la guardia de la casa no la quiere escrita
  const autor = `GIT_AUTHOR${'_NAME'}=x`;
  const negadas = [
    `Set-Location ${barras}; git commit -m x`,
    `Set-Location -Path "${principal}"; git commit -m x`,
    `sl ${barras}; git commit -m x`,
    `pushd ${unix} && git commit -m x`,
    `Push-Location ${barras}\ngit commit -m x`,
    `(cd ${unix} && git commit -m x)`,
    `$(cd ${unix} && git commit -m x)`,
    `${autor} git commit -m x`,
    `env ${autor} git commit -m x`,
    'command git commit -m x',
    `env -C ${barras} git commit -m x`,
    `bash -c "cd ${unix} && git commit -m x"`,
    `powershell -Command "Set-Location ${barras}; git commit -m x"`,
    'git merge otra',
    'git cherry-pick abc123',
    'git revert HEAD',
    'git rebase main',
    'git am parche.patch',
    'git reset --hard',
    'git pull',
    'git pull --rebase origin main',
    'cd $DESTINO && git commit -m x',
    `git -C ${unix} merge otra`,
    `(cd "${carpeta}" && ls); git commit -m x`,
  ];
  for (const orden of negadas) {
    assert.equal(hook(principal, 'Bash', orden), 'deny', orden);
    assert.equal(hook(principal, 'PowerShell', orden), 'deny', orden);
  }
  // las mismas órdenes en la carpeta de trabajo, o apuntando a ella, pasan
  const vale = [
    [carpeta, 'git merge otra'],
    [carpeta, 'git cherry-pick abc123'],
    [carpeta, `${autor} git commit -m x`],
    [principal, `Set-Location "${carpeta}"; git commit -m x`],
    [principal, `(cd "${carpeta}" && git commit -m x); git status`],
    [principal, 'git pull --ff-only'],
    [principal, 'git pull --ff-only origin main'],
    [principal, 'git status && git log --oneline && git diff'],
    [principal, 'git fetch origin'],
  ];
  for (const [cwd, orden] of vale) assert.equal(hook(cwd, 'Bash', orden), null, orden);
});

// La barrera que no depende de cómo se escriba la orden: los hooks de git, solo en la principal.
test('hooks de git: niegan commit, merge y cherry-pick en la principal y dejan pasar a las carpetas de trabajo', () => {
  const principal = repo();
  cpSync(path.join(RAIZ, '.githooks'), path.join(principal, '.githooks'), { recursive: true });
  const { carpeta } = tarea(principal, 'feat/nueve'); // tarea activa los hooks (core.hooksPath local)
  assert.equal(git(principal, 'config', '--local', 'core.hooksPath'), '.githooks');

  writeFileSync(path.join(carpeta, 'b.txt'), 'b\n');
  git(carpeta, 'add', 'b.txt');
  assert.equal(crudo(carpeta, 'commit', '-q', '-m', 'trabajo').status, 0, 'en la carpeta de trabajo se commitea');
  const trabajo = git(carpeta, 'rev-parse', 'HEAD');

  writeFileSync(path.join(principal, 'c.txt'), 'c\n');
  git(principal, 'add', 'c.txt');
  const commit = crudo(principal, 'commit', '-q', '-m', 'no');
  assert.notEqual(commit.status, 0);
  assert.match(commit.stderr, /npm run tarea/);
  git(principal, 'reset', '-q');
  rmSync(path.join(principal, 'c.txt'));

  const pick = crudo(principal, 'cherry-pick', trabajo);
  assert.notEqual(pick.status, 0);
  assert.match(pick.stderr, /npm run tarea/);
  crudo(principal, 'cherry-pick', '--abort');
  git(principal, 'reset', '-q', '--hard');

  // un merge con commit de fusión: main avanza (sin hooks, solo para armar el caso) y no es un avance rápido
  writeFileSync(path.join(principal, 'd.txt'), 'd\n');
  git(principal, '-c', 'core.hooksPath=/dev/null', 'add', 'd.txt');
  git(principal, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'main avanza');
  const merge = crudo(principal, 'merge', '--no-ff', '-m', 'fusion', 'feat/nueve');
  assert.notEqual(merge.status, 0);
  assert.match(merge.stderr, /npm run tarea/);
  assert.equal(git(principal, 'rev-list', '--merges', '--count', 'HEAD'), '0');
});

test('instalar-hooks: pone core.hooksPath en el repo, también si se lanza desde una carpeta de trabajo', () => {
  const principal = repo();
  const { carpeta } = tarea(principal, 'feat/diez');
  git(principal, 'config', '--local', '--unset', 'core.hooksPath');
  instalarHooks(carpeta);
  assert.equal(git(principal, 'config', '--local', 'core.hooksPath'), '.githooks');
  for (const h of ['pre-commit', 'pre-merge-commit', 'prepare-commit-msg', 'pre-rebase', 'pre-applypatch', 'denegar-principal.sh']) {
    assert.ok(existsSync(path.join(RAIZ, '.githooks', h)), h);
  }
});
