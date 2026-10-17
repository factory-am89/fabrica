// Pure logic of the administrator workflow (plans/app-admin.md, chunk 3): from (the real state of a repo,
// proyectos/<x>.json) to the ordered list of calls to GitHub that bring the repo to the wanted state. Nothing
// here talks to GitHub, reads the disk or the clock: the caller reads the state, passes the templates and
// executes the calls (chunks 4 to 8). Run twice over the state the first run left, it returns [].
//
// This file is a gate file (scripts/lib/gate.mjs, folder scripts/admin/).
// The machine guard of the key (chunk 2) scans it: no deletion, no bypass, no ruleset that is not `active`.
//
// Single source of the body of the `main` ruleset (rulesetBody), of the secrets of the `revisor` environment and of
// the files a project gets. Their copies in apps/ (Cuerpo-Ruleset in lib-gh.ps1, SecretosRevisor and ArchivosProyecto
// in lib-proyecto.ps1) are retired in chunk 10; test/admin-proyecto.test.js ties the copies to this file meanwhile.
export const ORG = 'factory-am89';
export const REVISOR_SECRETS = ['CLAUDE_CODE_OAUTH_TOKEN', 'REVISOR_CLIENT_ID', 'REVISOR_APP_KEY'];
export const ACTIONS_APP_ID = 15368; // GitHub Actions: where the `tests / tests` check comes from
export const SMOKE_BRANCH = 'ops/fabrica-ficha';
export const REVISOR_ENV = 'revisor';
export const FICHA = '.fabrica.json';

// Files left straight on `main` BEFORE protecting it (a PR cannot be judged in a repo with no reviewer yet).
// `soloVacio`: only for an empty repo, which `tests.yml` needs to run. `.fabrica.json` is not here: it is the smoke PR.
export const PROJECT_FILES = [
  { path: '.github/workflows/tests.yml', template: 'tests.yml' },
  { path: '.github/workflows/revisor.yml', template: 'revisor.yml' },
  { path: 'CLAUDE.md', template: 'CLAUDE.md' },
  { path: 'package.json', template: 'package.json', soloVacio: true },
  { path: 'package-lock.json', template: 'package-lock.json', soloVacio: true },
];
// Every template planProject can ask for: the ones above plus the smoke PR's.
export const FICHA_TEMPLATE = 'ficha.json';
export const TEMPLATE_NAMES = [...PROJECT_FILES.map((f) => f.template), FICHA_TEMPLATE];

// The closed list of calls: operation, method and the shape of the path. `planProject` returns nothing else,
// and the list has no deletion on purpose (the guard test fails if one appears).
const R = '/repos/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+';
export const ALLOWED_CALLS = [
  { op: 'create-repo', method: 'POST', path: new RegExp(`^/orgs/${ORG}/repos$`) },
  { op: 'put-file', method: 'PUT', path: new RegExp(`^${R}/contents/[A-Za-z0-9._/-]+$`) },
  { op: 'update-settings', method: 'PATCH', path: new RegExp(`^${R}$`) },
  { op: 'put-environment', method: 'PUT', path: new RegExp(`^${R}/environments/${REVISOR_ENV}$`) },
  { op: 'add-branch-policy', method: 'POST', path: new RegExp(`^${R}/environments/${REVISOR_ENV}/deployment-branch-policies$`) },
  { op: 'put-secret', method: 'PUT', path: new RegExp(`^${R}/environments/${REVISOR_ENV}/secrets/[A-Z_]+$`) },
  { op: 'create-ruleset', method: 'POST', path: new RegExp(`^${R}/rulesets$`) },
  { op: 'update-ruleset', method: 'PUT', path: new RegExp(`^${R}/rulesets/[0-9]+$`) },
  { op: 'create-ref', method: 'POST', path: new RegExp(`^${R}/git/refs$`) },
  { op: 'open-pr', method: 'POST', path: new RegExp(`^${R}/pulls$`) },
  { op: 'arm-auto-merge', method: 'POST', path: /^\/graphql$/ },
];

const fail = (msg) => { throw new Error(msg); };
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------- proyectos/<x>.json ----------
const PROJECT_KEYS = ['repo', 'visibilidad', 'descripcion'];
const PRIVATE_MSG = 'repo privado: el plan gratuito de GitHub no admite rulesets en repos privados, asi que no se podria proteger main; hazlo publico o cambia de plan';

