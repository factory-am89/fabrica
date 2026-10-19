// Un worktree por sesión como máquina: tarea, retirar y el hook que niega la carpeta principal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearTarea } from '../scripts/tarea.mjs';
import { retirar } from '../scripts/retire.mjs';
import { nombreDeRama, norm } from '../scripts/lib/folders.mjs';
import { git, repo } from './support/repo.mjs';
import { decidir, enPrincipal, carpetaDeCommit } from '../.claude/hooks/carpeta-principal.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(RAIZ, '.claude', 'hooks', 'carpeta-principal.mjs');

const tarea = (principal, rama) => crearTarea(rama, { cwd: principal, instalar: false });

test('nombreDeRama: solo feat/, fix/ y ops/ con guiones', () => {
  assert.equal(nombreDeRama('feat/hooks-nuevos'), 'hooks-nuevos');
  for (const mala of ['main', 'feat/', 'feat/Mayus', 'bot/x', 'feat/a/b', undefined]) assert.throws(() => nombreDeRama(mala), /no vale/);
});

test('tarea: crea fabrica-<nombre> al lado, con su rama, desde main si no hay remoto', () => {
  const { padre, principal } = repo();
  const r = tarea(principal, 'feat/uno');
  assert.equal(norm(r.carpeta), norm(path.join(padre, 'fabrica-uno')));
  assert.equal(r.base, 'main');
  assert.equal(git(r.carpeta, 'branch', '--show-current'), 'feat/uno');
  assert.ok(existsSync(path.join(r.carpeta, 'a.txt')));
  assert.throws(() => tarea(principal, 'feat/uno'), /Ya existe/);
  assert.throws(() => tarea(principal, 'rama-rara'), /no vale/);
});

test('tarea: con remoto sale de origin/main, no de la main local', () => {
  const { padre, principal } = repo();
  const remoto = path.join(padre, 'remoto.git');
  git(padre, 'init', '-q', '--bare', '-b', 'main', remoto);
  git(principal, 'remote', 'add', 'origin', remoto);
  git(principal, 'push', '-q', 'origin', 'main');
  writeFileSync(path.join(principal, 'solo-local.txt'), 'x\n');
  git(principal, 'add', 'solo-local.txt');
  git(principal, 'commit', '-q', '-m', 'sin subir');
  const r = tarea(principal, 'fix/desde-remoto');
  assert.equal(r.base, 'origin/main');
  assert.ok(!existsSync(path.join(r.carpeta, 'solo-local.txt')), 'salió de la main local');
});

test('retirar: no borra una rama sin fusionar ni una carpeta con cambios', () => {
  const { principal } = repo();
  const { carpeta } = tarea(principal, 'feat/dos');
  writeFileSync(path.join(carpeta, 'b.txt'), 'b\n');
  assert.throws(() => retirar('dos', { cwd: principal }), /cambios sin guardar/);
  git(carpeta, 'add', 'b.txt');
  git(carpeta, 'commit', '-q', '-m', 'trabajo');
  assert.throws(() => retirar('dos', { cwd: principal }), /no está fusionada/);
  assert.ok(existsSync(carpeta), 'la carpeta debía seguir');
  assert.throws(() => retirar('nada', { cwd: principal }), /No hay ninguna carpeta/);
});

test('retirar: fusionada y limpia, borra carpeta y rama', () => {
  const { principal } = repo();
  const { carpeta } = tarea(principal, 'feat/tres');
  writeFileSync(path.join(carpeta, 'c.txt'), 'c\n');
  git(carpeta, 'add', 'c.txt');
  git(carpeta, 'commit', '-q', '-m', 'trabajo');
  git(principal, 'merge', '-q', '--no-ff', '-m', 'fusiona', 'feat/tres');
  const r = retirar('tres', { cwd: principal });
  assert.equal(r.rama, 'feat/tres');
  assert.ok(!existsSync(carpeta));
  assert.equal(git(principal, 'branch', '--list', 'feat/tres'), '');
});

test('retirar: un PR fusionado con squash cuenta, pero solo si la punta es la misma', () => {
  const { padre, principal } = repo();
  const remoto = path.join(padre, 'remoto.git');
  git(padre, 'init', '-q', '--bare', '-b', 'main', remoto);
  git(principal, 'remote', 'add', 'origin', remoto);
  git(principal, 'push', '-q', 'origin', 'main');
  const { carpeta } = tarea(principal, 'feat/cuatro');
  writeFileSync(path.join(carpeta, 'd.txt'), 'd\n');
  git(carpeta, 'add', 'd.txt');
  git(carpeta, 'commit', '-q', '-m', 'trabajo');
  const punta = git(carpeta, 'rev-parse', 'HEAD');
  assert.throws(() => retirar('cuatro', { cwd: principal, consultarPR: () => false }), /no está fusionada/);
  assert.throws(() => retirar('cuatro', { cwd: principal, consultarPR: (rama, p) => p === 'otra-punta' }), /no está fusionada/);
  retirar('cuatro', { cwd: principal, consultarPR: (rama, p) => rama === 'feat/cuatro' && p === punta });
  assert.ok(!existsSync(carpeta));
});

