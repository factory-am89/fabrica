// Machine guard for the key of the administrator App, written BEFORE the workflow that will use it
// (plans/app-admin.md, piece 2). Today .github/workflows/administrar.yml and scripts/admin/ do not exist and
// nobody names the key, so the real tree passes; every rule is also proven red against a bad fixture.
// This file is a gate file (scripts/lib/gate.mjs): weakening it is weakening a check.
//
// Rules, each with its reason:
//   1. Only administrar.yml names the administrator secrets/environment (any other workflow, or the code in
//      scripts/admin/, naming them would give a PR or another job a way to the key).
//   2. Its triggers are a closed list: push to main on proyectos/** and scripts/admin/**, and schedule.
//      Anything else (pull_request_target, workflow_dispatch, workflow_call, issues...) lets code that did not
//      pass `tests` and `revisor` run with the key.
//   3. Its `permissions` are exactly `contents: read`, and the `permission-*` inputs of its App-token step equal,
//      key and level, the default_permissions of the administrator App read from the real manifest in
//      apps/crear-apps.html (never a copied list): asking for more than the App has, or less, is a difference.
//   4. scripts/admin/ never deletes a repo, never grants bypass, and never creates a ruleset without
//      `tests` and `revisor` as required checks and `enforcement: active`.
// Limits, not checked here: a secret named through a computed expression (${{ secrets[format(...)] }}), and
// what the code does at run time. Scope of rule 1 is .github/workflows/ and scripts/admin/, not docs or apps/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { ADMIN_GATE_FILES } from '../scripts/lib/gate.mjs';
import { checkPlan } from '../scripts/lib/plan.mjs';
import { ADMIN_APP_SLUG } from '../scripts/lib/repo.mjs';
import { manifiestos } from './apoyo/fabrica.mjs';

const RAIZ = path.resolve(import.meta.dirname, '..');
// The names come from the gate list (one source): the workflow is the .yml entry, the code folder the entry ending in '/'.
const WORKFLOW = ADMIN_GATE_FILES.find((f) => f.endsWith('.yml'));
const CODIGO = ADMIN_GATE_FILES.find((f) => f.endsWith('/')).slice(0, -1);

// The permissions of the administrator App, from the real manifest, in the form of the token action (permission-<name>).
const PERMISOS_MANIFIESTO = Object.fromEntries(Object.entries(
  manifiestos().find((m) => m.name === ADMIN_APP_SLUG).default_permissions,
).map(([k, v]) => [`permission-${k.replaceAll('_', '-')}`, v]));

function permisosDelToken(doc) {
  const pasos = Object.values(doc.jobs ?? {}).flatMap((j) => j.steps ?? []).filter((p) => String(p.uses ?? '').startsWith('actions/create-github-app-token'));
  return pasos.map((p) => Object.fromEntries(Object.entries(p.with ?? {}).filter(([k]) => k.startsWith('permission-'))));
}

const NOMBRA_LA_CLAVE = /\bADMIN_(?:APP_KEY|CLIENT_ID)\b|\badministrador\b/i;
const PUSH_PATHS = ['proyectos/**', `${CODIGO}/**`];

function ficheros(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) ficheros(p, out);
    else out.push(p);
  }
  return out;
}

function disparadores(doc) {
  const on = doc.on ?? doc[true]; // js-yaml 4 keeps `on` as a string; the fallback guards a YAML 1.1 parser
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((n) => [n, null]));
  return on ?? {};
}

