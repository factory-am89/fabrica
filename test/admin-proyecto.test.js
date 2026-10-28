// scripts/admin/proyecto.mjs (plans/app-admin.md, chunk 3): from (real state, proyectos/<x>.json) to the list of
// calls the administrator workflow may make. Pure: no network, no clock, no disk besides the templates it reads.
// The plan's Done, one test each: new repo; existing unprotected repo (homenu-panel case); private repo fails with
// «plan gratuito»; a second pass over a complete state makes 0 writes; no output has a DELETE or a non-empty bypass_actors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import yaml from 'js-yaml';
import { REPO } from '../scripts/lib/repo.mjs';
import { NOMBRE_FICHA } from '../scripts/lib/repo-card.mjs';
import {
  ACTIONS_APP_ID, ALLOWED_CALLS, FICHA, PROJECT_FILES, REVISOR_SECRETS, ORG, hiddenFields, parseProject, planProject, rulesetBody,
} from '../scripts/admin/proyecto.mjs';

const RAIZ = path.resolve(import.meta.dirname, '..');
const PLANTILLAS = path.join(RAIZ, 'apps', 'proyecto-nuevo');
const leer = (...r) => readFileSync(path.join(...r), 'utf8');

const TEMPLATES = {
  'tests.yml': leer(PLANTILLAS, 'tests.yml'),
  'revisor.yml': leer(PLANTILLAS, 'revisor.yml'),
  'CLAUDE.md': leer(PLANTILLAS, 'CLAUDE.md'),
  'ficha.json': leer(PLANTILLAS, 'ficha.json'),
  'package.json': leer(PLANTILLAS, 'package.json'),
  'package-lock.json': leer(PLANTILLAS, 'package-lock.json'),
  'arranque.test.js.txt': leer(PLANTILLAS, 'arranque.test.js.txt'),
};
const REVISOR_APP_ID = 1234567;
const PROJECT = { repo: 'factory-am89/demo', visibilidad: 'publico', descripcion: 'Proyecto de prueba' };
const WORKFLOWS_Y_CLAUDE = ['.github/workflows/tests.yml', '.github/workflows/revisor.yml', 'CLAUDE.md'];

// A complete real state for PROJECT: nothing left to do.
function completo() {
  return {
    repo: { private: false, allow_auto_merge: true, delete_branch_on_merge: true },
    files: [...WORKFLOWS_Y_CLAUDE, 'package.json', 'package-lock.json', '.fabrica.json'],
    environment: { customBranchPolicies: true, branches: ['main'] },
    secretNames: [...REVISOR_SECRETS],
    rulesets: [{ id: 42, ...rulesetBody({ revisorAppId: REVISOR_APP_ID }) }],
    revisorAppId: REVISOR_APP_ID,
    mainSha: 'a'.repeat(40),
    smoke: { branchExists: false, fileOnBranch: false, pr: null },
  };
}
const nuevo = () => ({ ...completo(), repo: null, files: [], environment: null, secretNames: [], rulesets: [] });
// homenu-panel today: public, has its files from the old script but no settings, environment, secrets nor ruleset.
const sinProteger = () => ({
  ...completo(),
  repo: { private: false, allow_auto_merge: false, delete_branch_on_merge: false },
  files: ['package.json', 'package-lock.json', 'CLAUDE.md'],
  environment: null, secretNames: [], rulesets: [],
});

const ops = (calls) => calls.map((c) => c.op);
const plan = (state, project = PROJECT) => planProject(parseProject(project), state, TEMPLATES);

// Every input of the tests, for the property below.
function entradas() {
  const abierto = { number: 3, nodeId: 'PR_x', state: 'open', merged: false, autoMerge: false };
  const conPr = (pr) => ({ ...completo(), files: WORKFLOWS_Y_CLAUDE.concat('package.json', 'package-lock.json'), smoke: { branchExists: true, fileOnBranch: true, pr } });
  return [
    nuevo(), sinProteger(), completo(),
    { ...completo(), rulesets: [{ id: 7, ...rulesetBody({ revisorAppId: REVISOR_APP_ID }), enforcement: 'evaluate' }] },
    { ...completo(), rulesets: [{ id: 7, name: 'main', enforcement: 'active', bypass_actors: [{ actor_id: 5 }], rules: [] }] },
    { ...completo(), files: ['package.json', 'package-lock.json'], smoke: { branchExists: false, fileOnBranch: false, pr: null } },
    conPr(abierto),
    conPr({ ...abierto, autoMerge: true }),
  ];
}

