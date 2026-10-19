// scripts/admin/humo.mjs (plans/app-admin.md, chunk 7): the smoke PR. A fake GitHub with a real state behind fetch, so the real
// makeApi / makeHumoApi run. Proven here: the writes come in order (ref, file on the branch, PR, auto-merge by GraphQL) and are only
// the four operations of the chunk; the file goes on the branch and never on main; a failed GraphQL mutation (status 200 with
// `errors`) fails in the open; a second run writes nothing; and the real workflow gives humo its own token with exactly the
// permissions it needs, after aplicar, with no `if` and no continue-on-error. Those workflow checks are red by mutation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { SMOKE_OPS, assertAllowed, main, makeHumoApi, smokeCalls } from '../scripts/admin/humo.mjs';
import { makeApi } from '../scripts/admin/leer-plan.mjs';

const RAIZ = path.resolve(import.meta.dirname, '..');
const REPO = 'factory-am89/demo';
const R = `/repos/${REPO}`;
const SHA = 'b'.repeat(40);
const BASE_FILES = ['README.md', '.github/workflows/tests.yml', '.github/workflows/revisor.yml', 'CLAUDE.md', 'package.json', 'package-lock.json'];

function proyectosDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'humo-'));
  writeFileSync(path.join(dir, 'demo.json'), JSON.stringify({ repo: REPO, visibilidad: 'publico', descripcion: 'demo' }));
  return dir;
}

function fakeGitHub({ pr = null, branch = false, graphqlErrors = null, failOn = null } = {}) {
  const gh = { branch, branchFile: false, pr, written: [] };
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => 'CUERPO-SECRETO' });
  const prJson = () => ({ number: 5, state: 'open', merged_at: null, auto_merge: gh.pr.autoMerge ? { merge_method: 'squash' } : null, node_id: 'PR_node' });
  const fetchFn = async (url, init = {}) => {
    const p = new URL(url).pathname;
    const method = init.method ?? 'GET';
    if (method !== 'GET') {
      const body = JSON.parse(init.body);
      gh.written.push({ method, path: p, body });
      if (failOn && p.endsWith(failOn)) return reply(403, null);
      if (p === `${R}/git/refs`) gh.branch = true;
      else if (p.startsWith(`${R}/contents/`)) gh.branchFile = true;
      else if (p === `${R}/pulls`) gh.pr = { autoMerge: false };
      else if (p === '/graphql') {
        if (graphqlErrors) return reply(200, { errors: graphqlErrors });
        gh.pr.autoMerge = true;
        return reply(200, { data: { enablePullRequestAutoMerge: { pullRequest: { number: 5 } } } });
      } else throw new Error(`fake: unexpected write ${method} ${p}`);
      return reply(201, {});
    }
    const routes = {
      [R]: () => reply(200, { private: false, allow_auto_merge: true, delete_branch_on_merge: true }),
      '/installation/repositories': () => reply(200, { repositories: [{ full_name: REPO }] }),
      '/apps/fabrica-revisor': () => reply(200, { id: 1234567 }),
      [`${R}/git/trees/main`]: () => reply(200, { truncated: false, tree: BASE_FILES.map((f) => ({ type: 'blob', path: f })) }),
      [`${R}/commits/main`]: () => reply(200, { sha: SHA }),
      [`${R}/environments/revisor`]: () => reply(200, { deployment_branch_policy: { custom_branch_policies: true } }),
      [`${R}/environments/revisor/deployment-branch-policies`]: () => reply(200, { branch_policies: [{ name: 'main' }] }),
      [`${R}/environments/revisor/secrets`]: () => reply(200, { secrets: ['CLAUDE_CODE_OAUTH_TOKEN', 'REVISOR_CLIENT_ID', 'REVISOR_APP_KEY'].map((name) => ({ name })) }),
      [`${R}/rulesets`]: () => reply(200, []),
      [`${R}/git/ref/heads/ops/fabrica-ficha`]: () => (gh.branch ? reply(200, {}) : reply(404, null)),
      [`${R}/contents/.fabrica.json`]: () => (gh.branchFile ? reply(200, {}) : reply(404, null)),
      [`${R}/pulls`]: () => reply(200, gh.pr ? [prJson()] : []),
    };
    if (!routes[p]) throw new Error(`fake: unexpected GET ${p}`);
    return routes[p]();
  };
  return { gh, fetchFn };
}

async function correr(fake, summaryFile) {
  const out = [];
  const real = process.stdout.write;
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  try {
    await main({ dir: proyectosDir(), templatesDir: path.join(RAIZ, 'apps', 'proyecto-nuevo'), readApi: makeApi('lectura', fake.fetchFn), writeApi: makeHumoApi('humo', fake.fetchFn), summaryFile });
  } finally {
    process.stdout.write = real;
  }
  return out.join('');
}

