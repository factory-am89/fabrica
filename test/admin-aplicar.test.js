// scripts/admin/aplicar.mjs (plans/app-admin.md, chunk 6): settings, files on main and ruleset of main.
// A fake GitHub with a real state behind fetch, so the real makeApi / makeWriteApi run. Proven here: nothing is written
// unless the `revisor` environment of EVERY project has main-only policy and the three secret names (the lock);
// the writes come in plan order (files, settings, ruleset) and are only the four operations of the chunk; a weaker ruleset is
// replaced by the full body with an empty bypass_actors; a second run says 0 cambios and writes nothing; and the real
// workflow runs aplicar only after the secrets step succeeded (order and no `if` / continue-on-error), red by mutation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { APPLY_OPS, applyCalls, assertAllowed, main, missingBeforeProtecting } from '../scripts/admin/aplicar.mjs';
import { makeWriteApi } from '../scripts/admin/secretos.mjs';
import { makeApi } from '../scripts/admin/leer-plan.mjs';
import { rulesetBody } from '../scripts/admin/proyecto.mjs';

const RAIZ = path.resolve(import.meta.dirname, '..');
const APP_ID = 1234567;
const SECRETS = ['CLAUDE_CODE_OAUTH_TOKEN', 'REVISOR_CLIENT_ID', 'REVISOR_APP_KEY'];

function proyectosDir(names) {
  const dir = mkdtempSync(path.join(tmpdir(), 'aplicar-'));
  for (const n of names) writeFileSync(path.join(dir, `${n}.json`), JSON.stringify({ repo: `factory-am89/${n}`, visibilidad: 'publico', descripcion: n }));
  return dir;
}

// One repo per name. `repos[name]` is its real state; `written` is every non-GET request in order.
function fakeGitHub(repos) {
  const gh = { repos, written: [] };
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => '' });
  const fetchFn = async (url, init = {}) => {
    const p = new URL(url).pathname;
    const method = init.method ?? 'GET';
    const m = p.match(/^\/repos\/factory-am89\/([^/]+)(\/.*)?$/);
    const r = m && gh.repos[m[1]];
    if (method !== 'GET') {
      gh.written.push({ method, path: p, body: JSON.parse(init.body) });
      const rest = m[2] ?? '';
      const body = JSON.parse(init.body);
      if (rest === '') Object.assign(r.settings, body);
      else if (rest.startsWith('/contents/')) r.files.push(rest.slice('/contents/'.length));
      else if (rest === '/rulesets') r.rulesets.push({ id: 77, ...body });
      else if (rest.startsWith('/rulesets/')) r.rulesets = r.rulesets.map((x) => (x.id === Number(rest.split('/').pop()) ? { ...body, id: x.id } : x));
      else throw new Error(`fake: unexpected write ${method} ${p}`);
      return reply(200, {});
    }
    if (p === '/installation/repositories') return reply(200, { repositories: Object.keys(gh.repos).map((n) => ({ full_name: `factory-am89/${n}` })) });
    if (p === '/apps/fabrica-revisor') return reply(200, { id: APP_ID });
    if (!r) throw new Error(`fake: unexpected GET ${p}`);
    const rest = m[2] ?? '';
    const env = r.env;
    const routes = {
      '': () => reply(200, { private: false, ...r.settings }),
      '/git/trees/main': () => reply(200, { truncated: false, tree: r.files.map((f) => ({ type: 'blob', path: f })) }),
      '/commits/main': () => reply(200, { sha: 'a'.repeat(40) }),
      '/environments/revisor': () => (env ? reply(200, { deployment_branch_policy: { custom_branch_policies: env.custom } }) : reply(404, null)),
      '/environments/revisor/deployment-branch-policies': () => reply(200, { branch_policies: env.branches.map((name) => ({ name })) }),
      '/environments/revisor/secrets': () => reply(200, { secrets: r.secrets.map((name) => ({ name })) }),
      '/rulesets': () => reply(200, r.rulesets.map((x) => ({ id: x.id }))),
      '/git/ref/heads/ops/fabrica-ficha': () => reply(404, null),
      '/pulls': () => reply(200, []),
    };
    const rs = rest.match(/^\/rulesets\/(\d+)$/);
    if (rs) return reply(200, r.rulesets.find((x) => x.id === Number(rs[1])));
    if (!routes[rest]) throw new Error(`fake: unexpected GET ${p}`);
    return routes[rest]();
  };
  return { gh, fetchFn };
}

const listo = (extra = {}) => ({
  settings: { allow_auto_merge: false, delete_branch_on_merge: false },
  files: ['README.md'], env: { custom: true, branches: ['main'] }, secrets: [...SECRETS], rulesets: [], ...extra,
});

async function correr(fake, dir, summaryFile) {
  const out = [];
  const real = process.stdout.write;
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  try {
    await main({ dir, templatesDir: path.join(RAIZ, 'apps', 'proyecto-nuevo'), readApi: makeApi('lectura', fake.fetchFn), writeApi: makeWriteApi('aplicar', fake.fetchFn, assertAllowed), summaryFile });
  } finally {
    process.stdout.write = real;
  }
  return out.join('');
}