test('new repo: creates it public, then files, settings, environment, secrets, ruleset and smoke PR, in that order', () => {
  const calls = plan(nuevo());
  assert.deepEqual(ops(calls), [
    'create-repo',
    'put-file', 'put-file', 'put-file', 'put-file', 'put-file', 'put-file', // tests.yml, revisor.yml, CLAUDE.md, package.json, package-lock.json, test/arranque.test.js
    'update-settings', 'put-environment', 'add-branch-policy',
    'put-secret', 'put-secret', 'put-secret',
    'create-ruleset',
    'create-ref', 'put-file', 'open-pr',
  ]);
  const crear = calls[0];
  assert.equal(crear.method, 'POST');
  assert.equal(crear.path, `/orgs/${ORG}/repos`);
  assert.deepEqual(crear.body, { name: 'demo', description: 'Proyecto de prueba', private: false, auto_init: true });
  const puts = calls.filter((c) => c.op === 'put-file');
  assert.deepEqual(puts.slice(0, 6).map((c) => c.path.split('/contents/')[1]), [...WORKFLOWS_Y_CLAUDE, 'package.json', 'package-lock.json', 'test/arranque.test.js']);
  const claude = Buffer.from(puts[2].body.content, 'base64').toString('utf8');
  assert.match(claude, /^# demo$/m, 'the template placeholders are filled in');
  assert.ok(!/__REPO__|__NOMBRE__/.test(claude));
  assert.equal(puts[2].body.branch, 'main');
  const ficha = JSON.parse(Buffer.from(puts[6].body.content, 'base64').toString('utf8'));
  assert.equal(ficha.repo, 'factory-am89/demo', '.fabrica.json goes in the smoke PR, never straight to main');
  assert.equal(puts[6].body.branch, 'ops/fabrica-ficha');
  assert.deepEqual(calls.filter((c) => c.op === 'put-secret').map((c) => c.path.split('/').pop()), [...REVISOR_SECRETS]);
  const regla = calls.find((c) => c.op === 'create-ruleset');
  assert.deepEqual(regla.body, rulesetBody({ revisorAppId: REVISOR_APP_ID }));
  assert.equal(calls.find((c) => c.op === 'create-ref').body.sha, 'a'.repeat(40));
});

test('the real state of a repo that does not exist has no sha of main: the plan still works and leaves the smoke PR for the next reading', () => {
  const real = { ...nuevo(), mainSha: null };
  const orden = ops(plan(real));
  assert.equal(orden[0], 'create-repo');
  assert.ok(orden.includes('create-ruleset'));
  assert.ok(!orden.includes('create-ref') && !orden.includes('open-pr'), 'no sha, no branch for the smoke PR yet');
  assert.throws(() => plan({ ...nuevo(), mainSha: 'abc' }), /estado\.mainSha/, 'a sha that is not 40 characters is still refused');
});

test('a repo GitHub just created with auto_init (only its README) still gets the package files and the start test; one with anything else does not', () => {
  const recienCreado = { ...nuevo(), repo: { private: false, allow_auto_merge: false, delete_branch_on_merge: false }, files: ['README.md'] };
  const subidos = (state) => plan(state).filter((c) => c.op === 'put-file' && c.body.branch === 'main').map((c) => c.path.split('/contents/')[1]);
  assert.deepEqual(subidos(recienCreado), [...WORKFLOWS_Y_CLAUDE, 'package.json', 'package-lock.json', 'test/arranque.test.js']);
  assert.deepEqual(subidos({ ...recienCreado, files: ['README.md', 'index.js'] }), WORKFLOWS_Y_CLAUDE, 'a repo with code of its own keeps its package files');
  assert.ok(!ops(plan(recienCreado)).includes('create-repo'), 'the repo exists now');
});

test('existing unprotected repo (homenu-panel): adopts it, creates nothing, writes only what is missing', () => {
  const calls = plan(sinProteger(), { ...PROJECT, repo: 'factory-am89/homenu-panel' });
  assert.ok(!ops(calls).includes('create-repo'), 'an existing repo is adopted, not created');
  const subidos = calls.filter((c) => c.op === 'put-file' && c.body.branch === 'main').map((c) => c.path.split('/contents/')[1]);
  assert.deepEqual(subidos, ['.github/workflows/tests.yml', '.github/workflows/revisor.yml'], 'CLAUDE.md and the package files are already there; no overwrite');
  assert.deepEqual(calls.find((c) => c.op === 'update-settings').body, { allow_auto_merge: true, delete_branch_on_merge: true });
  const orden = ops(calls);
  assert.ok(orden.indexOf('put-secret') < orden.indexOf('create-ruleset'), 'secrets before the ruleset (D2): else the PRs stay blocked');
  assert.ok(orden.includes('create-ruleset') && orden.includes('open-pr'));
  assert.match(calls.find((c) => c.op === 'put-environment').path, /\/homenu-panel\/environments\/revisor$/);
});

test('a ruleset that exists but is weaker is replaced by the full body (never paused, never deleted)', () => {
  for (const flojo of [{ enforcement: 'evaluate' }, { bypass_actors: [{ actor_id: 5, actor_type: 'Team' }] }, { rules: [] }]) {
    const s = { ...completo(), rulesets: [{ id: 7, ...rulesetBody({ revisorAppId: REVISOR_APP_ID }), ...flojo }] };
    const calls = plan(s);
    assert.deepEqual(ops(calls), ['update-ruleset']);
    assert.equal(calls[0].method, 'PUT');
    assert.equal(calls[0].path, '/repos/factory-am89/demo/rulesets/7');
    assert.deepEqual(calls[0].body, rulesetBody({ revisorAppId: REVISOR_APP_ID }));
  }
});

test('a ruleset GitHub returns with extra fields still counts as complete', () => {
  const real = structuredClone(rulesetBody({ revisorAppId: REVISOR_APP_ID }));
  real.rules[0].parameters.allowed_merge_methods = ['merge', 'squash', 'rebase'];
  real.source_type = 'Repository';
  real.rules.push({ type: 'update' });
  assert.deepEqual(plan({ ...completo(), rulesets: [{ id: 9, ...real }] }), []);
});

test('private repo fails loudly with «plan gratuito», from the file and from the real state', () => {
  assert.throws(() => parseProject({ ...PROJECT, visibilidad: 'privado' }), /plan gratuito/);
  const privado = { ...completo(), repo: { private: true, allow_auto_merge: true, delete_branch_on_merge: true } };
  assert.throws(() => plan(privado), /plan gratuito/);
});

test('second pass over a complete state makes 0 writes', () => {
  assert.deepEqual(plan(completo()), []);
});

test('a smoke PR in each stage: open without auto-merge is armed; armed or merged does nothing; closed unmerged fails', () => {
  const base = { ...completo(), files: WORKFLOWS_Y_CLAUDE.concat('package.json', 'package-lock.json') };
  const abierto = { number: 3, nodeId: 'PR_x', state: 'open', merged: false, autoMerge: false };
  const smoke = (pr, extra = {}) => ({ ...base, smoke: { branchExists: true, fileOnBranch: true, pr, ...extra } });
  assert.deepEqual(ops(plan(smoke(abierto))), ['arm-auto-merge']);
  assert.equal(plan(smoke(abierto))[0].body.pullRequestId, 'PR_x');
  assert.deepEqual(plan(smoke({ ...abierto, autoMerge: true })), []);
  assert.deepEqual(plan(smoke({ ...abierto, state: 'closed', merged: true })), []);
  assert.throws(() => plan(smoke({ ...abierto, state: 'closed' })), /cerrado sin fusionar/);
  assert.deepEqual(ops(plan({ ...base, smoke: { branchExists: true, fileOnBranch: false, pr: null } })), ['put-file', 'open-pr']);
});

test('property: over every test input no call is a DELETE, none has a non-empty bypass_actors, every call is on the allowed list', () => {
  const permitidas = new Set(ALLOWED_CALLS.map((a) => a.op));
  assert.ok(!ALLOWED_CALLS.some((a) => a.method === 'DELETE'));
  let vistas = 0;
  for (const s of entradas()) {
    const calls = plan(s);
    for (const c of calls) {
      vistas += 1;
      assert.ok(permitidas.has(c.op), `op ${c.op} is not on the allowed list`);
      const permitida = ALLOWED_CALLS.find((a) => a.op === c.op);
      assert.equal(c.method, permitida.method);
      assert.ok(permitida.path.test(c.path), `${c.op}: path ${c.path} does not match the allowed form`);
      assert.notEqual(c.method.toUpperCase(), 'DELETE');
    }
    assert.ok(!/\bDELETE\b/.test(JSON.stringify(calls)), 'no DELETE anywhere in the output');
    const buscar = (v) => {
      if (Array.isArray(v)) v.forEach(buscar);
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (k === 'bypass_actors') assert.deepEqual(x, [], 'bypass_actors must be empty');
          else buscar(x);
        }
      }
    };
    buscar(calls);
    for (const c of calls.filter((x) => x.op === 'create-ruleset' || x.op === 'update-ruleset')) assert.equal(c.body.enforcement, 'active');
  }
  assert.ok(vistas > 20, `the property looked at ${vistas} calls; too few to mean anything`);
});

