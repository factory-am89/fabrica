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

test('the App not installed on the repo fails loudly with that cause (a public repo is readable anyway)', async () => {
  const { api } = fakeApi({ ...UNPROTECTED, '/installation/repositories': [200, { repositories: [{ full_name: 'factory-am89/otro' }] }] });
  await assert.rejects(readState(api, PROJECT), /no esta instalada en factory-am89\/demo/);
});

test('a 403 from GitHub is an error, never an empty answer', async () => {
  const { api } = fakeApi({ ...UNPROTECTED, '/repos/factory-am89/demo/rulesets': [403, null] });
  await assert.rejects(readState(api, PROJECT), /403/);
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