function reglaDeWorkflow(texto) {
  const fallos = [];
  const doc = yaml.load(texto);
  const on = disparadores(doc);
  for (const t of Object.keys(on)) {
    if (!['push', 'schedule'].includes(t)) fallos.push(`trigger ${t} is not allowed (only push to main and schedule)`);
  }
  if ('push' in on) {
    const push = on.push ?? {};
    const claves = Object.keys(push).sort().join(',');
    if (claves !== 'branches,paths') fallos.push(`push must have exactly branches and paths, has: ${claves || 'nothing'}`);
    if (JSON.stringify(push.branches) !== JSON.stringify(['main'])) fallos.push('push.branches must be exactly [main]');
    if (JSON.stringify(push.paths) !== JSON.stringify(PUSH_PATHS)) fallos.push(`push.paths must be exactly ${PUSH_PATHS.join(', ')}`);
  }
  const permisosOk = (p) => p && typeof p === 'object' && JSON.stringify(p) === JSON.stringify({ contents: 'read' });
  if (!permisosOk(doc.permissions)) fallos.push('permissions must be exactly {contents: read}');
  for (const [nombre, job] of Object.entries(doc.jobs ?? {})) {
    if (job.permissions !== undefined && !permisosOk(job.permissions)) fallos.push(`job ${nombre}: permissions must be exactly {contents: read}`);
  }
  const tokens = permisosDelToken(doc);
  if (tokens.length !== 1) fallos.push(`exactly one App-token step is expected, found ${tokens.length}`);
  for (const t of tokens) {
    const a = JSON.stringify(Object.entries(t).sort());
    if (a !== JSON.stringify(Object.entries(PERMISOS_MANIFIESTO).sort())) fallos.push(`token permissions must equal the manifest of ${ADMIN_APP_SLUG}: has ${a}`);
  }
  return fallos;
}

