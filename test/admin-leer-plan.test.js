// scripts/admin/leer-plan.mjs (plans/app-admin.md, chunk 4): the read-only run. Fake GitHub, no network.
// Proven here: only GET leaves the module; an unprotected existing repo (homenu-panel) lists what it lacks;
// an App not installed on the repo fails loudly with that cause; the real proyectos/*.json parse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadTemplates, makeApi, readState, renderPlan } from '../scripts/admin/leer-plan.mjs';
import { hiddenFields, parseProject, planProject } from '../scripts/admin/proyecto.mjs';

const RAIZ = path.resolve(import.meta.dirname, '..');
const PROJECT = parseProject({ repo: 'factory-am89/demo', visibilidad: 'publico', descripcion: 'demo' });
const TEMPLATES = loadTemplates(path.join(RAIZ, 'apps', 'proyecto-nuevo'));

// A fake GitHub: routes map to [status, body]; unknown routes are a test failure.
function fakeApi(routes) {
  const seen = [];
  const api = async (route, allow = []) => {
    seen.push(route);
    const hit = Object.entries(routes).find(([k]) => route.split('?')[0] === k);
    if (!hit) throw new Error(`unexpected route ${route}`);
    const [status, body] = hit[1];
    if (status >= 400 && !allow.includes(status)) throw new Error(`GET ${route} -> ${status}`);
    return { status, body };
  };
  return { api, seen };
}

const UNPROTECTED = {
  '/repos/factory-am89/demo': [200, { private: false, allow_auto_merge: false, delete_branch_on_merge: false }],
  '/installation/repositories': [200, { repositories: [{ full_name: 'factory-am89/demo' }] }],
  '/apps/fabrica-revisor': [200, { id: 1234567 }],
  '/repos/factory-am89/demo/git/trees/main': [200, { truncated: false, tree: [{ type: 'blob', path: 'README.md' }] }],
  '/repos/factory-am89/demo/commits/main': [200, { sha: 'a'.repeat(40) }],
  '/repos/factory-am89/demo/environments/revisor': [404, null],
  '/repos/factory-am89/demo/rulesets': [200, []],
  '/repos/factory-am89/demo/git/ref/heads/ops/fabrica-ficha': [404, null],
  '/repos/factory-am89/demo/pulls': [200, []],
};

test('an existing unprotected repo lists what it lacks, and nothing is applied', async () => {
  const { api } = fakeApi(UNPROTECTED);
  const calls = planProject(PROJECT, await readState(api, PROJECT), TEMPLATES);
  const text = renderPlan(PROJECT, calls);
  assert.match(text, /create-ruleset/);
  assert.match(text, /put-secret/);
  assert.match(text, /NO aplica nada/);
  assert.doesNotMatch(text, /base64|"content"/, 'bodies (file contents) never reach the summary');
});

// lesson: error-message-asserts-unproven-cause
test('a repo the token does not see fails loudly saying what was observed and both possible causes, none asserted', async () => {
  const { api } = fakeApi({ ...UNPROTECTED, '/installation/repositories': [200, { repositories: [{ full_name: 'factory-am89/otro' }] }] });
  await assert.rejects(readState(api, PROJECT), (e) => {
    assert.match(e.message, /el token no ve factory-am89\/demo/);
    assert.match(e.message, /ve 1 repos/);
    assert.match(e.message, /factory-am89\/otro/);
    assert.match(e.message, /limitado a un repo/);
    assert.match(e.message, /no esta instalada/);
    assert.doesNotMatch(e.message, /eso lo hace Pablo/);
    return true;
  });
});

test('a 403 from GitHub is an error, never an empty answer', async () => {
  // Through the real makeApi: a fake fetch answers 403 for the rulesets route and 200 for the rest.
  const routes = { ...UNPROTECTED, '/repos/factory-am89/demo/rulesets': [403, null] };
  const fetchFn = async (url) => {
    const hit = routes[new URL(url).pathname];
    if (!hit) return { ok: false, status: 500, text: async () => 'unexpected route' };
    return { ok: hit[0] < 400, status: hit[0], json: async () => hit[1], text: async () => 'forbidden' };
  };
  await assert.rejects(readState(makeApi('t', fetchFn), PROJECT), /rulesets.*403/);
});

test('a 200 whose body is not JSON is an error, not an empty answer', async () => {
  const api = makeApi('t', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }));
  await assert.rejects(api('/repos/x/y'), /no es JSON/);
});

test('a list that fills its page stops in the open (no silent cut)', async () => {
  const full = Array.from({ length: 100 }, (_, i) => ({ id: i }));
  const { api } = fakeApi({ ...UNPROTECTED, '/repos/factory-am89/demo/rulesets': [200, full] });
  await assert.rejects(readState(api, PROJECT), /no pagina/);
});

