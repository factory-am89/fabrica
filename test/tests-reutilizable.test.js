// tests.yml es reutilizable: corre sobre el repo que lo llama con la configuración de la Fábrica.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { REPO } from '../scripts/lib/repo.mjs';

const FABRICA = path.resolve(import.meta.dirname, '..');
const texto = readFileSync(path.join(FABRICA, '.github', 'workflows', 'tests.yml'), 'utf8');
const doc = yaml.load(texto);
const pasos = doc.jobs.tests.steps;

test('tests.yml sigue siendo el workflow `tests`, con el job `tests`, y además es reutilizable', () => {
  assert.equal(doc.name, 'tests');
  assert.deepEqual(Object.keys(doc.jobs), ['tests']);
  assert.ok('workflow_call' in doc.on, 'sin workflow_call no se puede llamar desde otro repo');
  assert.ok('pull_request' in doc.on && 'push' in doc.on, 'en la propia Fábrica sigue corriendo en PR y push');
});

test('tests.yml baja la Fábrica a .fabrica/ en su commit y DESPUÉS de los tests del repo', () => {
  const iFabrica = pasos.findIndex((p) => p.with?.path === '.fabrica');
  assert.ok(iFabrica > 0, 'falta el checkout de la Fábrica en .fabrica/');
  assert.equal(pasos[iFabrica].with.repository, REPO);
  assert.equal(pasos[iFabrica].with.ref, '${{ job.workflow_sha }}');
  const iTest = pasos.findIndex((p) => p.run === 'npm test');
  assert.ok(iTest >= 0 && iTest < iFabrica, 'npm test del repo debe correr antes de bajar .fabrica/');
  assert.equal(pasos[0].with?.repository, undefined, 'el primer checkout es el del repo que llama');
  assert.equal(pasos[0].with?.ref, undefined, 'el primer checkout no fija ref: baja el repo que se comprueba');
});

test('tests.yml exige package-lock (npm ci, cache npm) y un script test, y lo documenta; el lint es el de la Fábrica', () => {
  const runs = pasos.map((p) => p.run).filter(Boolean);
  assert.ok(runs.includes('npm ci'));
  assert.ok(pasos.some((p) => p.with?.cache === 'npm'));
  assert.ok(!runs.includes('npm run lint'), 'npm run lint exigiría un script lint en cada repo que llama');
  assert.ok(runs.includes('npm ci --prefix .fabrica'));
  assert.ok(runs.includes('.fabrica/node_modules/.bin/eslint --config .fabrica/eslint.config.js . --max-warnings 0'));
  assert.match(texto, /package-lock\.json/);
  assert.match(texto, /script `test`/);
  const regla = pasos.find((p) => p.run === 'node --test .fabrica/test/workflows.test.js');
  assert.equal(regla?.env?.FABRICA_REPO_A_COMPROBAR, '${{ github.workspace }}');
});

function workflowsDeLlamador(ficheros, variable) {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'llamador-wf-'));
  try {
    mkdirSync(path.join(carpeta, '.github', 'workflows'), { recursive: true });
    for (const [f, t] of Object.entries(ficheros)) writeFileSync(path.join(carpeta, '.github', 'workflows', f), t);
    const env = { ...process.env };
    delete env.FABRICA_REPO_A_COMPROBAR;
    delete env.NODE_TEST_CONTEXT; // si no, el node --test anidado se cree un hijo del que lo lanza
    if (variable !== undefined) env.FABRICA_REPO_A_COMPROBAR = variable === true ? carpeta : variable;
    return spawnSync(process.execPath, ['--test', path.join(FABRICA, 'test', 'workflows.test.js')], { env, encoding: 'utf8' });
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
}

const sha = 'a'.repeat(40);
const buenoLlamador = `name: tests\non: pull_request\npermissions:\n  contents: read\njobs:\n  tests:\n    uses: ${REPO}/.github/workflows/tests.yml@main\n`;

test('las reglas de workflows también se aplican al repo que llama: bien pasa, mal falla', () => {
  assert.equal(workflowsDeLlamador({ 'tests.yml': buenoLlamador }, true).status, 0);
  const sinSha = `name: x\non: push\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n`;
  const r = workflowsDeLlamador({ 'tests.yml': buenoLlamador, 'x.yml': sinSha }, true);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /actions\/checkout@v7 sin SHA/);
  const otroRepo = buenoLlamador.replace(REPO, 'otro/fabrica');
  assert.equal(workflowsDeLlamador({ 'tests.yml': otroRepo }, true).status, 1);
  assert.equal(workflowsDeLlamador({ 'tests.yml': buenoLlamador.replace('permissions:\n  contents: read\n', '') }, true).status, 1);
  assert.equal(workflowsDeLlamador({ 'tests.yml': buenoLlamador.replace('@main', `@${sha}`) }, true).status, 0);
});

test('FABRICA_REPO_A_COMPROBAR vacía o apuntando a una carpeta sin workflows para en alto', () => {
  assert.equal(workflowsDeLlamador({ 'tests.yml': buenoLlamador }, '').status, 1);
  assert.equal(workflowsDeLlamador({}, path.join(tmpdir(), 'no-existe-llamador')).status, 1);
});
