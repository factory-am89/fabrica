// Chunk 8 of plans/app-admin.md: create the repo of each proyectos/<x>.json that does not exist yet (POST /orgs/factory-am89/repos).
// It applies ONLY the call planProject marks create-repo; the environment and secrets (secretos.mjs), the files, settings and ruleset
// (aplicar.mjs) and the smoke PR (humo.mjs) come after, in that order, in the same run, and each of them refuses a repo that does not exist.
// This file is a gate file (scripts/lib/gate.mjs, folder scripts/admin/); the machine guard of the key scans it.
//
// Two tokens minted by the caller: GH_TOKEN_LECTURA (GET only) and GH_TOKEN_ESCRITURA, the token of the secrets step (administration: write,
// environments: write, metadata: read). No permission is added for this: GitHub documents `administration: write` for POST /orgs/{org}/repos
// (server-to-server permissions table, «Create an organization repository»).
//
// The body asks for `auto_init`: the repo is born with a first commit, so `main` exists to receive the files by PUT /contents. The answer is checked
// afterwards with GET: the default branch must be `main` (every later step names it) and `main` must hold a commit; GitHub may need a moment,
// so it reads up to READS times. What it saw is what the error says; nothing is assumed.
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ALLOWED_CALLS, parseProject, planProject } from './proyecto.mjs';
import { loadTemplates, makeApi, readState } from './leer-plan.mjs';
import { makeWriteApi } from './secretos.mjs';

export const CREATE_OPS = ['create-repo'];
export const createCalls = (calls) => calls.filter((c) => CREATE_OPS.includes(c.op));

export function assertAllowed(call) {
  const rule = ALLOWED_CALLS.find((a) => a.op === call.op);
  if (!CREATE_OPS.includes(call.op) || !rule || rule.method !== call.method || !rule.path.test(call.path)) {
    throw new Error(`llamada no permitida en crear.mjs: ${call.op} ${call.method} ${call.path}`);
  }
}

const READS = 5;
const WAIT_MS = 2000;
const DEFAULT_BRANCH = 'main';

// After the POST: the repo is there with `main` as default branch and a commit on it. Returns the state that proves it.
async function waitForMain(readApi, project, sleep) {
  const r = project.repo;
  const branch = (await readApi(`/repos/${r}`)).body.default_branch;
  if (branch !== DEFAULT_BRANCH) throw new Error(`${r}: GitHub devuelve la rama por defecto '${branch}' y no '${DEFAULT_BRANCH}'; los pasos siguientes escriben en ${DEFAULT_BRANCH}. No se ha escrito nada mas.`);
  for (let read = 1; read <= READS; read++) {
    const state = await readState(readApi, project);
    if (state.repo && state.files.length > 0) return state;
    if (read < READS) await sleep(WAIT_MS);
  }
  throw new Error(`${r}: creado, pero la lectura de ${DEFAULT_BRANCH} no devuelve ningun fichero tras ${READS} lecturas (${READS - 1} esperas de ${WAIT_MS} ms)`);
}

export async function main({ dir = 'proyectos', templatesDir = path.join('apps', 'proyecto-nuevo'), readApi, writeApi, summaryFile, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`${dir}/: no hay ningun .json`);
  const templates = loadTemplates(templatesDir);
  const lines = [];
  const say = (s) => { lines.push(s); process.stdout.write(`${s}\n`); };
  for (const f of files) {
    const project = parseProject(JSON.parse(readFileSync(path.join(dir, f), 'utf8')), { fileName: f });
    say(`### ${project.repo}`);
    const calls = createCalls(planProject(project, await readState(readApi, project), templates));
    if (calls.length === 0) {
      say('0 cambios: el repo ya existe.');
      continue;
    }
    for (const call of calls) {
      await writeApi(call, call.body);
      say(`- ${call.op} ${call.path}`);
    }
    const state = await waitForMain(readApi, project, sleep);
    const left = createCalls(planProject(project, state, templates));
    if (left.length > 0) throw new Error(`${project.repo}: tras escribir aun faltan ${left.map((c) => `${c.op} ${c.path}`).join('; ')}`);
  }
  say('Comprobado: una segunda lectura del estado real no deja ningun repo por crear.');
  if (summaryFile) appendFileSync(summaryFile, `## Repos nuevos\n\n${lines.join('\n')}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const need = (n) => process.env[n] || (() => { throw new Error(`falta ${n}`); })();
  await main({
    readApi: makeApi(need('GH_TOKEN_LECTURA')),
    writeApi: makeWriteApi(need('GH_TOKEN_ESCRITURA'), fetch, assertAllowed),
    summaryFile: process.env.GITHUB_STEP_SUMMARY,
  });
}
