// scripts/admin/secretos.mjs (plans/app-admin.md, chunk 5): the `revisor` environment and its three secrets.
// A fake GitHub with a real state behind fetch, so the real makeApi / makeWriteApi run. Proven here: the secrets leave
// sealed and open with the environment private key; ONLY the three operations of the chunk are written; a missing value
// fails before the first write naming the names; no value reaches the output; a second run writes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sodium from 'libsodium-wrappers';
import yaml from 'js-yaml';
import { assertAllowed, main, makeWriteApi, missingValues, sealSecret, secretCalls } from '../scripts/admin/secretos.mjs';
import { makeApi } from '../scripts/admin/leer-plan.mjs';
import { REVISOR_SECRETS, parseProject, planProject } from '../scripts/admin/proyecto.mjs';
import { loadTemplates, readState } from '../scripts/admin/leer-plan.mjs';

const RAIZ = path.resolve(import.meta.dirname, '..');
const REPO = 'factory-am89/demo';
const R = `/repos/${REPO}`;
const PEM = '-----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END RSA PRIVATE KEY-----';
const VALUES = { REVISOR_APP_KEY: PEM, REVISOR_CLIENT_ID: 'Iv1.clientid-visible-nowhere', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-visible-nowhere' };

await sodium.ready;

function proyectosDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'secretos-'));
  writeFileSync(path.join(dir, 'demo.json'), JSON.stringify({ repo: REPO, visibilidad: 'publico', descripcion: 'demo' }));
  return dir;
}

// A fake GitHub: `gh.written` is every non-GET request; the environment and its secrets live in `gh`.
function fakeGitHub({ repoExists = true, env = null, secrets = [], failOn = null } = {}) {
  const keys = sodium.crypto_box_keypair();
  const gh = { env, secrets: Object.fromEntries(secrets.map((n) => [n, 'old'])), written: [], keys, keyId: 'k-1' };
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => 'SECRETO-EN-EL-CUERPO-DEL-ERROR' });
  const fetchFn = async (url, init = {}) => {
    const p = new URL(url).pathname;
    const method = init.method ?? 'GET';
    if (method !== 'GET') {
      gh.written.push({ method, path: p, body: init.body });
      if (failOn && p.endsWith(failOn)) return reply(403, null);
      if (p === `${R}/environments/revisor`) gh.env = { branches: gh.env?.branches ?? [], customBranchPolicies: true };
      else if (p === `${R}/environments/revisor/deployment-branch-policies`) gh.env.branches.push(JSON.parse(init.body).name);
      else if (p.startsWith(`${R}/environments/revisor/secrets/`)) gh.secrets[p.split('/').pop()] = JSON.parse(init.body);
      else throw new Error(`fake: unexpected write ${method} ${p}`);
      return reply(201, {});
    }
    const routes = {
      [R]: () => (repoExists ? reply(200, { private: false, allow_auto_merge: true, delete_branch_on_merge: true }) : reply(404, null)),
      '/installation/repositories': () => reply(200, { repositories: [{ full_name: REPO }] }),
      '/apps/fabrica-revisor': () => reply(200, { id: 1234567 }),
      [`${R}/git/trees/main`]: () => reply(200, { truncated: false, tree: [{ type: 'blob', path: 'README.md' }] }),
      [`${R}/commits/main`]: () => reply(200, { sha: 'a'.repeat(40) }),
      [`${R}/environments/revisor`]: () => (gh.env ? reply(200, { deployment_branch_policy: { custom_branch_policies: gh.env.customBranchPolicies } }) : reply(404, null)),
      [`${R}/environments/revisor/deployment-branch-policies`]: () => reply(200, { branch_policies: gh.env.branches.map((name) => ({ name })) }),
      [`${R}/environments/revisor/secrets`]: () => reply(200, { secrets: Object.keys(gh.secrets).map((name) => ({ name })) }),
      [`${R}/environments/revisor/secrets/public-key`]: () => reply(200, { key_id: gh.keyId, key: sodium.to_base64(gh.keys.publicKey, sodium.base64_variants.ORIGINAL) }),
      [`${R}/rulesets`]: () => reply(200, []),
      [`${R}/git/ref/heads/ops/fabrica-ficha`]: () => reply(404, null),
      [`${R}/pulls`]: () => reply(200, []),
    };
    if (!routes[p]) throw new Error(`fake: unexpected GET ${p}`);
    return routes[p]();
  };
  return { gh, fetchFn };
}

async function correr(fake, { env = VALUES, dir = proyectosDir(), summaryFile } = {}) {
  const out = [];
  const real = process.stdout.write;
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  try {
    await main({ dir, templatesDir: path.join(RAIZ, 'apps', 'proyecto-nuevo'), readApi: makeApi('lectura', fake.fetchFn), writeApi: makeWriteApi('escritura', fake.fetchFn), env, origin: 'EL-SITIO-DE-ORIGEN', summaryFile });
  } finally {
    process.stdout.write = real;
  }
  return out.join('');
}

