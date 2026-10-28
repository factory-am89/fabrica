// tarea y retire sirven para un repo ajeno: la rama base sale de su ficha y no se le ponen los hooks de la Fábrica.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXIT } from '../scripts/lib/exit.mjs';
import { NOMBRE_FICHA } from '../scripts/lib/repo-card.mjs';
import { writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { crearTarea, cliTarea } from '../scripts/tarea.mjs';
import { retirar, cliRetirar } from '../scripts/retire.mjs';
import { leerFicha } from '../scripts/lib/repo-card.mjs';
import { HOOK_MARCA } from '../scripts/install-hooks.mjs';
import { git, repo, FICHA_FABRICA } from './apoyo/repo.mjs';

const FALSO = fileURLToPath(new URL('./fixtures/token-falso.mjs', import.meta.url));

const FICHA_AJENA = '{"repo":"pabloam89/MenuPlan","base":"staging","identidad":"ninguna"}\n';

// Un repo ajeno: rama staging con su ficha, remoto con staging y main distintos, sin .githooks/.
function ajeno({ ficha = FICHA_AJENA } = {}) {
  const { padre, principal } = repo();
  if (ficha) writeFileSync(path.join(principal, NOMBRE_FICHA), ficha);
  else rmSync(path.join(principal, NOMBRE_FICHA));
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
  writeFileSync(path.join(propio.principal, HOOK_MARCA), '#!/bin/sh\n');
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
  assert.equal(cliTarea(['--repo'], { instalar: false }).code, EXIT.USAGE);
});

// Una carpeta con un commit subido, en un repo ajeno cuya base es staging; `prs` es lo que GitHub (falso) devuelve.
function conPR(principal, nombre, base, fusionado = true) {
  const { carpeta } = crearTarea(`feat/${nombre}`, { cwd: principal, instalar: false });
  writeFileSync(path.join(carpeta, `${nombre}.txt`), 'x\n');
  git(carpeta, 'add', '-A');
  git(carpeta, 'commit', '-q', '-m', 'trabajo');
  const punta = git(carpeta, 'rev-parse', 'HEAD');
  const prs = path.join(path.dirname(principal), 'prs.json');
  const log = path.join(path.dirname(principal), 'llamadas.log');
  writeFileSync(prs, JSON.stringify([{ number: 7, merged_at: fusionado ? '2026-10-28T10:00:00Z' : null, head: { ref: `feat/${nombre}`, sha: punta }, base: { ref: base } }]));
  process.env.FALSO_PRS = prs;
  process.env.FALSO_LOG = log;
  delete process.env.FALSO_FALLA;
  return { carpeta, log };
}

test('retirar: pregunta por el PR al repo de la ficha y lo da por fusionado si lo fue en su base', () => {
  const { principal } = ajeno();
  const { carpeta, log } = conPR(principal, 'dos', 'staging');
  const r = retirar('dos', { cwd: principal, token: FALSO });
  assert.equal(r.rama, 'feat/dos');
  assert.ok(!existsSync(carpeta));
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['api repos/pabloam89/MenuPlan/pulls?state=closed&per_page=100']);
});

test('retirar: un PR fusionado en main, no en la base staging de la ficha, no cuenta', () => {
  const { principal } = ajeno();
  const { carpeta, log } = conPR(principal, 'tres', 'main');
  assert.throws(() => retirar('tres', { cwd: principal, token: FALSO }), /no está fusionada/);
  assert.ok(existsSync(carpeta));
  assert.ok(existsSync(log), 'no llegó a preguntar a GitHub: el «no» no viene de la base');
});

test('retirar --repo: lo mismo desde otra carpeta, y sin ficha falla en alto', () => {
  const { principal } = ajeno();
  const { carpeta } = conPR(principal, 'cuatro', 'staging');
  const r = cliRetirar(['--repo', principal, 'cuatro'], { token: FALSO });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!existsSync(carpeta));
  const sin = ajeno({ ficha: null });
  assert.equal(cliRetirar(['--repo', sin.principal, 'nada']).code, EXIT.USAGE);
  assert.equal(cliRetirar(['--repo']).code, EXIT.USAGE);
});

test('la ficha de los repos de prueba es la de esta Fábrica', () => {
  assert.deepEqual(JSON.parse(FICHA_FABRICA), leerFicha(path.join(import.meta.dirname, '..')));
});

test('retirar --repo: no borra la carpeta en la que estás aunque el repo se dé aparte', () => {
  const { principal } = ajeno();
  const { carpeta } = conPR(principal, 'cinco', 'staging');
  const antes = process.cwd();
  process.chdir(carpeta);
  try {
    const r = cliRetirar(['--repo', principal, 'cinco'], { token: FALSO });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr + r.stdout, /Estás dentro de/);
  } finally {
    process.chdir(antes);
  }
  assert.ok(existsSync(carpeta));
});
