// apps/proyecto-nuevo.ps1: las plantillas que deja en un repo nuevo se comprueban en cualquier sistema;
// el script, contra un gh falso con estado, solo en Windows (usa Windows PowerShell 5.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { REPO } from '../scripts/lib/repo.mjs';
import { leerFicha } from '../scripts/lib/repo-card.mjs';

const FABRICA = path.resolve(import.meta.dirname, '..');
const PLANTILLAS = path.join(FABRICA, 'apps', 'proyecto-nuevo');
const leer = (...r) => readFileSync(path.join(...r), 'utf8');
const hayPs = process.platform === 'win32';

test('proyecto-nuevo.ps1 contra un gh falso: privado, sin admin, Apps, secretos, PR, ruleset e idempotencia', { skip: !hayPs }, () => {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(FABRICA, 'test', 'proyecto-nuevo.prueba.ps1'), '-Script', path.join(FABRICA, 'apps', 'proyecto-nuevo.ps1')], { encoding: 'utf8' });
  const lineas = r.stdout.split(/\r?\n/).filter((l) => /^(OK|FALLO):/.test(l));
  assert.ok(lineas.length >= 29, `salida inesperada: ${r.stdout}${r.stderr}`);
  assert.deepEqual(lineas.filter((l) => l.startsWith('FALLO')), []);
});

test('los secretos que el script exige son los que declara el workflow_call de revisor.yml', () => {
  const declarados = Object.keys(yaml.load(leer(FABRICA, '.github', 'workflows', 'revisor.yml')).on.workflow_call.secrets).sort();
  const lib = leer(FABRICA, 'apps', 'lib-proyecto.ps1');
  const m = lib.match(/\$script:SecretosRevisor = @\(([^)]*)\)/);
  assert.ok(m, 'no encuentro la lista SecretosRevisor');
  const exigidos = [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual(exigidos, declarados);
});

test('las plantillas de workflows llaman a los reutilizables de la Fábrica y pasan las reglas de máquina (C4)', () => {
  const tests = yaml.load(leer(PLANTILLAS, 'tests.yml'));
  const revisor = yaml.load(leer(PLANTILLAS, 'revisor.yml'));
  assert.equal(tests.jobs.tests.uses, `${REPO}/.github/workflows/tests.yml@main`);
  assert.equal(revisor.jobs.revisor.uses, `${REPO}/.github/workflows/revisor.yml@main`);
  assert.notEqual(revisor.jobs.revisor.secrets, 'inherit', 'inherit entregaría todos los secretos del repo (ver llamadores-sin-secretos.test.js)');
  assert.ok('pull_request_target' in revisor.on, 'el juez corre con pull_request_target, como el reutilizable');
  assert.ok('pull_request' in tests.on);
  // El check que se exige es "<job que llama> / <job llamado>": si alguien renombra el job, el ruleset se queda sin check.
  assert.deepEqual(Object.keys(tests.jobs), ['tests']);
  const reutilizable = yaml.load(leer(FABRICA, '.github', 'workflows', 'tests.yml'));
  assert.deepEqual(Object.keys(reutilizable.jobs), ['tests']);
  // Las mismas reglas que se aplican a un repo que llama (workflows.test.js apuntando a su carpeta).
  const carpeta = mkdtempSync(path.join(tmpdir(), 'proyecto-nuevo-'));
  try {
    mkdirSync(path.join(carpeta, '.github', 'workflows'), { recursive: true });
    for (const f of ['tests.yml', 'revisor.yml']) writeFileSync(path.join(carpeta, '.github', 'workflows', f), leer(PLANTILLAS, f));
    const env = { ...process.env, FABRICA_REPO_A_COMPROBAR: carpeta };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ['--test', path.join(FABRICA, 'test', 'workflows.test.js')], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});

test('la ficha y el CLAUDE.md de la plantilla son válidos para un repo nuevo', () => {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'proyecto-nuevo-'));
  try {
    writeFileSync(path.join(carpeta, '.fabrica.json'), leer(PLANTILLAS, 'ficha.json').replaceAll('__REPO__', 'factory-am89/homenu-panel'));
    assert.deepEqual(leerFicha(carpeta), { repo: 'factory-am89/homenu-panel', base: 'main', identidad: 'fabrica-constructor' });
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
  const md = leer(PLANTILLAS, 'CLAUDE.md');
  assert.match(md, new RegExp(`github[.]com/${REPO}`), 'remite a la Fábrica');
  assert.ok(md.split('\n').length < 20, 'mínimo de verdad');
});
