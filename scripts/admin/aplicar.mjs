// Chunk 6 of plans/app-admin.md: the settings, the files straight on `main` and the ruleset of `main` of each project.
// It applies ONLY the calls planProject marks update-settings, put-file (on main), create-ruleset and update-ruleset; the
// environment and its secrets are chunk 5 (secretos.mjs), the smoke PR and new repos are other chunks.
// This file is a gate file (scripts/lib/gate.mjs, folder scripts/admin/); the machine guard of the key scans it.
//
// Order matters: protecting `main` with a ruleset that requires `revisor` BEFORE the `revisor` environment of that repo
// has its secrets would leave every PR of the repo blocked (plan, chunk 5). Two locks, both in code and both tested:
//   1. The workflow runs this file only in a step AFTER the secrets step, with no `if` and no continue-on-error, so a
//      failed secrets step skips it (test/admin-aplicar.test.js reads the real workflow).
//   2. Before the first write, for EVERY project, it re-reads the real state and requires the `revisor` environment limited
//      to main with the three secret names. If one project fails the lock, nothing is written for any.
// Files go before the ruleset (planProject order): once `main` is protected a direct push is refused.
//
// Two tokens minted by the caller with only what each needs: GH_TOKEN_LECTURA (GET only) and GH_TOKEN_APLICAR
// (administration: write for settings and rulesets, contents: write and workflows: write for the files; metadata: read).
// A ruleset is only ever written `active`, with an empty bypass_actors, and is never paused nor removed.
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ALLOWED_CALLS, REVISOR_ENV, REVISOR_SECRETS, parseProject, planProject } from './proyecto.mjs';
import { loadTemplates, makeApi, readState } from './leer-plan.mjs';
import { makeWriteApi } from './secretos.mjs';

export const APPLY_OPS = ['update-settings', 'put-file', 'create-ruleset', 'update-ruleset'];

// The calls of this chunk. A put-file to another branch (the smoke PR's ficha) is not ours.
export const applyCalls = (calls) => calls.filter((c) => APPLY_OPS.includes(c.op) && (c.op !== 'put-file' || c.body?.branch === 'main'));

export function assertAllowed(call) {
  const rule = ALLOWED_CALLS.find((a) => a.op === call.op);
  const ours = APPLY_OPS.includes(call.op) && (call.op !== 'put-file' || call.body?.branch === 'main');
  if (!ours || !rule || rule.method !== call.method || !rule.path.test(call.path)) {
    throw new Error(`llamada no permitida en aplicar.mjs: ${call.op} ${call.method} ${call.path}`);
  }
}

// Lock 2: what is missing for `state` to be ready to be protected. [] means the environment and its secrets are there.
export function missingBeforeProtecting(state) {
  const out = [];
  const env = state.environment;
  if (!env || !env.customBranchPolicies || !env.branches.includes('main')) out.push(`environment ${REVISOR_ENV} limitado a main`);
  for (const n of REVISOR_SECRETS) if (!state.secretNames.includes(n)) out.push(`secreto ${n}`);
  return out;
}

export async function main({ dir = 'proyectos', templatesDir = path.join('apps', 'proyecto-nuevo'), readApi, writeApi, summaryFile } = {}) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`${dir}/: no hay ningun .json`);
  const templates = loadTemplates(templatesDir);
  const lines = [];
  const say = (s) => { lines.push(s); process.stdout.write(`${s}\n`); };
  const planned = [];
  for (const f of files) {
    const project = parseProject(JSON.parse(readFileSync(path.join(dir, f), 'utf8')), { fileName: f });
    const state = await readState(readApi, project);
    if (!state.repo) throw new Error(`${project.repo} no existe: este run solo ajusta y protege repos que ya existen, crear repos es otro trozo`);
    const missing = missingBeforeProtecting(state);
    if (missing.length > 0) {
      throw new Error(`${project.repo}: no se protege main todavia, falta en su environment ${REVISOR_ENV}: ${missing.join(', ')}. No se ha escrito nada en ningun repo.`);
    }
    planned.push({ project, calls: applyCalls(planProject(project, state, templates)) });
  }
  for (const { project, calls } of planned) {
    say(`### ${project.repo}`);
    if (calls.length === 0) say('0 cambios: ajustes, ficheros y ruleset ya estan.');
    for (const call of calls) {
      await writeApi(call, call.body);
      say(`- ${call.op} ${call.path}`);
    }
  }
  // Second pass over the real state: nothing of this chunk may be left to do.
  for (const { project } of planned) {
    const left = applyCalls(planProject(project, await readState(readApi, project), templates));
    if (left.length > 0) throw new Error(`${project.repo}: tras escribir aun faltan ${left.map((c) => `${c.op} ${c.path}`).join('; ')}`);
  }
  say('Comprobado: una segunda lectura del estado real no deja nada por escribir en ajustes, ficheros ni ruleset.');
  if (summaryFile) appendFileSync(summaryFile, `## Ajustes, ficheros y ruleset\n\n${lines.join('\n')}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const need = (n) => process.env[n] || (() => { throw new Error(`falta ${n}`); })();
  await main({
    readApi: makeApi(need('GH_TOKEN_LECTURA')),
    writeApi: makeWriteApi(need('GH_TOKEN_APLICAR'), fetch, assertAllowed),
    summaryFile: process.env.GITHUB_STEP_SUMMARY,
  });
}