test('retirar: node_modules que es una unión se quita sin borrar su destino', () => {
  const { padre, principal } = repo();
  const { carpeta } = tarea(principal, 'feat/cinco');
  const destino = path.join(padre, 'modulos-de-verdad');
  mkdirSync(destino);
  writeFileSync(path.join(destino, 'paquete.txt'), 'importante\n');
  symlinkSync(destino, path.join(carpeta, 'node_modules'), 'junction');
  const r = retirar('cinco', { cwd: principal });
  assert.equal(r.union, true);
  assert.ok(!existsSync(carpeta));
  assert.equal(readFileSync(path.join(destino, 'paquete.txt'), 'utf8'), 'importante\n');
});

test('retirar: no se lanza desde dentro de la carpeta que borra', () => {
  const { principal } = repo();
  const { carpeta } = tarea(principal, 'feat/seis');
  assert.throws(() => retirar('seis', { cwd: carpeta }), /Estás dentro/);
});

test('hook: enPrincipal elige la carpeta más profunda que contiene la ruta', () => {
  // Rutas con path.resolve: en Windows salen C:..., en Linux /...; las de Windows a pelo no existen en Linux.
  const r = (...p) => path.resolve('/dev', ...p);
  const carpetas = [r('fabrica'), r('fabrica', 'anidada'), r('fabrica-x')];
  assert.equal(enPrincipal(r('fabrica', 'src', 'a.js'), carpetas), true);
  assert.equal(enPrincipal(r('fabrica'), carpetas), true);
  assert.equal(enPrincipal(r('fabrica', 'anidada', 'a.js'), carpetas), false);
  assert.equal(enPrincipal(r('fabrica-x', 'a.js'), carpetas), false, 'fabrica-x no es la principal');
  assert.equal(enPrincipal(r('otra', 'a.js'), carpetas), false);
});

test('hook: carpetaDeCommit sigue cd y git -C y no se deja engañar por otras órdenes de git', () => {
  const base = path.resolve('/zona/principal');
  const otra = path.resolve('/zona/otra');
  assert.equal(carpetaDeCommit('git commit -m x', base), base);
  assert.equal(carpetaDeCommit('git checkout -b nueva', base), base);
  assert.equal(carpetaDeCommit('git switch main', base), base);
  assert.equal(carpetaDeCommit(`git -C ${otra} commit -m x`, base), otra);
  assert.equal(carpetaDeCommit(`cd ${otra} && git commit -m x`, base), otra);
  assert.equal(carpetaDeCommit('git status && git log --oneline', base), null);
  assert.equal(carpetaDeCommit('git -c user.name=x commit -m "a && b"', base), base);
  assert.equal(carpetaDeCommit('echo git commit', base), null);
});

// El hook de verdad, como lo lanza Claude Code: JSON por stdin y un «deny» por stdout.
function hook(cwd, entrada) {
  const r = spawnSync('node', [HOOK], { cwd, input: JSON.stringify({ cwd, ...entrada }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null;
}

test('hook: niega editar y commitear en la principal y lo deja en un worktree', () => {
  const { principal } = repo();
  const { carpeta } = tarea(principal, 'feat/siete');
  for (const herramienta of ['Edit', 'Write']) {
    const negado = hook(principal, { tool_name: herramienta, tool_input: { file_path: path.join(principal, 'a.txt') } });
    assert.equal(negado.permissionDecision, 'deny');
    assert.match(negado.permissionDecisionReason, /npm run tarea/);
    assert.equal(hook(carpeta, { tool_name: herramienta, tool_input: { file_path: path.join(carpeta, 'a.txt') } }), null);
  }
  assert.equal(hook(principal, { tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }).permissionDecision, 'deny');
  assert.equal(hook(principal, { tool_name: 'Bash', tool_input: { command: 'git checkout -b otra' } }).permissionDecision, 'deny');
  assert.equal(hook(carpeta, { tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }), null);
  assert.equal(hook(principal, { tool_name: 'Bash', tool_input: { command: `git -C "${carpeta}" commit -m x` } }), null, 'la orden apunta al worktree');
  assert.equal(hook(carpeta, { tool_name: 'Bash', tool_input: { command: `git -C "${principal}" commit -m x` } }).permissionDecision, 'deny');
  assert.equal(hook(principal, { tool_name: 'Bash', tool_input: { command: 'git status' } }), null, 'leer en la principal vale');
  assert.equal(hook(principal, { tool_name: 'Read', tool_input: { file_path: path.join(principal, 'a.txt') } }), null);
});

test('hook: falla en alto si no entiende la entrada, y fuera de un repo no opina', () => {
  const r = spawnSync('node', [HOOK], { input: 'esto no es json', encoding: 'utf8' });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const fuera = realpathSync(mkdtempSync(path.join(tmpdir(), 'sin-repo-')));
  assert.equal(hook(fuera, { tool_name: 'Edit', tool_input: { file_path: path.join(fuera, 'x') } }), null);
  assert.equal(decidir({ tool_name: 'Edit', tool_input: {}, cwd: fuera }, ['/x']), null);
});

test('settings.json cuelga el hook de Edit, Write y la terminal, y no amplía permisos', () => {
  const ajustes = JSON.parse(readFileSync(path.join(RAIZ, '.claude', 'settings.json'), 'utf8'));
  const [regla] = ajustes.hooks.PreToolUse;
  for (const h of ['Edit', 'Write', 'Bash']) assert.match(regla.matcher, new RegExp(`\\b${h}\\b`));
  assert.match(regla.hooks[0].command, /carpeta-principal\.mjs/);
  assert.equal(ajustes.permissions, undefined);
  assert.match(readFileSync(path.join(RAIZ, 'CLAUDE.md'), 'utf8'), /carpeta-principal\.mjs/);
});
