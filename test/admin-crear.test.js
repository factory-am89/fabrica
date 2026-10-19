// scripts/admin/crear.mjs (plans/app-admin.md, chunk 8): create the repo of a proyectos/<x>.json that does not exist yet. A fake GitHub with a
// real state behind fetch, so the real makeApi / makeWriteApi run. Proven here: a new repo is created public with an initial commit (auto_init,
// so `main` exists to receive the files) and nothing else is written; a repo that exists is not touched; the answer of GitHub is checked
// afterwards (default branch `main`, a commit on it) and a failure says what was observed; a second run writes nothing; and the real workflow
// runs it before the secrets, with the token the secrets step already holds (no permission added), behind a read of the plan, with no `if`.
// The templates the new repo gets are proven to make `tests / tests` green on an empty project: npm test and the Factory lint, run for real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { ESLint } from 'eslint';
import { CREATE_OPS, assertAllowed, createCalls, main } from '../scripts/admin/crear.mjs';
import { makeApi } from '../scripts/admin/leer-plan.mjs';
import { makeWriteApi } from '../scripts/admin/secretos.mjs';
import { testsWorkflowNeeds } from '../scripts/admin/aplicar.mjs';

const RAIZ = path.resolve(import.meta.dirname, '..');
const REPO = 'factory-am89/demo';
const R = `/repos/${REPO}`;
const SHA = 'c'.repeat(40);
const PROYECTO = { repo: REPO, visibilidad: 'publico', descripcion: 'Proyecto de prueba' };

function proyectosDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'crear-'));
  writeFileSync(path.join(dir, 'demo.json'), JSON.stringify(PROYECTO));
  return dir;
}

// `exists`: the repo is already there. `branch`: its default branch. `lag`: GET calls to the tree of main that still answer 409 (empty repo) after the POST.
function fakeGitHub({ exists = false, branch = 'main', lag = 0, failPost = false, files = ['README.md'] } = {}) {
  const gh = { exists, written: [], treeReads: 0 };
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => 'CUERPO-SECRETO' });
  const fetchFn = async (url, init = {}) => {
    const p = new URL(url).pathname;
    const method = init.method ?? 'GET';
    if (method !== 'GET') {
      gh.written.push({ method, path: p, body: JSON.parse(init.body) });
      if (p !== '/orgs/factory-am89/repos') throw new Error(`fake: unexpected write ${method} ${p}`);
      if (failPost) return reply(403, null);
      gh.exists = true;
      return reply(201, {});
    }
    const routes = {
      [R]: () => (gh.exists ? reply(200, { private: false, default_branch: branch, allow_auto_merge: false, delete_branch_on_merge: false }) : reply(404, null)),
      '/installation/repositories': () => reply(200, { repositories: [{ full_name: REPO }] }),
      '/apps/fabrica-revisor': () => reply(200, { id: 1234567 }),
      [`${R}/git/trees/main`]: () => {
        gh.treeReads++;
        return gh.treeReads <= lag ? reply(409, null) : reply(200, { truncated: false, tree: files.map((f) => ({ type: 'blob', path: f })) });
      },
      [`${R}/commits/main`]: () => reply(200, { sha: SHA }),
      [`${R}/environments/revisor`]: () => reply(404, null),
      [`${R}/rulesets`]: () => reply(200, []),
      [`${R}/git/ref/heads/ops/fabrica-ficha`]: () => reply(404, null),
      [`${R}/pulls`]: () => reply(200, []),
    };
    if (!routes[p]) throw new Error(`fake: unexpected GET ${p}`);
    return routes[p]();
  };
  return { gh, fetchFn };
}

async function correr(fake, extra = {}) {
  const out = [];
  const real = process.stdout.write;
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  try {
    await main({
      dir: proyectosDir(), templatesDir: path.join(RAIZ, 'apps', 'proyecto-nuevo'),
      readApi: makeApi('lectura', fake.fetchFn), writeApi: makeWriteApi('escritura', fake.fetchFn, assertAllowed),
      sleep: async () => {}, ...extra,
    });
  } finally {
    process.stdout.write = real;
  }
  return out.join('');
}

test('a repo that does not exist is created public with an initial commit, and nothing else is written', async () => {
  const fake = fakeGitHub();
  const salida = await correr(fake);
  assert.deepEqual(fake.gh.written.map((w) => `${w.method} ${w.path}`), ['POST /orgs/factory-am89/repos']);
  assert.deepEqual(fake.gh.written[0].body, { name: 'demo', description: 'Proyecto de prueba', private: false, auto_init: true });
  assert.match(salida, /create-repo \/orgs\/factory-am89\/repos/);
  assert.match(salida, /Comprobado/);
});

test('a repo that exists is not touched: 0 changes, no write at all', async () => {
  const fake = fakeGitHub({ exists: true });
  const salida = await correr(fake);
  assert.deepEqual(fake.gh.written, []);
  assert.match(salida, /0 cambios: el repo ya existe/);
});

