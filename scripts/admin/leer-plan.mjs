// Read-only run of the project workflow (plans/app-admin.md, chunk 4): for each proyectos/<x>.json it reads the REAL
// state of the repo with GET calls only and prints the plan that planProject would execute, as a Markdown summary.
// It applies nothing: this file has no way to write (api() only sends GET), and the plan is only printed.
// This file is a gate file (scripts/lib/gate.mjs, folder scripts/admin/); the machine guard of the key scans it.
//
// The token comes in GH_TOKEN (the caller mints it); this file never names where it comes from and never prints it.
import { readFileSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { FICHA, REVISOR_ENV, SMOKE_BRANCH, TEMPLATE_NAMES, parseProject, planProject } from './proyecto.mjs';
import { REVISOR_APP_SLUG } from '../lib/repo.mjs';

const API = 'https://api.github.com';

// The only door to GitHub: GET. `allow` lists the statuses that are an answer (not an error); anything else throws
// with the status and the path, so a 403 (App not installed, missing permission) is read as such, never as "empty".
export function makeApi(token, fetchFn = fetch) {
  return async function api(route, allow = []) {
    const res = await fetchFn(`${API}${route}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (res.status === 204) return { status: 204, body: null };
    if (allow.includes(res.status)) return { status: res.status, body: null };
    if (res.ok) {
      try {
        return { status: res.status, body: await res.json() };
      } catch (e) {
        throw new Error(`GET ${route}: la respuesta ${res.status} no es JSON`, { cause: e });
      }
    }
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${route} -> ${res.status} ${text.slice(0, 200)}`);
  };
}

const enc = encodeURIComponent;
const PER_PAGE = 100;
// A list that fills its page may have more: stop in the open instead of planning over a cut list.
const whole = (items, route) => {
  if (items.length >= PER_PAGE) throw new Error(`GET ${route}: ${items.length} elementos, puede haber mas de una pagina; el codigo no pagina`);
  return items;
};

// The state object planProject expects (see checkState in proyecto.mjs), read with GET calls.
export async function readState(api, project) {
  const r = project.repo;
  const repoRes = await api(`/repos/${r}`, [404]);
  const repo = repoRes.status === 404 ? null : {
    private: repoRes.body.private === true,
    allow_auto_merge: repoRes.body.allow_auto_merge === true,
    delete_branch_on_merge: repoRes.body.delete_branch_on_merge === true,
  };
  if (repo) {
    // A public repo is readable with any token, so reading it proves nothing about the installation: ask the installation.
    const names = [];
    for (let page = 1; page <= 20; page++) {
      const inst = await api(`/installation/repositories?per_page=${PER_PAGE}&page=${page}`);
      names.push(...inst.body.repositories.map((x) => x.full_name));
      if (inst.body.repositories.length < PER_PAGE) break;
    }
    if (!names.includes(r)) {
      const seen = names.length <= 10 ? `: ${names.join(', ') || 'ninguno'}` : '';
      throw new Error(`el token no ve ${r}; ve ${names.length} repos${seen}. Dos causas posibles, aqui no se distinguen: el token esta limitado a un repo (falta owner: o repositories: al crearlo) o la App no esta instalada en ${r}`);
    }
  }
  const appId = (await api(`/apps/${REVISOR_APP_SLUG}`)).body.id;
  if (!repo) {
    return { repo, files: [], environment: null, secretNames: [], rulesets: [], revisorAppId: appId, mainSha: null, smoke: { branchExists: false, fileOnBranch: false, pr: null } };
  }
  const tree = await api(`/repos/${r}/git/trees/main?recursive=1`, [404, 409]);
  if (tree.body?.truncated) throw new Error(`${r}: el arbol de main es demasiado grande para listarlo entero`);
  const files = tree.status === 200 ? tree.body.tree.filter((e) => e.type === 'blob').map((e) => e.path) : [];
  const mainSha = tree.status === 200 ? (await api(`/repos/${r}/commits/main`)).body.sha : null;
  const env = await api(`/repos/${r}/environments/${REVISOR_ENV}`, [404]);
  let environment = null;
  let secretNames = [];
  if (env.status === 200) {
    const pol = await api(`/repos/${r}/environments/${REVISOR_ENV}/deployment-branch-policies?per_page=${PER_PAGE}`);
    environment = {
      customBranchPolicies: env.body.deployment_branch_policy?.custom_branch_policies === true,
      branches: whole(pol.body.branch_policies, 'branch policies').map((p) => p.name),
    };
    const secrets = await api(`/repos/${r}/environments/${REVISOR_ENV}/secrets?per_page=${PER_PAGE}`);
    secretNames = whole(secrets.body.secrets, 'secrets').map((x) => x.name);
  }
  const list = await api(`/repos/${r}/rulesets?per_page=${PER_PAGE}`);
  const rulesets = [];
  for (const s of whole(list.body, 'rulesets')) rulesets.push((await api(`/repos/${r}/rulesets/${s.id}`)).body);
  const ref = await api(`/repos/${r}/git/ref/heads/${SMOKE_BRANCH}`, [404]);
  const branchExists = ref.status === 200;
  const fileOnBranch = branchExists && (await api(`/repos/${r}/contents/${FICHA}?ref=${enc(SMOKE_BRANCH)}`, [404])).status === 200;
  const prs = await api(`/repos/${r}/pulls?state=all&head=${enc(`${project.owner}:${SMOKE_BRANCH}`)}`);
  const p = prs.body[0];
  const pr = p ? { number: p.number, state: p.state, merged: p.merged_at !== null, autoMerge: p.auto_merge !== null, nodeId: p.node_id } : null;
  return { repo, files, environment, secretNames, rulesets, revisorAppId: appId, mainSha, smoke: { branchExists, fileOnBranch, pr } };
}

export function loadTemplates(dir) {
  const out = {};
  for (const n of TEMPLATE_NAMES) if (existsSync(path.join(dir, n))) out[n] = readFileSync(path.join(dir, n), 'utf8');
  return out;
}

// One block of Markdown per project: operation, method and path of each call. Never the bodies (they hold file contents).
export function renderPlan(project, calls) {
  const head = `### ${project.repo}\n\n`;
  if (calls.length === 0) return `${head}0 cambios: el repo ya esta como dice su ficha.\n`;
  const rows = calls.map((c, i) => `${i + 1}. \`${c.op}\` ${c.method} \`${c.path}\``);
  return `${head}Falta (${calls.length} llamadas; este run NO aplica nada):\n\n${rows.join('\n')}\n`;
}

export async function main({ dir = 'proyectos', templatesDir = path.join('apps', 'proyecto-nuevo'), api, summaryFile } = {}) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`${dir}/: no hay ningun .json`);
  const templates = loadTemplates(templatesDir);
  const blocks = [];
  const errors = [];
  for (const f of files) {
    try {
      const project = parseProject(JSON.parse(readFileSync(path.join(dir, f), 'utf8')), { fileName: f });
      blocks.push(renderPlan(project, planProject(project, await readState(api, project), templates)));
    } catch (e) {
      errors.push(`${f}: ${e.message}`);
      blocks.push(`### ${f}\n\nFALLO: ${e.message}\n`);
    }
  }
  const text = `## Plan de administrar.yml (solo lectura)\n\n${blocks.join('\n')}`;
  if (summaryFile) appendFileSync(summaryFile, `${text}\n`);
  process.stdout.write(`${text}\n`);
  if (errors.length > 0) throw new Error(errors.join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('falta GH_TOKEN');
  await main({ api: makeApi(token), summaryFile: process.env.GITHUB_STEP_SUMMARY });
}