test('a sealed secret opens only with the private key of the environment, and is not the plain value', async () => {
  const kp = sodium.crypto_box_keypair();
  const pub = sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL);
  const a = await sealSecret('valor-secreto', pub);
  const b = await sealSecret('valor-secreto', pub);
  assert.notEqual(a, b, 'a sealed box uses a fresh ephemeral key each time');
  assert.doesNotMatch(a, /valor-secreto/);
  const open = sodium.crypto_box_seal_open(sodium.from_base64(a, sodium.base64_variants.ORIGINAL), kp.publicKey, kp.privateKey);
  assert.equal(sodium.to_string(open), 'valor-secreto');
  await assert.rejects(sealSecret('x', sodium.to_base64(new Uint8Array(10), sodium.base64_variants.ORIGINAL)), /mide 10 bytes/);
});

test('an existing repo with no environment gets the environment, the branch policy and 3 sealed secrets, and nothing else', async () => {
  const fake = fakeGitHub();
  await correr(fake);
  assert.deepEqual(fake.gh.written.map((w) => `${w.method} ${w.path.replace(R, '')}`), [
    'PUT /environments/revisor',
    'POST /environments/revisor/deployment-branch-policies',
    ...REVISOR_SECRETS.map((n) => `PUT /environments/revisor/secrets/${n}`),
  ]);
  assert.deepEqual(fake.gh.env.branches, ['main']);
  for (const n of REVISOR_SECRETS) {
    const body = fake.gh.secrets[n];
    assert.equal(body.key_id, fake.gh.keyId);
    const open = sodium.crypto_box_seal_open(sodium.from_base64(body.encrypted_value, sodium.base64_variants.ORIGINAL), fake.gh.keys.publicKey, fake.gh.keys.privateKey);
    assert.equal(sodium.to_string(open), VALUES[n], n);
  }
});

test('a second run over the state the first left writes nothing', async () => {
  const fake = fakeGitHub();
  await correr(fake);
  const before = fake.gh.written.length;
  const out = await correr(fake);
  assert.equal(fake.gh.written.length, before);
  assert.match(out, /0 cambios/);
});

test('only the missing secrets are written when the rest are already there (values for the others are not needed)', async () => {
  const fake = fakeGitHub({ env: { branches: ['main'], customBranchPolicies: true }, secrets: ['CLAUDE_CODE_OAUTH_TOKEN', 'REVISOR_CLIENT_ID'] });
  await correr(fake, { env: { REVISOR_APP_KEY: PEM } });
  assert.deepEqual(fake.gh.written.map((w) => w.path.split('/').pop()), ['REVISOR_APP_KEY']);
});

// lesson: error-message-asserts-unproven-cause
test('a missing value fails BEFORE the first write, names the secret names and the place, and prints no value', async () => {
  const fake = fakeGitHub();
  const env = { REVISOR_APP_KEY: PEM, REVISOR_CLIENT_ID: '', CLAUDE_CODE_OAUTH_TOKEN: undefined };
  await assert.rejects(correr(fake, { env }), (e) => {
    assert.match(e.message, /faltan 2 secretos en EL-SITIO-DE-ORIGEN: CLAUDE_CODE_OAUTH_TOKEN, REVISOR_CLIENT_ID\./);
    assert.doesNotMatch(e.message, /REVISOR_APP_KEY|PRIVATE KEY|MIIEvQ/);
    return true;
  });
  assert.deepEqual(fake.gh.written, [], 'nothing is written when a value is missing');
});

test('no value, no sealed text and no PRIVATE KEY reach stdout or the summary file', async () => {
  const fake = fakeGitHub();
  const summaryFile = path.join(mkdtempSync(path.join(tmpdir(), 'secretos-')), 'summary.md');
  writeFileSync(summaryFile, '');
  const out = await correr(fake, { summaryFile });
  const todo = out + readFileSync(summaryFile, 'utf8');
  assert.match(todo, /put-secret REVISOR_APP_KEY/, 'the names do appear');
  assert.doesNotMatch(todo, /PRIVATE KEY|MIIEvQ|visible-nowhere/);
  for (const n of REVISOR_SECRETS) assert.ok(!todo.includes(fake.gh.secrets[n].encrypted_value), 'the sealed text is not printed either');
});

test('a write refused by GitHub is an error with method, path and status, and never the response body', async () => {
  const fake = fakeGitHub({ failOn: '/secrets/REVISOR_CLIENT_ID' });
  await assert.rejects(correr(fake), (e) => {
    assert.match(e.message, /PUT .*secrets\/REVISOR_CLIENT_ID -> 403/);
    assert.doesNotMatch(e.message, /SECRETO-EN-EL-CUERPO/);
    return true;
  });
});