function reglaDeCodigo(textos) {
  const fallos = [];
  const todo = textos.join('\n');
  // Comments are not stripped (a `//` inside a URL would hide code): an uppercase DELETE anywhere is a violation.
  if (/\bDELETE\b/.test(todo) || /method\s*[:=]\s*['"]delete['"]|repo\s+delete|repos\.delete|deleteRepo/i.test(todo)) {
    fallos.push('deletes: no DELETE call or repo deletion is allowed');
  }
  if (/bypass_actors['"]?\s*[:=]\s*(?!\[\s*\]|@\(\s*\))\S/.test(todo)) fallos.push('bypass_actors must stay empty');
  if (/bypass_mode|bypass_pull_request_allowances/.test(todo)) fallos.push('bypass is never granted');
  if (/\/rulesets|\brulesets\b/.test(todo)) {
    if (!/required_status_checks/.test(todo) || !/['"`]tests(?: \/ tests)?['"`]/.test(todo) || !/['"`]revisor['"`]/.test(todo)) {
      fallos.push('a ruleset needs required checks tests and revisor');
    }
    if (!/enforcement['"]?\s*[:=]\s*['"]active['"]/.test(todo)) fallos.push('a ruleset needs enforcement active');
  }
  if (/enforcement['"]?\s*[:=]\s*['"](?!active['"])/.test(todo)) fallos.push('enforcement other than active');
  return fallos;
}

// Returns [{ regla, fichero, motivo }] for the tree under `raiz`.
function revisar(raiz) {
  const res = [];
  const anota = (regla, fichero, motivo) => res.push({ regla, fichero, motivo });
  const wf = path.join(raiz, '.github', 'workflows');
  for (const f of ficheros(wf)) {
    const rel = path.relative(raiz, f).split(path.sep).join('/');
    const texto = readFileSync(f, 'utf8');
    if (rel === WORKFLOW) {
      for (const m of reglaDeWorkflow(texto)) anota('administrar.yml', rel, m);
    } else if (NOMBRA_LA_CLAVE.test(texto)) {
      anota('only-administrar-names-the-key', rel, 'names the administrator key or environment');
    }
  }
  const textos = [];
  for (const f of ficheros(path.join(raiz, CODIGO))) {
    const rel = path.relative(raiz, f).split(path.sep).join('/');
    const texto = readFileSync(f, 'utf8');
    textos.push(texto);
    if (NOMBRA_LA_CLAVE.test(texto)) anota('only-administrar-names-the-key', rel, 'names the administrator key or environment');
  }
  for (const m of reglaDeCodigo(textos)) anota('scripts-admin', CODIGO, m);
  return res;
}

const BUEN_WORKFLOW = `name: administrar
on:
  push:
    branches: [main]
    paths: [proyectos/**, scripts/admin/**]
  schedule:
    - cron: '17 * * * *'
permissions:
  contents: read
jobs:
  administrar:
    runs-on: ubuntu-latest
    environment: administrador
    steps:
      - uses: actions/create-github-app-token@0000000000000000000000000000000000000000
        with:
          client-id: \${{ secrets.ADMIN_CLIENT_ID }}
          private-key: \${{ secrets.ADMIN_APP_KEY }}
${Object.entries(PERMISOS_MANIFIESTO).map(([k, v]) => `          ${k}: ${v}\n`).join('')}`;

const BUEN_CODIGO = `const cuerpo = { name: 'main', enforcement: 'active', bypass_actors: [],
  rules: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'tests / tests' }, { context: 'revisor' }] } }] };
await gh('POST', '/repos/x/y/rulesets', cuerpo); // tests, 'revisor'
`;

function arbol(ficherosDe) {
  const raiz = mkdtempSync(path.join(tmpdir(), 'admin-guard-'));
  for (const [rel, texto] of Object.entries(ficherosDe)) {
    mkdirSync(path.dirname(path.join(raiz, rel)), { recursive: true });
    writeFileSync(path.join(raiz, rel), texto);
  }
  return raiz;
}

const motivos = (r) => revisar(arbol(r)).map((x) => `${x.regla}: ${x.motivo}`);

test('the real tree obeys every rule (today nobody names the key)', () => {
  assert.deepEqual(revisar(RAIZ), []);
});

test('good fixture: a conforming administrar.yml and admin code give no violation', () => {
  assert.deepEqual(motivos({ [WORKFLOW]: BUEN_WORKFLOW, 'scripts/admin/aplicar.mjs': BUEN_CODIGO }), []);
});

test('rule 1 (red): another workflow naming the key, the environment or the secret', () => {
  for (const [nombre, linea] of [
    ['secret', 'x: ${{ secrets.ADMIN_APP_KEY }}'], ['client id', 'x: ${{ secrets.ADMIN_CLIENT_ID }}'], ['environment', 'environment: administrador'],
  ]) {
    const m = motivos({ '.github/workflows/otro.yml': `name: otro\non: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: echo\n        env:\n          ${linea}\n` });
    assert.equal(m.length, 1, nombre);
    assert.match(m[0], /only-administrar-names-the-key/, nombre);
  }
  assert.match(motivos({ 'scripts/admin/x.mjs': "const k = process.env.ADMIN_APP_KEY;\n" }).join('\n'), /only-administrar-names-the-key/);
});

test('rule 2 (red): each forbidden trigger, and a push that is not main + the plan paths', () => {
  for (const t of ['pull_request', 'pull_request_target', 'workflow_dispatch', 'workflow_call', 'issues', 'issue_comment', 'release']) {
    const texto = BUEN_WORKFLOW.replace('on:\n', `on:\n  ${t}:\n`);
    assert.match(motivos({ [WORKFLOW]: texto }).join('\n'), new RegExp(`trigger ${t} is not allowed`), t);
  }
  assert.match(motivos({ [WORKFLOW]: BUEN_WORKFLOW.replace('on:\n', 'on: workflow_dispatch\nxon:\n').replace(/xon:[\s\S]*?permissions:/, 'permissions:') }).join('\n'), /workflow_dispatch is not allowed/);
  assert.match(motivos({ [WORKFLOW]: BUEN_WORKFLOW.replace('branches: [main]', 'branches: [main, dev]') }).join('\n'), /push.branches must be exactly/);
  assert.match(motivos({ [WORKFLOW]: BUEN_WORKFLOW.replace(', scripts/admin/**', '') }).join('\n'), /push.paths must be exactly/);
  assert.match(motivos({ [WORKFLOW]: BUEN_WORKFLOW.replace('    paths: [proyectos/**, scripts/admin/**]\n', '') }).join('\n'), /push must have exactly branches and paths/);
});

test('rule 3 (red): permissions beyond contents: read', () => {
  assert.match(motivos({ [WORKFLOW]: BUEN_WORKFLOW.replace('  contents: read', '  contents: write') }).join('\n'), /permissions must be exactly/);
  assert.match(motivos({ [WORKFLOW]: BUEN_WORKFLOW.replace('jobs:', 'jobs:').replace('    environment: administrador', '    environment: administrador\n    permissions: write-all') }).join('\n'), /job administrar: permissions/);
  assert.match(motivos({ [WORKFLOW]: BUEN_WORKFLOW.replace('permissions:\n  contents: read\n', '') }).join('\n'), /permissions must be exactly/);
});

test('rule 3 (red): the token permissions must equal the real manifest, key and level', () => {
  assert.ok(Object.keys(PERMISOS_MANIFIESTO).length >= 8, 'the manifest was not read');
  const lineas = Object.entries(PERMISOS_MANIFIESTO).map(([k, v]) => `          ${k}: ${v}\n`);
  const sin = (n) => BUEN_WORKFLOW.replace(lineas[n], '');
  assert.match(motivos({ [WORKFLOW]: sin(0) }).join('\n'), /token permissions must equal the manifest/);
  assert.match(motivos({ [WORKFLOW]: BUEN_WORKFLOW + '          permission-issues: write\n' }).join('\n'), /token permissions must equal the manifest/);
  const [k0, v0] = Object.entries(PERMISOS_MANIFIESTO)[0];
  assert.match(motivos({ [WORKFLOW]: BUEN_WORKFLOW.replace(`${k0}: ${v0}`, `${k0}: ${v0 === 'write' ? 'read' : 'write'}`) }).join('\n'), /token permissions must equal the manifest/);
  assert.match(motivos({ [WORKFLOW]: BUEN_WORKFLOW.replace(/ {6}- uses:[\s\S]*$/, '      - run: echo\n') }).join('\n'), /exactly one App-token step/);
});

test('rule 4 (red): scripts/admin deleting a repo, granting bypass, or a weak ruleset', () => {
  const cases = [
    ["await gh('DELETE', '/repos/x/y');", /deletes/],
    ['gh api -X DELETE repos/x/y', /deletes/],
    ['await fetch(u, { method: "delete" });', /deletes/],
    ['gh repo delete x/y --yes', /deletes/],
    ["const b = { bypass_actors: [{ actor_id: 5, actor_type: 'Integration', bypass_mode: 'always' }] };", /bypass/],
    ["const b = { bypass_actors: [{ actor_id: 5 }] };", /bypass_actors must stay empty/],
    [BUEN_CODIGO.replace(", { context: 'revisor' }", '').replace(", 'revisor'", ''), /required checks tests and revisor/],
    [BUEN_CODIGO.replace(/required_status_checks/g, 'otra'), /required checks tests and revisor/],
    [BUEN_CODIGO.replace("enforcement: 'active'", "enforcement: 'evaluate'"), /enforcement/],
    [BUEN_CODIGO.replace("enforcement: 'active', ", ''), /enforcement active/],
  ];
  for (const [codigo, esperado] of cases) {
    assert.match(motivos({ 'scripts/admin/x.mjs': codigo }).join('\n'), esperado, codigo);
  }
});

test('rule 4 (good): the word delete in a comment or a bypass_actors: [] is not a violation', () => {
  assert.deepEqual(motivos({ 'scripts/admin/x.mjs': `${BUEN_CODIGO}// never delete a repo here\n` }), []);
});

// The gate list reaches the plan check: a file under the admin folder must make a chunk a gate chunk.
// Red by mutation: written as a glob ('scripts/admin/**') matchesAny never matched it.
test('a file under the admin folder counts as gate in checkPlan; a glob entry would not', () => {
  const ancla = 'Files: `src/parser.js`, `test/parser.test.js`';
  const buena = readFileSync(path.join(RAIZ, 'test', 'fixtures', 'plans', 'good.md'), 'utf8');
  assert.ok(buena.includes(ancla), 'fixture anchor not found');
  const plan = buena.replace(ancla, `Files: \`${CODIGO}/aplicar.mjs\``);
  assert.equal(checkPlan(plan, { gateFiles: ADMIN_GATE_FILES }).chunks[0].gate, true);
  const comoGlob = ADMIN_GATE_FILES.map((f) => (f.endsWith('/') ? `${f}**` : f));
  assert.equal(checkPlan(plan, { gateFiles: comoGlob }).chunks[0].gate, false);
});