test('no branch yet: ref, file on the branch, PR and auto-merge by GraphQL, in that order and nothing else', async () => {
  const fake = fakeGitHub();
  const salida = await correr(fake);
  assert.deepEqual(fake.gh.written.map((w) => `${w.method} ${w.path}`), [
    `POST ${R}/git/refs`, `PUT ${R}/contents/.fabrica.json`, `POST ${R}/pulls`, 'POST /graphql',
  ]);
  const [ref, file, pr, gql] = fake.gh.written.map((w) => w.body);
  assert.deepEqual(ref, { ref: 'refs/heads/ops/fabrica-ficha', sha: SHA });
  assert.equal(file.branch, 'ops/fabrica-ficha', 'the ficha goes on the smoke branch, never straight on main');
  assert.equal(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')).repo, REPO);
  assert.equal(pr.head, 'ops/fabrica-ficha');
  assert.equal(pr.base, 'main');
  assert.deepEqual(gql.variables, { id: 'PR_node', method: 'SQUASH' });
  assert.match(gql.query, /enablePullRequestAutoMerge/);
  assert.match(salida, /PR de humo #5 \(open\) con la fusion automatica armada/);
  assert.equal(fake.gh.written.every((w) => !JSON.stringify(w.body).includes('Bearer')), true);
});

test('a second run over the state the first left writes nothing', async () => {
  const fake = fakeGitHub();
  await correr(fake);
  const antes = fake.gh.written.length;
  const salida = await correr(fake);
  assert.equal(fake.gh.written.length, antes);
  assert.match(salida, /Sin escrituras/);
});

test('each stage does the next step: PR open without auto-merge is only armed; branch with file but no PR opens the PR', async () => {
  const a = fakeGitHub({ branch: true, pr: { autoMerge: false } });
  a.gh.branchFile = true;
  await correr(a);
  assert.deepEqual(a.gh.written.map((w) => w.path), ['/graphql']);
  const b = fakeGitHub({ branch: true });
  b.gh.branchFile = true;
  await correr(b);
  assert.deepEqual(b.gh.written.map((w) => w.path), [`${R}/pulls`, '/graphql']);
});

test('a GraphQL mutation that answers 200 with errors fails, saying what GitHub answered', async () => {
  const fake = fakeGitHub({ graphqlErrors: [{ message: 'Resource not accessible by integration' }] });
  await assert.rejects(() => correr(fake), /POST \/graphql -> 200 con errors: Resource not accessible by integration/);
});

test('an HTTP error carries method, path and status and never the response body', async () => {
  const fake = fakeGitHub({ failOn: '/git/refs' });
  await assert.rejects(() => correr(fake), (e) => e.message === `POST ${R}/git/refs -> 403` && !/CUERPO-SECRETO/.test(e.message));
});

test('only the four operations of the chunk can leave this file, and a put-file on main is not one of them', () => {
  assert.deepEqual(SMOKE_OPS, ['create-ref', 'put-file', 'open-pr', 'arm-auto-merge']);
  const otras = [
    { op: 'put-file', method: 'PUT', path: `${R}/contents/CLAUDE.md`, body: { branch: 'main' } },
    { op: 'update-ruleset', method: 'PUT', path: `${R}/rulesets/1`, body: {} },
    { op: 'update-settings', method: 'PATCH', path: R, body: {} },
    { op: 'create-repo', method: 'POST', path: '/orgs/factory-am89/repos', body: {} },
    { op: 'open-pr', method: 'PUT', path: `${R}/pulls`, body: {} },
  ];
  for (const c of otras) assert.throws(() => assertAllowed(c), /llamada no permitida en humo\.mjs/, c.op);
  assert.deepEqual(smokeCalls(otras).map((c) => c.op), ['open-pr'], 'the filter is by operation; the method and path are checked by assertAllowed');
  assert.doesNotThrow(() => assertAllowed({ op: 'put-file', method: 'PUT', path: `${R}/contents/.fabrica.json`, body: { branch: 'ops/fabrica-ficha' } }));
});

// ---------- the real workflow ----------
const WORKFLOW = '.github/workflows/administrar.yml';
const PERMISOS_HUMO = { 'permission-contents': 'write', 'permission-pull-requests': 'write', 'permission-metadata': 'read' };

// [] when `texto` gives humo.mjs its own token step with exactly PERMISOS_HUMO, behind aplicar, with no if and no continue-on-error.
function reglaDeHumo(texto) {
  const fallos = [];
  const doc = yaml.load(texto);
  const pasos = Object.values(doc.jobs).flatMap((j) => j.steps);
  const i = (pred) => pasos.findIndex(pred);
  const aplicar = i((s) => String(s.run ?? '').includes('scripts/admin/aplicar.mjs'));
  const token = i((s) => s.id === 'humo');
  const corre = i((s) => String(s.run ?? '').includes('scripts/admin/humo.mjs'));
  if (aplicar < 0 || token < 0 || corre < 0) return ['the aplicar.mjs step, the humo token step or the humo.mjs step is missing'];
  if (!(aplicar < token && token < corre)) fallos.push('order must be aplicar.mjs, then the humo token, then humo.mjs');
  const permisos = Object.fromEntries(Object.entries(pasos[token].with ?? {}).filter(([k]) => k.startsWith('permission-')));
  if (JSON.stringify(Object.entries(permisos).sort()) !== JSON.stringify(Object.entries(PERMISOS_HUMO).sort())) fallos.push(`the humo token must have exactly ${JSON.stringify(PERMISOS_HUMO)}, has ${JSON.stringify(permisos)}`);
  for (const k of [token, corre]) {
    if (pasos[k].if !== undefined) fallos.push(`step ${k} (humo) must have no if: a failed aplicar step has to skip it`);
    if (pasos[k]['continue-on-error'] !== undefined) fallos.push(`step ${k} (humo) must not have continue-on-error`);
  }
  if (pasos[aplicar]['continue-on-error'] !== undefined) fallos.push('the aplicar.mjs step must not have continue-on-error');
  const env = pasos[corre].env ?? {};
  if (env.GH_TOKEN_HUMO !== '$' + '{{ steps.humo.outputs.token }}') fallos.push('humo.mjs must get GH_TOKEN_HUMO from the humo token step');
  if (env.GH_TOKEN_LECTURA !== '$' + '{{ steps.lectura.outputs.token }}') fallos.push('humo.mjs must get GH_TOKEN_LECTURA from the lectura token step');
  if (Object.keys(env).sort().join() !== 'GH_TOKEN_HUMO,GH_TOKEN_LECTURA') fallos.push(`humo.mjs must get only the two tokens, gets ${Object.keys(env).join(', ')}`);
  // No other step may hold the humo token.
  for (const [k, s] of pasos.entries()) if (k !== corre && JSON.stringify(s).includes('steps.humo.')) fallos.push(`step ${k} uses the humo token and is not humo.mjs`);
  return fallos;
}

test('the real workflow: humo has its own token with contents and pull_requests write, behind aplicar, and no other step holds it', () => {
  assert.deepEqual(reglaDeHumo(readFileSync(path.join(RAIZ, WORKFLOW), 'utf8')), []);
});

test('the reading token does not ask for administration (it showed nothing the plan needs, #98)', () => {
  const doc = yaml.load(readFileSync(path.join(RAIZ, WORKFLOW), 'utf8'));
  const lectura = Object.values(doc.jobs).flatMap((j) => j.steps).find((s) => s.id === 'lectura');
  assert.equal(lectura.with['permission-administration'], undefined);
});

test('red by mutation: a wider token, an if, an order change or a shared token on the workflow are detected', () => {
  const real = readFileSync(path.join(RAIZ, WORKFLOW), 'utf8');
  const cambia = (de, a) => { const r = real.replace(de, a); assert.notEqual(r, real, `mutation anchor not found: ${de}`); return r; };
  const bloque = real.match(/ {6}# Trozo 7\. Va DESPUES[\s\S]*?(?= {6}# La rama ops)/)[0];
  const delante = real.replace(bloque, '').replace('      - run: node scripts/admin/aplicar.mjs', () => bloque + '      - run: node scripts/admin/aplicar.mjs');
  assert.notEqual(delante, real);
  assert.match(reglaDeHumo(delante).join('\n'), /order must be/);
  assert.match(reglaDeHumo(cambia('permission-pull-requests: write', 'permission-pull-requests: write\n          permission-workflows: write')).join('\n'), /exactly/);
  assert.match(reglaDeHumo(cambia('      - id: humo\n', '      - id: humo\n        if: always()\n')).join('\n'), /no if/);
  assert.match(reglaDeHumo(cambia('      - run: node scripts/admin/humo.mjs', '      - continue-on-error: true\n        run: node scripts/admin/humo.mjs')).join('\n'), /continue-on-error/);
  assert.match(reglaDeHumo(cambia('GH_TOKEN_APLICAR: ${{ steps.aplicar.outputs.token }}', 'GH_TOKEN_APLICAR: ${{ steps.humo.outputs.token }}')).join('\n'), /not humo\.mjs/);
});