test('the lock: without the secrets (or without the main-only environment) nothing is written, whatever else is missing', async () => {
  for (const [nombre, estado] of [
    ['no environment', listo({ env: null, secrets: [] })],
    ['environment without secrets', listo({ secrets: [] })],
    ['two of three secrets', listo({ secrets: SECRETS.slice(0, 2) })],
    ['environment not limited to main', listo({ env: { custom: false, branches: [] } })],
    ['custom policies but not main', listo({ env: { custom: true, branches: ['dev'] } })],
  ]) {
    const fake = fakeGitHub({ demo: estado });
    await assert.rejects(() => correr(fake, proyectosDir(['demo'])), /no se protege main todavia.*No se ha escrito nada/s, nombre);
    assert.deepEqual(fake.gh.written, [], nombre);
  }
});

test('the lock is for all projects at once: one project not ready stops the writes of the ready one', async () => {
  const fake = fakeGitHub({ a: listo(), b: listo({ secrets: [] }) });
  await assert.rejects(() => correr(fake, proyectosDir(['a', 'b'])), /factory-am89\/b: no se protege main/);
  assert.deepEqual(fake.gh.written, []);
});

test('what is missing is named by operation and path, never a value (pure)', () => {
  const R = '/repos/factory-am89/demo/environments/revisor';
  const m = missingBeforeProtecting([{ op: 'put-file', path: 'x' }, { op: 'put-secret', path: `${R}/secrets/REVISOR_CLIENT_ID`, body: { valueFrom: 'workflow-secret' } }, { op: 'create-ruleset', path: 'y' }]);
  assert.deepEqual(m, [`put-secret ${R}/secrets/REVISOR_CLIENT_ID`]);
  assert.deepEqual(missingBeforeProtecting([{ op: 'create-ruleset', path: 'y' }]), []);
});

test('ready repo with nothing done: the three files on main, then settings, then the ruleset; nothing else; second run writes nothing', async () => {
  const fake = fakeGitHub({ demo: listo() });
  const dir = proyectosDir(['demo']);
  await correr(fake, dir);
  const w = fake.gh.written;
  assert.deepEqual(w.map((x) => `${x.method} ${x.path.replace('/repos/factory-am89/demo', '')}`), [
    'PUT /contents/.github/workflows/tests.yml',
    'PUT /contents/.github/workflows/revisor.yml',
    'PUT /contents/CLAUDE.md',
    'PATCH ',
    'POST /rulesets',
  ]);
  assert.deepEqual(w.find((x) => x.method === 'PATCH').body, { allow_auto_merge: true, delete_branch_on_merge: true });
  assert.ok(w.filter((x) => x.path.includes('/contents/')).every((x) => x.body.branch === 'main'));
  const rs = w.find((x) => x.path.endsWith('/rulesets')).body;
  assert.deepEqual(rs, rulesetBody({ revisorAppId: APP_ID }));
  assert.deepEqual(rs.bypass_actors, []);
  assert.equal(rs.enforcement, 'active');
  const contextos = rs.rules.find((r) => r.type === 'required_status_checks').parameters.required_status_checks.map((c) => c.context);
  assert.deepEqual(contextos, ['tests / tests', 'revisor']);
  const antes = fake.gh.written.length;
  const salida = await correr(fake, dir);
  assert.equal(fake.gh.written.length, antes, 'second run writes nothing');
  assert.match(salida, /0 cambios/);
});

test('a weaker ruleset (no revisor, an extra bypass) is replaced with PUT of the full body, never deleted or paused', async () => {
  const debil = { id: 5, name: 'main', target: 'branch', enforcement: 'active', bypass_actors: [{ actor_id: 1, actor_type: 'Integration', bypass_mode: 'always' }], conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } }, rules: [{ type: 'deletion' }] };
  const fake = fakeGitHub({ demo: listo({ settings: { allow_auto_merge: true, delete_branch_on_merge: true }, files: ['README.md', '.github/workflows/tests.yml', '.github/workflows/revisor.yml', 'CLAUDE.md'], rulesets: [debil] }) });
  await correr(fake, proyectosDir(['demo']));
  assert.deepEqual(fake.gh.written.map((x) => `${x.method} ${x.path}`), ['PUT /repos/factory-am89/demo/rulesets/5']);
  assert.deepEqual(fake.gh.written[0].body, rulesetBody({ revisorAppId: APP_ID }));
  assert.ok(!fake.gh.written.some((x) => x.method === 'DELETE'));
});