// Validates the content of a proyectos/<x>.json and returns it parsed. `fileName` (optional) must be <repo name>.json.
export function parseProject(json, { fileName } = {}) {
  if (!isObject(json)) fail('proyectos/*.json: tiene que ser un objeto con repo, visibilidad y descripcion');
  for (const k of Object.keys(json)) if (!PROJECT_KEYS.includes(k)) fail(`proyectos/*.json: clave desconocida '${k}' (solo ${PROJECT_KEYS.join(', ')})`);
  for (const k of PROJECT_KEYS) if (!(k in json)) fail(`proyectos/*.json: falta la clave '${k}'`);
  const m = typeof json.repo === 'string' && json.repo.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
  if (!m) fail(`proyectos/*.json: repo '${json.repo}' no tiene la forma dueno/nombre`);
  if (m[1] !== ORG) fail(`proyectos/*.json: el dueno de '${json.repo}' tiene que ser ${ORG}`);
  if (json.visibilidad === 'privado') fail(PRIVATE_MSG);
  if (json.visibilidad !== 'publico') fail(`proyectos/*.json: visibilidad '${json.visibilidad}' no vale (solo 'publico')`);
  if (typeof json.descripcion !== 'string' || json.descripcion.trim() === '' || json.descripcion.length > 350) {
    fail('proyectos/*.json: descripcion tiene que ser un texto de 1 a 350 caracteres');
  }
  if (fileName !== undefined && fileName !== `${m[2]}.json`) fail(`proyectos/${fileName}: el fichero tiene que llamarse ${m[2]}.json`);
  return { repo: json.repo, owner: m[1], name: m[2], visibilidad: json.visibilidad, descripcion: json.descripcion };
}

// ---------- ruleset of main ----------
// The only copy of the body. No `update` rule and no bypass: nobody skips it. Always `active`.
export function rulesetBody({ revisorAppId, testsContext = 'tests / tests' } = {}) {
  if (!Number.isInteger(revisorAppId) || revisorAppId <= 0) fail('rulesetBody: falta revisorAppId (el App ID numerico de la App revisora)');
  return {
    name: 'main',
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    bypass_actors: [],
    rules: [
      { type: 'pull_request', parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
      } },
      { type: 'required_status_checks', parameters: {
        strict_required_status_checks_policy: false,
        required_status_checks: [
          { context: testsContext, integration_id: ACTIONS_APP_ID },
          { context: 'revisor', integration_id: revisorAppId },
        ],
      } },
      { type: 'non_fast_forward' },
      { type: 'deletion' },
    ],
  };
}

// `have` (what GitHub returns) contains everything `want` says; extra fields and extra array items are fine, so
// the defaults GitHub adds do not look like drift. Arrays match item by item in any order; an empty wanted array
// must be empty in `have` (that is how an empty bypass_actors is enforced).
function covers(have, want) {
  if (Array.isArray(want)) {
    if (!Array.isArray(have)) return false;
    if (want.length === 0) return have.length === 0;
    return want.every((w) => have.some((h) => covers(h, w)));
  }
  if (isObject(want)) return isObject(have) && Object.entries(want).every(([k, v]) => covers(have[k], v));
  return have === want;
}

// ---------- real state ----------
const STATE_KEYS = ['repo', 'files', 'environment', 'secretNames', 'rulesets', 'revisorAppId', 'mainSha', 'smoke'];

function checkState(s) {
  if (!isObject(s)) fail('estado: tiene que ser un objeto');
  for (const k of Object.keys(s)) if (!STATE_KEYS.includes(k)) fail(`estado: clave desconocida '${k}'`);
  const isBoolMap = (r) => isObject(r) && ['private', 'allow_auto_merge', 'delete_branch_on_merge'].every((k) => typeof r[k] === 'boolean');
  if (s.repo !== null && !isBoolMap(s.repo)) fail('estado.repo: null o un objeto con private, allow_auto_merge y delete_branch_on_merge (booleanos)');
  for (const k of ['files', 'secretNames', 'rulesets']) if (!Array.isArray(s[k])) fail(`estado.${k}: tiene que ser una lista`);
  if (!s.rulesets.every((r) => isObject(r) && Number.isInteger(r.id))) fail('estado.rulesets: cada ruleset tiene que traer su id numerico');
  if (!Number.isInteger(s.revisorAppId) || s.revisorAppId <= 0) fail('estado.revisorAppId: tiene que ser el App ID numerico de la App revisora');
  if (s.environment !== null && !(isObject(s.environment) && typeof s.environment.customBranchPolicies === 'boolean' && Array.isArray(s.environment.branches))) {
    fail('estado.environment: null o { customBranchPolicies, branches }');
  }
  if (!isObject(s.smoke) || typeof s.smoke.branchExists !== 'boolean' || typeof s.smoke.fileOnBranch !== 'boolean') fail('estado.smoke: { branchExists, fileOnBranch, pr }');
}

const render = (text, project) => text.replaceAll('__REPO__', project.repo).replaceAll('__NOMBRE__', project.name);
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const call = (op, method, path, body) => ({ op, method, path, body });