test('a second run over the state the first left writes nothing', async () => {
  const fake = fakeGitHub();
  await correr(fake);
  await correr(fake);
  assert.equal(fake.gh.written.length, 1);
});

test('main takes a moment to exist: it reads again before giving up, and gives up saying what it saw', async () => {
  const lento = fakeGitHub({ lag: 2 });
  await correr(lento);
  assert.ok(lento.gh.treeReads >= 3);
  const nunca = fakeGitHub({ lag: 999, files: [] });
  await assert.rejects(() => correr(nunca), /demo.*main no devuelve ningun fichero tras 5 lecturas/);
});

test('a repo whose default branch is not main fails in the open, naming the branch GitHub returned', async () => {
  await assert.rejects(() => correr(fakeGitHub({ branch: 'master' })), /rama por defecto.*master.*main/);
});

test('an HTTP error carries method, path and status and never the response body', async () => {
  const fake = fakeGitHub({ failPost: true });
  await assert.rejects(() => correr(fake), (e) => e.message === 'POST /orgs/factory-am89/repos -> 403' && !/CUERPO-SECRETO/.test(e.message));
});

test('only create-repo can leave this file', () => {
  assert.deepEqual(CREATE_OPS, ['create-repo']);
  const otras = [
    { op: 'put-file', method: 'PUT', path: `${R}/contents/CLAUDE.md`, body: { branch: 'main' } },
    { op: 'create-ruleset', method: 'POST', path: `${R}/rulesets`, body: {} },
    { op: 'create-repo', method: 'PUT', path: '/orgs/factory-am89/repos', body: {} },
    { op: 'create-repo', method: 'POST', path: '/orgs/otra-org/repos', body: {} },
  ];
  for (const c of otras) assert.throws(() => assertAllowed(c), /llamada no permitida en crear\.mjs/, `${c.op} ${c.method} ${c.path}`);
  assert.deepEqual(createCalls(otras).map((c) => c.op), ['create-repo', 'create-repo']);
  assert.doesNotThrow(() => assertAllowed({ op: 'create-repo', method: 'POST', path: '/orgs/factory-am89/repos', body: {} }));
});

// ---------- the templates make `tests / tests` pass on an empty project ----------
// What the shared tests.yml does to a project with only what the plan leaves in a new repo: npm test, and the Factory lint with the
// Factory config (`.fabrica/eslint.config.js` there; this config here). `npm ci` needs the network-free empty lockfile only.
const PLANTILLAS = path.join(RAIZ, 'apps', 'proyecto-nuevo');
// This test runs inside node --test: the child must not believe it is one of its workers (it would print nothing).
const ENTORNO = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
function proyectoVacio() {
  const dir = mkdtempSync(path.join(tmpdir(), 'vacio-'));
  mkdirSync(path.join(dir, 'test'));
  writeFileSync(path.join(dir, 'README.md'), '# demo\n');
  cpSync(path.join(PLANTILLAS, 'package.json'), path.join(dir, 'package.json'));
  cpSync(path.join(PLANTILLAS, 'package-lock.json'), path.join(dir, 'package-lock.json'));
  cpSync(path.join(PLANTILLAS, 'arranque.test.js.txt'), path.join(dir, 'test', 'arranque.test.js'));
  return dir;
}

test('an empty project with the templates: npm ci and npm test pass, and the tests really ran', () => {
  const dir = proyectoVacio();
  const ci = spawnSync('npm', ['ci'], { cwd: dir, encoding: 'utf8', shell: true, env: ENTORNO });
  assert.equal(ci.status, 0, ci.stdout + ci.stderr);
  const test = spawnSync('npm', ['test'], { cwd: dir, encoding: 'utf8', shell: true, env: ENTORNO });
  assert.equal(test.status, 0, test.stdout + test.stderr);
  assert.match(test.stdout, /ℹ tests 1\b/);
  assert.match(test.stdout, /ℹ pass 1\b/);
});

test('an empty project with the templates passes the lint of the Factory, and without the test file the lint has nothing to lint', async () => {
  const dir = proyectoVacio();
  const eslint = new ESLint({ cwd: dir, overrideConfigFile: path.join(RAIZ, 'eslint.config.js') });
  const resultados = await eslint.lintFiles(['.']);
  assert.deepEqual(resultados.flatMap((r) => r.messages), []);
  assert.equal(resultados.length, 1);
  // The reason the test file is a template: with no JavaScript file the lint of the shared workflow stops with «all files are ignored».
  const sin = mkdtempSync(path.join(tmpdir(), 'sinjs-'));
  writeFileSync(path.join(sin, 'package.json'), '{}');
  await assert.rejects(() => new ESLint({ cwd: sin, overrideConfigFile: path.join(RAIZ, 'eslint.config.js') }).lintFiles(['.']), /All files matched by '\.' are ignored/);
});

