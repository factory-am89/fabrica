// La regla «¿se puede borrar esta carpeta?» vive en un solo sitio (scripts/lib/can-delete.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearTarea } from '../scripts/tarea.mjs';
import { retirar } from '../scripts/retire.mjs';
import { prFusionado } from '../scripts/lib/can-delete.mjs';

const fuente = (f) => readFileSync(new URL(`../scripts/${f}`, import.meta.url), 'utf8');

test('retirar y limpiar usan la misma regla y ninguno la repite', () => {
  for (const f of ['retire.mjs', 'clean.mjs']) {
    const s = fuente(f);
    assert.match(s, /from '\.\/lib\/can-delete\.mjs'/, `${f} importa la regla común`);
    assert.doesNotMatch(s, /status', '--porcelain'/, `${f} no repite la comprobación de cambios sin guardar`);
    assert.doesNotMatch(s, /spawnSync\('gh'/, `${f} no lanza gh a pelo`);
  }
});

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FALSO = path.join(AQUI, 'fixtures', 'token-falso.mjs');

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

test('retirar: se niega si la unión de node_modules de OTRA carpeta apunta dentro de la que borra', () => {
  const padre = realpathSync(mkdtempSync(path.join(tmpdir(), 'regla-')));
  const principal = path.join(padre, 'fabrica');
  mkdirSync(principal);
  git(principal, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false']]) git(principal, 'config', k, v);
  writeFileSync(path.join(principal, 'a.txt'), 'a\n');
  writeFileSync(path.join(principal, '.fabrica.json'), '{"repo":"factory-am89/fabrica","base":"main","identidad":"fabrica-constructor"}\n'); // tarea y retire leen la base de la ficha
  git(principal, 'add', 'a.txt', '.fabrica.json');
  git(principal, 'commit', '-q', '-m', 'inicial');
  const a = crearTarea('feat/a', { cwd: principal, instalar: false }).carpeta;
  const b = crearTarea('feat/b', { cwd: principal, instalar: false }).carpeta;
  mkdirSync(path.join(a, 'node_modules'));
  writeFileSync(path.join(a, 'node_modules', 'paquete.txt'), 'importante\n');
  symlinkSync(path.join(a, 'node_modules'), path.join(b, 'node_modules'), 'junction');
  assert.throws(() => retirar('a', { cwd: principal }), /unión de node_modules de fabrica-b apunta aquí/);
  assert.ok(existsSync(path.join(a, 'node_modules', 'paquete.txt')), 'el destino sigue intacto');
});

test('prFusionado: pregunta a GitHub por token.mjs (una consulta REST) y compara la punta', () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'regla-')));
  const prs = path.join(dir, 'prs.json');
  const log = path.join(dir, 'llamadas.log');
  writeFileSync(prs, JSON.stringify([
    { number: 1, merged_at: '2026-10-16T10:00:00Z', head: { ref: 'a', sha: 'aaa' } },
    { number: 2, merged_at: null, head: { ref: 'b', sha: 'bbb' } },
  ]));
  process.env.FALSO_PRS = prs;
  process.env.FALSO_LOG = log;
  delete process.env.FALSO_FALLA;
  const opciones = { repo: 'o/r', token: FALSO, cwd: dir };
  assert.equal(prFusionado('aaa', opciones), true);
  assert.equal(prFusionado('bbb', opciones), false, 'cerrado sin fusionar no cuenta');
  assert.equal(prFusionado('ccc', opciones), false);
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 3);
  assert.match(readFileSync(log, 'utf8'), /^api repos\/o\/r\/pulls\?state=closed&per_page=100$/m);
  process.env.FALSO_FALLA = '1';
  assert.throws(() => prFusionado('aaa', opciones), /GitHub no responde/);
  delete process.env.FALSO_FALLA;
});