test('only the four operations of the chunk can leave aplicar.mjs; the smoke ficha and secrets cannot', () => {
  assert.deepEqual(APPLY_OPS, ['update-settings', 'put-file', 'create-ruleset', 'update-ruleset']);
  const R = '/repos/factory-am89/demo';
  assert.throws(() => assertAllowed({ op: 'put-secret', method: 'PUT', path: `${R}/environments/revisor/secrets/REVISOR_APP_KEY` }), /no permitida/);
  assert.throws(() => assertAllowed({ op: 'put-file', method: 'PUT', path: `${R}/contents/.fabrica.json`, body: { branch: 'ops/fabrica-ficha' } }), /no permitida/);
  assert.throws(() => assertAllowed({ op: 'update-ruleset', method: 'DELETE', path: `${R}/rulesets/5` }), /no permitida/);
  assert.throws(() => assertAllowed({ op: 'create-repo', method: 'POST', path: '/orgs/factory-am89/repos' }), /no permitida/);
  assert.doesNotThrow(() => assertAllowed({ op: 'update-ruleset', method: 'PUT', path: `${R}/rulesets/5` }));
  const calls = [{ op: 'put-file', body: { branch: 'main' } }, { op: 'put-file', body: { branch: 'ops/fabrica-ficha' } }, { op: 'open-pr' }];
  assert.equal(applyCalls(calls).length, 1);
});

test('an error of the writer carries method, path and status, never the body', async () => {
  const fake = fakeGitHub({ demo: listo() });
  const f = async (url, init = {}) => ((init.method ?? 'GET') === 'GET' ? fake.fetchFn(url, init) : { ok: false, status: 403, text: async () => 'CUERPO-SECRETO' });
  await assert.rejects(() => main({ dir: proyectosDir(['demo']), templatesDir: path.join(RAIZ, 'apps', 'proyecto-nuevo'), readApi: makeApi('l', f), writeApi: makeWriteApi('a', f, assertAllowed) }), (e) => /403/.test(e.message) && !/CUERPO-SECRETO/.test(e.message));
});

// ---------- the real workflow: aplicar only after the secrets step succeeded ----------
const WORKFLOW = '.github/workflows/administrar.yml';

// [] when the steps of `texto` keep aplicar behind the secrets step; otherwise the reasons.
function ordenDeAplicar(texto) {
  const fallos = [];
  const doc = yaml.load(texto);
  const pasos = Object.values(doc.jobs).flatMap((j) => j.steps);
  const i = (pred) => pasos.findIndex(pred);
  const secretos = i((s) => s.id === 'secretos');
  const token = i((s) => s.id === 'aplicar');
  const corre = i((s) => String(s.run ?? '').includes('scripts/admin/aplicar.mjs'));
  if (secretos < 0 || token < 0 || corre < 0) return ['secretos, aplicar (token) or the aplicar.mjs step is missing'];
  if (!(secretos < token && token < corre)) fallos.push('order must be secretos, then the aplicar token, then aplicar.mjs');
  if (pasos[secretos]['continue-on-error'] !== undefined) fallos.push('the secrets step must not have continue-on-error');
  for (const k of [token, corre]) {
    if (pasos[k].if !== undefined) fallos.push(`step ${k} (aplicar) must have no if: a failed secrets step has to skip it`);
    if (pasos[k]['continue-on-error'] !== undefined) fallos.push(`step ${k} (aplicar) must not have continue-on-error`);
  }
  // Every step between secrets and aplicar.mjs runs only on success too: an `always()` there would not matter, but an `if` on a step
  // of the chain that lets the run go on after a failure would.
  for (const s of pasos.slice(secretos, corre + 1)) if (/always\(\)|failure\(\)|cancelled\(\)/.test(String(s.if ?? ''))) fallos.push('no always()/failure() between secretos and aplicar.mjs');
  const job = Object.values(doc.jobs)[0];
  if (job['continue-on-error'] !== undefined) fallos.push('the job must not have continue-on-error');
  return fallos;
}

test('the real workflow keeps aplicar behind the secrets step, with no if and no continue-on-error', () => {
  assert.deepEqual(ordenDeAplicar(readFileSync(path.join(RAIZ, WORKFLOW), 'utf8')), []);
});

test('red by mutation: if, continue-on-error or a changed order on the workflow are detected', () => {
  const real = readFileSync(path.join(RAIZ, WORKFLOW), 'utf8');
  const quita = (t, re) => { const r = t.replace(re, ''); assert.notEqual(r, t, `mutation anchor not found: ${re}`); return r; };
  const m1 = real.replace('      - id: aplicar\n', '      - id: aplicar\n        if: always()\n');
  assert.notEqual(m1, real);
  assert.match(ordenDeAplicar(m1).join('\n'), /no if/);
  const m2 = real.replace('      - id: secretos\n', '      - id: secretos\n        continue-on-error: true\n');
  assert.notEqual(m2, real);
  assert.match(ordenDeAplicar(m2).join('\n'), /secrets step must not have continue-on-error/);
  const m3 = real.replace('      - run: node scripts/admin/aplicar.mjs', '      - if: always()\n        run: node scripts/admin/aplicar.mjs');
  assert.notEqual(m3, real);
  assert.match(ordenDeAplicar(m3).join('\n'), /no if/);
  // aplicar token moved before the secrets step.
  const bloque = real.match(/ {6}# Trozo 6\.[\s\S]*?(?= {6}# Falla el run)/)[0];
  const m4 = quita(real, bloque).replace('      # Escribe el environment `revisor`', bloque + '      # Escribe el environment `revisor`');
  assert.match(ordenDeAplicar(m4).join('\n'), /order must be/);
});