test('makeApi sends GET only', async () => {
  const sent = [];
  const api = makeApi('t', async (url, init) => { sent.push(init.method); return { ok: true, status: 200, json: async () => ({}) }; });
  await api('/repos/x/y');
  assert.deepEqual(sent, ['GET']);
});

test('the real proyectos/*.json obey the schema and are named after their repo', () => {
  const dir = path.join(RAIZ, 'proyectos');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 1);
  for (const f of files) parseProject(JSON.parse(readFileSync(path.join(dir, f), 'utf8')), { fileName: f });
});

const FIX = (n) => JSON.parse(readFileSync(path.join(RAIZ, 'test', 'fixtures', 'admin', n), 'utf8'));

// lesson: absent-field-read-as-default
test('read-only run: a repo answer without allow_auto_merge / delete_branch_on_merge is «no visible» (null), not false, and the summary says so', async () => {
  const { api } = fakeApi({ ...UNPROTECTED, '/repos/factory-am89/demo': [200, { private: false }] });
  const state = await readState(api, PROJECT);
  assert.equal(state.repo.allow_auto_merge, null);
  assert.equal(state.repo.delete_branch_on_merge, null);
  const calls = planProject(PROJECT, state, TEMPLATES);
  assert.ok(!calls.some((c) => c.op === 'update-settings'), 'a hidden setting is not asked for');
  assert.match(renderPlan(PROJECT, calls, hiddenFields(state)), /No visible con el token de lectura.*allow_auto_merge/);
  assert.match(renderPlan(PROJECT, [], hiddenFields(state)), /0 cambios visibles/);
  assert.doesNotMatch(renderPlan(PROJECT, [], hiddenFields(state)), /ya esta como dice/);
});

test('read-only run: the real ruleset shape without bypass_actors is flagged bypassHidden (bypass_actors is not made up as [])', async () => {
  const real = FIX('ruleset-real-sin-bypass.json');
  assert.equal('bypass_actors' in real, false);
  const { api } = fakeApi({ ...UNPROTECTED, '/repos/factory-am89/demo/rulesets': [200, [{ id: real.id }]], [`/repos/factory-am89/demo/rulesets/${real.id}`]: [200, real] });
  const state = await readState(api, PROJECT);
  assert.equal(state.rulesets[0].bypassHidden, true);
  assert.equal('bypass_actors' in state.rulesets[0], false);
  assert.deepEqual(hiddenFields(state), [`bypass_actors del ruleset ${real.id}`]);
});

test('with the aplicar token (settingsApi) both reads go through it, and a field it does not return either fails loudly', async () => {
  const real = FIX('ruleset-real-sin-bypass.json');
  const rsRoute = `/repos/factory-am89/demo/rulesets/${real.id}`;
  const lectura = fakeApi({ ...UNPROTECTED, '/repos/factory-am89/demo': [200, { private: false }], '/repos/factory-am89/demo/rulesets': [200, [{ id: real.id }]] });
  const repoReal = FIX('repo-real-con-ajustes.json');
  const ok = fakeApi({ '/repos/factory-am89/demo': [200, repoReal], [rsRoute]: [200, { ...real, bypass_actors: [] }] });
  const state = await readState(lectura.api, PROJECT, { settingsApi: ok.api });
  assert.equal(state.repo.allow_auto_merge, true);
  assert.deepEqual(state.rulesets[0].bypass_actors, []);
  assert.ok(!lectura.seen.includes(rsRoute), 'the ruleset body is not read with the lectura token');
  const noSettings = fakeApi({ '/repos/factory-am89/demo': [200, { private: false }] });
  await assert.rejects(readState(lectura.api, PROJECT, { settingsApi: noSettings.api }), /no trae allow_auto_merge ni con el token de aplicar/);
  const noBypass = fakeApi({ '/repos/factory-am89/demo': [200, repoReal], [rsRoute]: [200, real] });
  await assert.rejects(readState(lectura.api, PROJECT, { settingsApi: noBypass.api }), /no trae bypass_actors ni con el token de aplicar/);
});

// lesson: permission-change-asked-on-unproven-diagnosis
test('no message in scripts/admin names a permission as the cause of a missing field (#96 did, #97 asked Pablo for it, it did not fix it)', () => {
  const dir = path.join(RAIZ, 'scripts', 'admin');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
    const text = readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(text, /sin permiso administration|(omite|oculta|esconde)[^\n]*sin permiso/, `${f}: a message asserts a permission as the cause`);
  }
});
