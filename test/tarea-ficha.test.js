// tarea y retire sirven para un repo ajeno: la rama base sale de su ficha y no se le ponen los hooks de la Fábrica.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { crearTarea, cliTarea } from '../scripts/tarea.mjs';
import { retirar, cliRetirar } from '../scripts/retire.mjs';
import { git, repo } from './apoyo/repo.mjs';

const FICHA_AJENA = '{"repo":"pabloam89/MenuPlan","base":"staging","identidad":"ninguna"}\n';

// Un repo ajeno: rama staging con su ficha, remoto con staging y main distintos, sin .githooks/.
function ajeno({ ficha = FICHA_AJENA } = {}) {
  const { padre, principal } = repo();
  if (ficha) writeFileSync(path.join(principal, '.fabrica.json'), ficha);
  else rmSync(path.join(principal, '.fabrica.json'));
  git(principal, 'add', '-A');
  git(principal, 'commit', '-q', '-m', 'ficha');
  git(principal, 'branch', 'staging');
  const remoto = path.join(padre, 'remoto.git');
  git(padre, 'init', '-q', '--bare', '-b', 'main', remoto);
  git(principal, 'remote', 'add', 'origin', remoto);
  git(principal, 'push', '-q', 'origin', 'main', 'staging');
  git(principal, 'checkout', '-q', 'staging');
  writeFileSync(path.join(principal, 'solo-staging.txt'), 'x\n');
  git(principal, 'add', '-A');
  git(principal, 'commit', '-q', '-m', 'staging avanza');
  git(principal, 'push', '-q', 'origin', 'staging');
  git(principal, 'checkout', '-q', 'main');
  return { padre, principal };
}

test('tarea: la rama sale de origin/<base de la ficha>, no de origin/main', () => {
  const { principal } = ajeno();
  const r = crearTarea('feat/algo', { cwd: principal, instalar: false });
  assert.equal(r.base, 'origin/staging');
  assert.ok(existsSync(path.join(r.carpeta, 'solo-staging.txt')), 'no salió de staging');
});

test('tarea: sin .githooks/ en el repo no toca core.hooksPath; con ellos, sí', () => {
  const { principal } = ajeno();
  crearTarea('feat/uno', { cwd: principal, instalar: false });
  const r = spawnSync('git', ['config', '--local', 'core.hooksPath'], { cwd: principal, encoding: 'utf8' });
  assert.notEqual(r.status, 0, `puso core.hooksPath: ${r.stdout}`);
  const propio = repo();
  mkdirSync(path.join(propio.principal, '.githooks'));
  writeFileSync(path.join(propio.principal, '.githooks', 'denegar-principal.sh'), '#!/bin/sh\n');
  crearTarea('feat/uno', { cwd: propio.principal, instalar: false });
  assert.equal(git(propio.principal, 'config', '--local', 'core.hooksPath'), '.githooks');
});

test('tarea: sin ficha falla en alto y no crea la carpeta', () => {
  const { principal } = ajeno({ ficha: null });
  assert.throws(() => crearTarea('feat/sin', { cwd: principal, instalar: false }), /Falta la ficha/);
  assert.ok(!existsSync(path.join(path.dirname(principal), `${path.basename(principal)}-sin`)));
});

test('tarea --repo: trabaja sobre el repo de esa carpeta, desde otro cwd', () => {
  const { principal } = ajeno();
  const r = cliTarea(['--json', '--repo', principal, 'feat/fuera'], { instalar: false });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).base, 'origin/staging');
  assert.equal(cliTarea(['--repo'], { instalar: false }).code, 2);
});

test('retirar: la base es la de la ficha; fusionada en staging se borra, y consulta el repo de la ficha', () => {
  const { principal } = ajeno();
  const { carpeta } = crearTarea('feat/dos', { cwd: principal, instalar: false });
  writeFileSync(path.join(carpeta, 'c.txt'), 'c\n');
  git(carpeta, 'add', 'c.txt');
  git(carpeta, 'commit', '-q', '-m', 'trabajo');
  let consultado = null;
  assert.throws(() => retirar('dos', { cwd: principal, consultarPR: (rama) => { consultado = rama; return false; } }), /no está fusionada/);
  assert.equal(consultado, 'feat/dos');
  git(principal, 'checkout', '-q', 'staging');
  git(principal, 'merge', '-q', '--no-ff', '-m', 'fusiona', 'feat/dos');
  git(principal, 'push', '-q', 'origin', 'staging');
  git(principal, 'checkout', '-q', 'main');
  const r = cliRetirar(['--repo', principal, 'dos']);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!existsSync(carpeta));
});

test('retirar: fusionada en main pero no en staging, se queda', () => {
  const { principal } = ajeno();
  const { carpeta } = crearTarea('feat/tres', { cwd: principal, instalar: false });
  writeFileSync(path.join(carpeta, 'd.txt'), 'd\n');
  git(carpeta, 'add', 'd.txt');
  git(carpeta, 'commit', '-q', '-m', 'trabajo');
  git(principal, 'merge', '-q', '--no-ff', '-m', 'a main', 'feat/tres');
  git(principal, 'push', '-q', 'origin', 'main');
  assert.throws(() => retirar('tres', { cwd: principal, consultarPR: () => false }), /no está fusionada/);
});