test('ruleset body: tests / tests from Actions and revisor from its App, PR required, no force push, no deletion, no bypass', () => {
  const b = rulesetBody({ revisorAppId: REVISOR_APP_ID });
  assert.equal(b.enforcement, 'active');
  assert.deepEqual(b.bypass_actors, []);
  assert.deepEqual(b.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  assert.deepEqual(b.rules.map((r) => r.type), ['pull_request', 'required_status_checks', 'non_fast_forward', 'deletion']);
  assert.deepEqual(b.rules[1].parameters.required_status_checks, [
    { context: 'tests / tests', integration_id: ACTIONS_APP_ID },
    { context: 'revisor', integration_id: REVISOR_APP_ID },
  ]);
  assert.throws(() => rulesetBody({}), /revisorAppId/);
  assert.throws(() => rulesetBody({ revisorAppId: 'x' }), /revisorAppId/);
});

test('ruleset body equals Cuerpo-Ruleset in apps/lib-gh.ps1 in rule types, PR parameters with their values and checks (until that copy is retired)', () => {
  const ps = leer(RAIZ, 'apps', 'lib-gh.ps1');
  const desde = ps.slice(ps.indexOf('function Cuerpo-Ruleset'));
  const cuerpo = desde.slice(0, desde.indexOf('# ---------- llavero'));
  const tipos = [...cuerpo.matchAll(/type = '([a-z_]+)'/g)].map((m) => m[1]);
  const b = rulesetBody({ revisorAppId: REVISOR_APP_ID });
  assert.deepEqual(b.rules.map((r) => r.type), tipos);
  const bloquePr = cuerpo.slice(cuerpo.indexOf("type = 'pull_request'"), cuerpo.indexOf("type = 'required_status_checks'"));
  const valor = { 0: 0, $false: false, $true: true };
  const delPs = Object.fromEntries([...bloquePr.matchAll(/(\w+)\s*=\s*(0|\$false|\$true)(?![\w])/g)].map((m) => [m[1], valor[m[2]]]));
  assert.deepEqual(b.rules[0].parameters, delPs, 'the PR parameters (names and values) differ from the PowerShell copy');
  assert.match(cuerpo, /enforcement\s*=\s*'active'/);
  assert.match(cuerpo, /bypass_actors\s*=\s*@\(\)/);
  assert.match(cuerpo, /ref_name = @\{ include = @\('~DEFAULT_BRANCH'\)/);
  assert.match(cuerpo, /context = \$ContextoTests; integration_id = \$IdActions/);
  assert.match(cuerpo, /context = 'revisor'; integration_id = \$IdRevisor/);
});

test('the Actions App id is the one apps/ruleset.ps1 uses (until that copy is retired), and is the known 15368', () => {
  const m = leer(RAIZ, 'apps', 'ruleset.ps1').match(/\$IdGitHubActions\s*=\s*(\d+)/);
  assert.ok(m, 'cannot find $IdGitHubActions in apps/ruleset.ps1');
  assert.equal(ACTIONS_APP_ID, Number(m[1]));
  assert.equal(ACTIONS_APP_ID, 15368);
});

test('the card file name and the organization are the ones the rest of the Factory uses (scripts/admin/ imports nothing: it runs with the key)', () => {
  assert.equal(FICHA, NOMBRE_FICHA);
  assert.equal(ORG, REPO.split('/')[0]);
});

test('SecretosRevisor and ArchivosProyecto in apps/lib-proyecto.ps1 list what this module lists (until chunk 10 deletes them)', () => {
  const lib = leer(RAIZ, 'apps', 'lib-proyecto.ps1');
  const secretos = [...lib.match(/\$script:SecretosRevisor = @\(([^)]*)\)/)[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(secretos, [...REVISOR_SECRETS]);
  const archivos = [...lib.matchAll(/Ruta = '([^']+)'; Plantilla = '([^']+)'/g)].map((m) => [m[1], m[2]]);
  const mios = PROJECT_FILES.filter((f) => !f.soloVacio).map((f) => [f.path, f.template]).concat([[FICHA, 'ficha.json']]);
  assert.deepEqual(archivos, mios);
});

test('the secrets the project gets are the ones revisor.yml declares in workflow_call', () => {
  const declarados = Object.keys(yaml.load(leer(RAIZ, '.github', 'workflows', 'revisor.yml')).on.workflow_call.secrets).sort();
  assert.deepEqual([...REVISOR_SECRETS].sort(), declarados);
});

test('schema: the file has exactly repo, visibilidad and descripcion; anything else fails loudly', () => {
  assert.deepEqual(parseProject(PROJECT, { fileName: 'demo.json' }), { repo: 'factory-am89/demo', owner: 'factory-am89', name: 'demo', visibilidad: 'publico', descripcion: 'Proyecto de prueba' });
  const casos = [
    [{ ...PROJECT, extra: 1 }, /clave desconocida.*extra/],
    [{ repo: PROJECT.repo, visibilidad: 'publico' }, /falta.*descripcion/],
    [{ ...PROJECT, repo: 'otro-dueno/demo' }, /factory-am89/],
    [{ ...PROJECT, repo: 'demo' }, /dueno\/nombre/],
    [{ ...PROJECT, repo: 'factory-am89/de mo' }, /dueno\/nombre/],
    [{ ...PROJECT, visibilidad: 'secreto' }, /visibilidad/],
    [{ ...PROJECT, descripcion: '' }, /descripcion/],
    [{ ...PROJECT, descripcion: 5 }, /descripcion/],
    [['x'], /objeto/],
    [null, /objeto/],
  ];
  for (const [entrada, motivo] of casos) assert.throws(() => parseProject(entrada), motivo);
  assert.throws(() => parseProject(PROJECT, { fileName: 'otro.json' }), /demo\.json/, 'the file name must be the repo name');
});

test('the real state is validated too: malformed state, missing template and missing reviewer App id fail loudly', () => {
  assert.throws(() => plan({ ...completo(), files: 'x' }), /files/);
  assert.throws(() => plan({ ...completo(), repo: { private: 'no' } }), /repo/);
  assert.throws(() => plan({ ...completo(), revisorAppId: undefined }), /revisorAppId/);
  assert.throws(() => plan({ ...completo(), rulesets: [{ name: 'main' }] }), /id numerico/);
  assert.throws(() => planProject(parseProject(PROJECT), { ...completo(), files: [] }, { ...TEMPLATES, 'tests.yml': undefined }), /tests\.yml/);
  assert.throws(() => plan({ ...completo(), surprise: 1 }), /surprise/);
});

// Real object: GET /repos/factory-am89/homenu-panel/rulesets/25340020 as the constructor App's token saw it, minutes after
// aplicar.mjs created it (run 39120720719). It has no bypass_actors key at all: GitHub only returns it to a caller with write access
// to the ruleset. Before this check, covers() read the absent key as "not empty" and aplicar.mjs asked for
// update-ruleset forever (its second read threw «tras escribir aun faltan ... update-ruleset»).
const RULESET_REAL = JSON.parse(leer(RAIZ, 'test', 'fixtures', 'admin', 'ruleset-real-sin-bypass.json'));
const REVISOR_REAL = 5332150;
const conRulesetReal = (extra = {}) => ({ ...completo(), revisorAppId: REVISOR_REAL, rulesets: [{ ...RULESET_REAL, ...extra }] });

test('a ruleset whose bypass_actors is absent (not classified as null) fails loudly: absent is not empty and not drift', () => {
  assert.throws(() => plan(conRulesetReal()), /sin bypass_actors.*ausente no se da por vacio/);
});

test('a ruleset with bypassHidden (bypass_actors not visible to the token) is compared without it, listed as hidden, and never called complete', () => {
  const hidden = conRulesetReal({ bypassHidden: true });
  assert.deepEqual(plan(hidden), []);
  assert.deepEqual(hiddenFields(hidden), [`bypass_actors del ruleset ${RULESET_REAL.id}`]);
  // The rest still counts: a weaker ruleset with hidden bypass is replaced.
  assert.deepEqual(ops(plan(conRulesetReal({ bypassHidden: true, rules: [] }))), ['update-ruleset']);
  // A visible non-empty bypass is never accepted.
  assert.deepEqual(ops(plan(conRulesetReal({ bypass_actors: [{ actor_id: 5, actor_type: 'Team', bypass_mode: 'always' }] }))), ['update-ruleset']);
});

test('the real ruleset seen with its bypass_actors empty is complete (0 calls); with a bypass it is replaced', () => {
  assert.deepEqual(plan(conRulesetReal({ bypass_actors: [] })), []);
  assert.deepEqual(ops(plan(conRulesetReal({ bypass_actors: [{ actor_id: 5, actor_type: 'Team', bypass_mode: 'always' }] }))), ['update-ruleset']);
});

test('a repo state without the two settings fails loudly, never read as false', () => {
  assert.throws(() => plan({ ...completo(), repo: { private: false } }), /ausente no se da por falso/);
});

// Real shape: GET /repos/factory-am89/homenu-panel with the constructor App token (contents write, no administration), 2026-10-19:
// the merge settings ARE there (true) although permissions.push is false. See repo-real-con-ajustes.json.
const REPO_REAL = JSON.parse(leer(RAIZ, 'test', 'fixtures', 'admin', 'repo-real-con-ajustes.json'));

test('settings: null (not visible) asks for no PATCH and is listed as hidden; a visible false asks for it; the real shape is complete', () => {
  const base = { ...completo(), repo: { private: false, allow_auto_merge: null, delete_branch_on_merge: null } };
  assert.deepEqual(plan(base), []);
  assert.deepEqual(hiddenFields(base), ['ajustes allow_auto_merge y delete_branch_on_merge']);
  assert.deepEqual(ops(plan({ ...base, repo: { private: false, allow_auto_merge: null, delete_branch_on_merge: false } })), ['update-settings']);
  const real = { ...completo(), repo: { private: REPO_REAL.private, allow_auto_merge: REPO_REAL.allow_auto_merge, delete_branch_on_merge: REPO_REAL.delete_branch_on_merge } };
  assert.deepEqual(plan(real), []);
  assert.deepEqual(hiddenFields(real), []);
});

// plans/puente-1, trozo 8: el cuerpo para la rama buena de otro repo (HoMenu: staging) sale del mismo rulesetBody.
test('ruleset body: strict and name are parameters; by default nothing changes, and the rest stays closed', () => {
  const porDefecto = rulesetBody({ revisorAppId: REVISOR_APP_ID });
  assert.equal(porDefecto.name, 'main');
  assert.equal(porDefecto.rules[1].parameters.strict_required_status_checks_policy, false);
  const staging = rulesetBody({ revisorAppId: REVISOR_APP_ID, strict: true, name: 'staging', testsContext: 'tests' });
  assert.equal(staging.name, 'staging');
  assert.equal(staging.rules[1].parameters.strict_required_status_checks_policy, true);
  assert.equal(staging.enforcement, 'active');
  assert.deepEqual(staging.bypass_actors, []);
  assert.deepEqual(staging.rules[1].parameters.required_status_checks, [
    { context: 'tests', integration_id: ACTIONS_APP_ID },
    { context: 'revisor', integration_id: REVISOR_APP_ID },
  ]);
  assert.throws(() => rulesetBody({ revisorAppId: REVISOR_APP_ID, strict: 'si' }), /strict/);
  assert.throws(() => rulesetBody({ revisorAppId: REVISOR_APP_ID, name: '' }), /name/);
});

test('cuerpo-ruleset.mjs prints the JSON body for the given branch and fails loud without --app-id', () => {
  const orden = (...args) => spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'admin', 'cuerpo-ruleset.mjs'), ...args], { encoding: 'utf8' });
  const ok = orden('--app-id', String(REVISOR_APP_ID), '--name', 'staging', '--strict', '--tests-context', 'tests');
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), rulesetBody({ revisorAppId: REVISOR_APP_ID, strict: true, name: 'staging', testsContext: 'tests' }));
  assert.deepEqual(JSON.parse(orden('--app-id', String(REVISOR_APP_ID)).stdout), rulesetBody({ revisorAppId: REVISOR_APP_ID }));
  const sin = orden();
  assert.notEqual(sin.status, 0);
  assert.match(sin.stderr, /--app-id/);
  assert.equal(sin.stdout, '');
});
