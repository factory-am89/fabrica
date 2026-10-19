// Chunk 7 of plans/app-admin.md: the smoke PR of each project. A branch off main (ops/fabrica-ficha), `.fabrica.json` on it, a PR and
// auto-merge armed; GitHub merges it when `tests` and `revisor` are green. It applies ONLY the calls planProject marks create-ref,
// put-file (on the smoke branch, never on main), open-pr and arm-auto-merge.
// This file is a gate file (scripts/lib/gate.mjs, folder scripts/admin/); the machine guard of the key scans it.
//
// Two tokens minted by the caller: GH_TOKEN_LECTURA (GET only) and GH_TOKEN_HUMO (contents: write for the ref and the file,
// pull_requests: write for the PR and its auto-merge, metadata: read). The workflow runs this file only in a step AFTER aplicar,
// with no `if` and no continue-on-error: main is protected and has its files before a PR is opened (test/admin-humo.test.js).
//
// The plan is staged by what already exists (planProject, smokeCalls): a PR that did not exist when the plan was made has no node id yet,
// so this file writes, reads the real state again and plans again until nothing of its operations is left. Run twice, the second does nothing.
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ALLOWED_CALLS, parseProject, planProject } from './proyecto.mjs';
import { loadTemplates, makeApi, readState } from './leer-plan.mjs';
import { makeWriteApi } from './secretos.mjs';

export const SMOKE_OPS = ['create-ref', 'put-file', 'open-pr', 'arm-auto-merge'];
const MAX_ROUNDS = 4; // create-ref + file + PR, then arm, then nothing: three rounds at most in practice

// One predicate for "this call is of this chunk". A put-file straight on main is aplicar's, not ours.
const isOurs = (c) => SMOKE_OPS.includes(c.op) && (c.op !== 'put-file' || c.body?.branch !== 'main');
export const smokeCalls = (calls) => calls.filter(isOurs);

export function assertAllowed(call) {
  const rule = ALLOWED_CALLS.find((a) => a.op === call.op);
  if (!isOurs(call) || !rule || rule.method !== call.method || !rule.path.test(call.path)) {
    throw new Error(`llamada no permitida en humo.mjs: ${call.op} ${call.method} ${call.path}`);
  }
}

const AUTO_MERGE = 'mutation($id: ID!, $method: PullRequestMergeMethod!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $method }) { pullRequest { number } } }';

// The only door that writes is makeWriteApi (secretos.mjs), with this file's own list of allowed calls. The plan describes the auto-merge in
// words; here it becomes the GraphQL request. makeWriteApi reads the `errors` of a GraphQL answer.
export function makeHumoApi(token, fetchFn = fetch, check = assertAllowed) {
  const write = makeWriteApi(token, fetchFn, check);
  return (call) => write(call, call.op === 'arm-auto-merge'
    ? { query: AUTO_MERGE, variables: { id: call.body.pullRequestId, method: call.body.mergeMethod } }
    : call.body);
}

const describe = (c) => `${c.op} ${c.path}`;

export async function main({ dir = 'proyectos', templatesDir = path.join('apps', 'proyecto-nuevo'), readApi, writeApi, summaryFile } = {}) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`${dir}/: no hay ningun .json`);
  const templates = loadTemplates(templatesDir);
  const lines = [];
  const say = (s) => { lines.push(s); process.stdout.write(`${s}\n`); };
  for (const f of files) {
    const project = parseProject(JSON.parse(readFileSync(path.join(dir, f), 'utf8')), { fileName: f });
    say(`### ${project.repo}`);
    let wrote = 0;
    for (let round = 1; ; round++) {
      const state = await readState(readApi, project);
      if (!state.repo) throw new Error(`${project.repo} no existe: este run solo abre el PR de humo de repos que ya existen, crear repos es otro trozo`);
      const calls = smokeCalls(planProject(project, state, templates));
      if (calls.length === 0) {
        const pr = state.smoke.pr;
        if (state.files.includes('.fabrica.json')) say('0 cambios: .fabrica.json ya esta en main.');
        else if (pr?.merged) say(`0 cambios: el PR de humo #${pr.number} ya esta fusionado.`);
        else if (pr) say(`PR de humo #${pr.number} (${pr.state}) con la fusion automatica armada: GitHub lo fusiona cuando tests y revisor esten en verde.`);
        else say('0 cambios: nada que hacer en el PR de humo.');
        break;
      }
      if (round > MAX_ROUNDS) throw new Error(`${project.repo}: tras ${MAX_ROUNDS} rondas aun faltan ${calls.map(describe).join('; ')}`);
      for (const call of calls) {
        await writeApi(call);
        wrote++;
        say(`- ${describe(call)}`);
      }
    }
    if (wrote === 0) say('Sin escrituras en este run.');
  }
  if (summaryFile) appendFileSync(summaryFile, `## PR de humo\n\n${lines.join('\n')}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const need = (n) => process.env[n] || (() => { throw new Error(`falta ${n}`); })();
  await main({
    readApi: makeApi(need('GH_TOKEN_LECTURA')),
    writeApi: makeHumoApi(need('GH_TOKEN_HUMO')),
    summaryFile: process.env.GITHUB_STEP_SUMMARY,
  });
}