test('the package files of the templates satisfy what the real tests.yml asks of the repo', () => {
  const needs = testsWorkflowNeeds(readFileSync(path.join(RAIZ, '.github', 'workflows', 'tests.yml'), 'utf8'));
  for (const n of needs) assert.ok(readFileSync(path.join(PLANTILLAS, n), 'utf8').length > 0, `${n} is not a template`);
  assert.equal(JSON.parse(readFileSync(path.join(PLANTILLAS, 'package.json'), 'utf8')).scripts.test, 'node --test');
});

// ---------- the real workflow ----------
const WORKFLOW = '.github/workflows/administrar.yml';

// [] when `texto` runs crear.mjs after the plan is read and the writing token is minted, before the secrets, with that same token and nothing else,
// with no if and no continue-on-error. Order in one run: read plan -> create repo -> secrets -> aplicar -> humo.
function reglaDeCrear(texto) {
  const fallos = [];
  const pasos = Object.values(yaml.load(texto).jobs).flatMap((j) => j.steps);
  const i = (pred) => pasos.findIndex(pred);
  const corre = (n) => i((s) => String(s.run ?? '').includes(`scripts/admin/${n}.mjs`));
  const [plan, crear, secretos, aplicar, humo] = ['leer-plan', 'crear', 'secretos', 'aplicar', 'humo'].map(corre);
  const escritura = i((s) => s.id === 'escritura');
  if ([plan, crear, secretos, aplicar, humo, escritura].some((k) => k < 0)) return ['a step is missing: leer-plan, escritura token, crear, secretos, aplicar or humo'];
  if (!(plan < escritura && escritura < crear && crear < secretos && secretos < aplicar && aplicar < humo)) fallos.push('order must be leer-plan, escritura token, crear.mjs, secretos.mjs, aplicar.mjs, humo.mjs');
  if (pasos[crear].if !== undefined) fallos.push('crear.mjs must have no if: a failed creation has to stop the run before anything else is written');
  if (pasos[crear]['continue-on-error'] !== undefined) fallos.push('crear.mjs must not have continue-on-error');
  const env = pasos[crear].env ?? {};
  if (env.GH_TOKEN_LECTURA !== '$' + '{{ steps.lectura.outputs.token }}') fallos.push('crear.mjs must get GH_TOKEN_LECTURA from the lectura token step');
  if (env.GH_TOKEN_ESCRITURA !== '$' + '{{ steps.escritura.outputs.token }}') fallos.push('crear.mjs must get GH_TOKEN_ESCRITURA from the escritura token step (administration: write covers POST /orgs/{org}/repos)');
  if (Object.keys(env).sort().join() !== 'GH_TOKEN_ESCRITURA,GH_TOKEN_LECTURA') fallos.push(`crear.mjs must get only the two tokens, gets ${Object.keys(env).join(', ')}`);
  const escrit = pasos[escritura].with ?? {};
  if (escrit['permission-administration'] !== 'write') fallos.push('the escritura token must keep administration: write, which is what GitHub documents for POST /orgs/{org}/repos');
  return fallos;
}

test('the real workflow: crear.mjs runs between the writing token and the secrets with that token, no new permission', () => {
  assert.deepEqual(reglaDeCrear(readFileSync(path.join(RAIZ, WORKFLOW), 'utf8')), []);
});

test('red by mutation: a different order, an if, a continue-on-error or another token on the workflow are detected', () => {
  const real = readFileSync(path.join(RAIZ, WORKFLOW), 'utf8');
  const cambia = (de, a) => { const r = real.replace(de, a); assert.notEqual(r, real, `mutation anchor not found: ${de}`); return r; };
  const bloque = real.match(/ {6}# Trozo 8\.[\s\S]*?(?= {6}# Escribe el environment)/)[0];
  const detras = real.replace(bloque, '').replace('      - run: node scripts/admin/aplicar.mjs', () => bloque + '      - run: node scripts/admin/aplicar.mjs');
  assert.notEqual(detras, real);
  assert.match(reglaDeCrear(detras).join('\n'), /order must be/);
  assert.match(reglaDeCrear(cambia('      - id: crear\n', '      - id: crear\n        if: always()\n')).join('\n'), /no if/);
  assert.match(reglaDeCrear(cambia('      - id: crear\n', '      - id: crear\n        continue-on-error: true\n')).join('\n'), /continue-on-error/);
  // Inside the crear step only: the same text appears in the secrets step, so the mutation is made after the anchor.
  const [antes, despues] = real.split('      - id: crear\n');
  const dentro = (de, a) => { const r = antes + '      - id: crear\n' + despues.replace(de, a); assert.notEqual(r, real, `mutation anchor not found: ${de}`); return r; };
  assert.match(reglaDeCrear(dentro('GH_TOKEN_ESCRITURA: ${{ steps.escritura.outputs.token }}', 'GH_TOKEN_ESCRITURA: ${{ steps.lectura.outputs.token }}')).join('\n'), /escritura token step/);
  assert.match(reglaDeCrear(dentro('GH_TOKEN_LECTURA:', 'OTRO: ${{ steps.lectura.outputs.token }}\n          GH_TOKEN_LECTURA:')).join('\n'), /only the two tokens/);
});