test('a repo that does not exist is not created here', async () => {
  const fake = fakeGitHub({ repoExists: false });
  await assert.rejects(correr(fake), /no existe/);
  assert.deepEqual(fake.gh.written, []);
});

// Red by construction: each of these calls is in the plan of an unprotected repo and must NOT pass the door of this chunk.
test('the write door refuses every call of the plan that is not environment, branch policy or secret', async () => {
  const project = parseProject({ repo: REPO, visibilidad: 'publico', descripcion: 'demo' });
  const repo = { private: false, allow_auto_merge: false, delete_branch_on_merge: false };
  const state = { repo, files: ['package.json', 'package-lock.json'], environment: null, secretNames: [], rulesets: [], revisorAppId: 1, mainSha: 'a'.repeat(40), smoke: { branchExists: false, fileOnBranch: false, pr: null } };
  const todas = planProject(project, state, loadTemplates(path.join(RAIZ, 'apps', 'proyecto-nuevo')));
  const resto = todas.filter((c) => !secretCalls(todas).includes(c));
  assert.ok(resto.length >= 4, 'the plan has other operations to refuse');
  let fetched = 0;
  const writeApi = makeWriteApi('t', async () => { fetched += 1; return { ok: true, status: 200 }; });
  for (const c of resto) await assert.rejects(writeApi(c, c.body), /no permitida/, c.op);
  assert.equal(fetched, 0);
  // Right operation, wrong place: another environment, another method.
  assert.throws(() => assertAllowed({ op: 'put-secret', method: 'PUT', path: `${R}/environments/produccion/secrets/X` }), /no permitida/);
  assert.throws(() => assertAllowed({ op: 'put-secret', method: 'POST', path: `${R}/environments/revisor/secrets/X` }), /no permitida/);
  assert.throws(() => assertAllowed({ op: 'put-secret', method: 'PUT', path: '/orgs/factory-am89/actions/secrets/X' }), /no permitida/);
});

test('missingValues counts only the secrets the plan will write, by name', async () => {
  const project = parseProject({ repo: REPO, visibilidad: 'publico', descripcion: 'demo' });
  const fake = fakeGitHub({ env: { branches: ['main'], customBranchPolicies: true }, secrets: ['REVISOR_CLIENT_ID'] });
  const calls = planProject(project, await readState(makeApi('t', fake.fetchFn), project), loadTemplates(path.join(RAIZ, 'apps', 'proyecto-nuevo')));
  assert.deepEqual(missingValues(calls, {}), ['CLAUDE_CODE_OAUTH_TOKEN', 'REVISOR_APP_KEY']);
  assert.deepEqual(missingValues(calls, { ...VALUES }), []);
});

// ---- the real workflow: each token mints only what its step needs ----
const wf = yaml.load(readFileSync(path.join(RAIZ, '.github', 'workflows', 'administrar.yml'), 'utf8'));
const pasos = Object.values(wf.jobs).flatMap((j) => j.steps);
const permisosDe = (id) => Object.fromEntries(Object.entries(pasos.find((p) => p.id === id).with).filter(([k]) => k.startsWith('permission-')));

test('workflow: the reading token is read-only and the writing token has exactly what the environment and secrets API need', () => {
  for (const [k, v] of Object.entries(permisosDe('lectura'))) assert.equal(v, 'read', k);
  // From the GitHub permission table (server-to-server): PUT environment and POST branch policy need administration: write;
  // the public key and PUT secret of an environment need environments (read / write), not `secrets`.
  assert.deepEqual(permisosDe('escritura'), { 'permission-administration': 'write', 'permission-environments': 'write', 'permission-metadata': 'read' });
});

test('workflow: the reading token has administration: read, without it GitHub omits bypass_actors and the repo settings', () => {
  assert.equal(permisosDe('lectura')['permission-administration'], 'read');
});

test('workflow: the secrets step gets both tokens and the three values, and a later step fails the run if the log shows PRIVATE KEY', () => {
  const paso = pasos.find((p) => String(p.run ?? '').includes('scripts/admin/secretos.mjs'));
  assert.ok(paso, 'no step runs secretos.mjs');
  // The expected names come from REVISOR_SECRETS (one source): a fourth secret there that the workflow does not pass is red here.
  assert.deepEqual(Object.keys(paso.env).sort(), [...REVISOR_SECRETS, 'GH_TOKEN_ESCRITURA', 'GH_TOKEN_LECTURA', 'ORIGEN_SECRETOS'].sort());
  for (const n of REVISOR_SECRETS) assert.equal(paso.env[n], '$' + `{{ secrets.${n} }}`, n);
  const i = pasos.indexOf(paso);
  const guardia = pasos.slice(i + 1).find((p) => /PRIVATE KEY/.test(String(p.run ?? '')));
  assert.ok(guardia, 'no step greps the log for PRIVATE KEY');
  assert.match(String(guardia.if), /always\(\)/, 'it must run even when the secrets step fails');
  assert.match(guardia.run, /grep -q/);
});