function templateText(templates, name) {
  const t = templates?.[name];
  if (typeof t !== 'string') fail(`falta la plantilla ${name}`);
  return t;
}

function fileCalls(project, state, templates) {
  const vacio = state.files.length === 0;
  return PROJECT_FILES.filter((f) => (!f.soloVacio || vacio) && !state.files.includes(f.path)).map((f) => call(
    'put-file', 'PUT', `/repos/${project.repo}/contents/${f.path}`,
    { message: `Fabrica: ${f.path}`, content: b64(render(templateText(templates, f.template), project)), branch: 'main' },
  ));
}

function environmentCalls(project, state) {
  const base = `/repos/${project.repo}/environments/${REVISOR_ENV}`;
  const env = state.environment;
  const out = [];
  if (!env || !env.customBranchPolicies) {
    out.push(call('put-environment', 'PUT', base, { deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }));
  }
  if (!env || !env.branches.includes('main')) out.push(call('add-branch-policy', 'POST', `${base}/deployment-branch-policies`, { name: 'main', type: 'branch' }));
  for (const name of REVISOR_SECRETS.filter((n) => !state.secretNames.includes(n))) {
    // No value here: the executor (chunk 5) encrypts it from its own secret and replaces `valueFrom`.
    out.push(call('put-secret', 'PUT', `${base}/secrets/${name}`, { valueFrom: 'workflow-secret' }));
  }
  return out;
}

function rulesetCalls(project, state) {
  const body = rulesetBody({ revisorAppId: state.revisorAppId });
  if (state.rulesets.some((r) => covers(r, body))) return [];
  const mine = state.rulesets.find((r) => r.name === body.name);
  if (mine) return [call('update-ruleset', 'PUT', `/repos/${project.repo}/rulesets/${mine.id}`, body)];
  return [call('create-ruleset', 'POST', `/repos/${project.repo}/rulesets`, body)];
}

// The smoke PR: .fabrica.json on its own branch, a PR, auto-merge armed. Staged by what already exists, so each run does the next step.
function smokeCalls(project, state, templates) {
  if (state.files.includes(FICHA)) return [];
  const { branchExists, fileOnBranch, pr } = state.smoke;
  const r = project.repo;
  if (pr?.merged) return [];
  if (pr && pr.state !== 'open') fail(`el PR de humo #${pr.number} de ${r} esta cerrado sin fusionar: ciérralo del todo o revisa por que el revisor dijo que no`);
  if (pr) return pr.autoMerge ? [] : [call('arm-auto-merge', 'POST', '/graphql', { operation: 'enablePullRequestAutoMerge', pullRequestId: pr.nodeId, mergeMethod: 'SQUASH' })];
  const out = [];
  if (!branchExists) {
    if (typeof state.mainSha !== 'string' || state.mainSha.length !== 40) fail('estado.mainSha: hace falta el sha de main para abrir la rama del PR de humo');
    out.push(call('create-ref', 'POST', `/repos/${r}/git/refs`, { ref: `refs/heads/${SMOKE_BRANCH}`, sha: state.mainSha }));
  }
  if (!branchExists || !fileOnBranch) {
    out.push(call('put-file', 'PUT', `/repos/${r}/contents/${FICHA}`, { message: `Fabrica: ${FICHA}`, content: b64(render(templateText(templates, FICHA_TEMPLATE), project)), branch: SMOKE_BRANCH }));
  }
  out.push(call('open-pr', 'POST', `/repos/${r}/pulls`, { title: 'Ficha de la Fabrica', head: SMOKE_BRANCH, base: 'main', body: `Deja la ficha ${FICHA} en ${r}. La abre la App de la Fabrica; GitHub la fusiona cuando tests y revisor estan en verde.` }));
  return out;
}

// From (project parsed by parseProject, real state, templates by name) to the calls, in this order:
// repo, files on main, settings, environment + secrets, ruleset, smoke PR. Throws on a state it must not touch.
export function planProject(project, state, templates) {
  checkState(state);
  if (state.repo?.private) fail(`${project.repo} es privado: ${PRIVATE_MSG}`);
  const out = [];
  if (!state.repo) out.push(call('create-repo', 'POST', `/orgs/${ORG}/repos`, { name: project.name, description: project.descripcion, private: false }));
  out.push(...fileCalls(project, state, templates));
  if (!state.repo || !state.repo.allow_auto_merge || !state.repo.delete_branch_on_merge) {
    out.push(call('update-settings', 'PATCH', `/repos/${project.repo}`, { allow_auto_merge: true, delete_branch_on_merge: true }));
  }
  out.push(...environmentCalls(project, state), ...rulesetCalls(project, state), ...smokeCalls(project, state, templates));
  return out;
}
