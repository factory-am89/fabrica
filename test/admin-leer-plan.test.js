// scripts/admin/leer-plan.mjs (plans/app-admin.md, chunk 4): the read-only run. Fake GitHub, no network.
// Proven here: only GET leaves the module; an unprotected existing repo (homenu-panel) lists what it lacks;
// an App not installed on the repo fails loudly with that cause; the real proyectos/*.json parse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadTemplates, makeApi, readState, renderPlan } from '../scripts/admin/leer-plan.mjs';
import { parseProject, planProject } from '../scripts/admin/proyecto.mjs';

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

// lesson: absent-field-read-as-default
test('a repo answer without allow_auto_merge / delete_branch_on_merge is not read as false: planning it fails loudly', async () => {
  const { api } = fakeApi({ ...UNPROTECTED, '/repos/factory-am89/demo': [200, { private: false }] });
  const state = await readState(api, PROJECT);
  assert.throws(() => planProject(PROJECT, state, TEMPLATES), /administration: read/);
});
