// Chunk 5 of plans/app-admin.md: the `revisor` environment of each project (limited to main) and its three secrets,
// written encrypted with the public key of that repo environment. It applies ONLY the calls planProject marks
// put-environment, add-branch-policy and put-secret; everything else the plan lists (files, settings, ruleset, smoke PR)
// is left alone in this chunk.
// This file is a gate file (scripts/lib/gate.mjs, folder scripts/admin/); the machine guard of the key scans it.
//
// Two tokens, minted by the caller with only what each needs (the guard requires each one to be a subset of the App's manifest):
//   GH_TOKEN_LECTURA   read-only: state of the repo, public key of the environment (GET only, makeApi of leer-plan.mjs)
//   GH_TOKEN_ESCRITURA the writer: environment, branch policy and secrets; nothing else can leave this file (see writeApi)
// The values come in the environment variables named like the secrets (REVISOR_SECRETS). They are never printed, never put
// in an error message and never leave this process except sealed (libsodium crypto_box_seal, the box GitHub documents).
// A missing value fails BEFORE the first write, naming the secret names (not values) and the place where they are expected.
import sodium from 'libsodium-wrappers';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ALLOWED_CALLS, REVISOR_ENV, REVISOR_SECRETS, parseProject, planProject } from './proyecto.mjs';
import { API, loadTemplates, makeApi, readState } from './leer-plan.mjs';

export const SECRET_OPS = ['put-environment', 'add-branch-policy', 'put-secret'];

export const secretCalls = (calls) => calls.filter((c) => SECRET_OPS.includes(c.op));

// A call is allowed only if it is one of SECRET_OPS and its method and path match the closed list of proyecto.mjs.
export function assertAllowed(call) {
  const rule = ALLOWED_CALLS.find((a) => a.op === call.op);
  if (!SECRET_OPS.includes(call.op) || !rule || rule.method !== call.method || !rule.path.test(call.path)) {
    throw new Error(`llamada no permitida en secretos.mjs: ${call.op} ${call.method} ${call.path}`);
  }
}

// Seals `value` for the repo environment public key (base64, as GitHub returns it). Returns base64 of the sealed box.
export async function sealSecret(value, publicKeyB64) {
  await sodium.ready;
  const b64 = sodium.base64_variants.ORIGINAL;
  const key = sodium.from_base64(publicKeyB64, b64);
  if (key.length !== sodium.crypto_box_PUBLICKEYBYTES) throw new Error(`la clave publica del environment mide ${key.length} bytes, se esperan ${sodium.crypto_box_PUBLICKEYBYTES}`);
  return sodium.to_base64(sodium.crypto_box_seal(sodium.from_string(value), key), b64);
}

// The only door that writes (aplicar.mjs passes its own `check` for its own operations). The call is checked against the closed list; an error carries method, path and status, never a body.
export function makeWriteApi(token, fetchFn = fetch, check = assertAllowed) {
  return async function writeApi(call, body) {
    check(call);
    const res = await fetchFn(`${API}${call.path}`, {
      method: call.method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${call.method} ${call.path} -> ${res.status}`);
    // GraphQL answers a failed mutation with status 200 and an `errors` list: say the first message GitHub gave, nothing of the request.
    if (call.path === '/graphql') {
      const answer = await res.json().catch(() => null);
      if (!answer) throw new Error(`${call.method} ${call.path} -> ${res.status}, la respuesta no es JSON`);
      if (Array.isArray(answer.errors) && answer.errors.length > 0) throw new Error(`${call.method} ${call.path} -> ${res.status} con errors: ${String(answer.errors[0]?.message).slice(0, 200)}`);
    }
    return res.status;
  };
}

const secretName = (call) => call.path.split('/').pop();

// Names of the secrets the plan needs to write whose value is not in `env`. Names only.
export function missingValues(calls, env) {
  return [...new Set(calls.filter((c) => c.op === 'put-secret').map(secretName))].filter((n) => typeof env[n] !== 'string' || env[n] === '');
}

export async function main({ dir = 'proyectos', templatesDir = path.join('apps', 'proyecto-nuevo'), readApi, writeApi, env, origin, summaryFile } = {}) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`${dir}/: no hay ningun .json`);
  const templates = loadTemplates(templatesDir);
  const lines = [];
  const say = (s) => { lines.push(s); process.stdout.write(`${s}\n`); };
  const planned = [];
  for (const f of files) {
    const project = parseProject(JSON.parse(readFileSync(path.join(dir, f), 'utf8')), { fileName: f });
    const state = await readState(readApi, project);
    if (!state.repo) throw new Error(`${project.repo} no existe: este run solo escribe el environment y los secretos, crear repos es otro trozo`);
    planned.push({ project, calls: secretCalls(planProject(project, state, templates)) });
  }
  const missing = missingValues(planned.flatMap((p) => p.calls), env);
  if (missing.length > 0) {
    throw new Error(`faltan ${missing.length} secretos en ${origin}: ${missing.join(', ')}. No se ha escrito nada. Hay que guardarlos ahi con esos nombres (solo el nombre aparece aqui, nunca el valor).`);
  }
  for (const { project, calls } of planned) {
    say(`### ${project.repo}`);
    if (calls.length === 0) say('0 cambios: environment y secretos ya estan.');
    let publicKey = null;
    for (const call of calls) {
      if (call.op !== 'put-secret') {
        await writeApi(call, call.body);
      } else {
        const name = secretName(call);
        publicKey ??= (await readApi(`/repos/${project.repo}/environments/${REVISOR_ENV}/secrets/public-key`)).body;
        await writeApi(call, { encrypted_value: await sealSecret(env[name], publicKey.key), key_id: publicKey.key_id });
      }
      say(`- ${call.op}${call.op === 'put-secret' ? ` ${secretName(call)}` : ''}`);
    }
  }
  // Second pass over the real state: nothing of this chunk may be left to do.
  for (const { project } of planned) {
    const left = secretCalls(planProject(project, await readState(readApi, project), templates));
    if (left.length > 0) throw new Error(`${project.repo}: tras escribir aun faltan ${left.map((c) => `${c.op} ${c.path}`).join('; ')}`);
  }
  say('Comprobado: una segunda lectura del estado real no deja nada por escribir en el environment ni en los secretos.');
  if (summaryFile) appendFileSync(summaryFile, `## Secretos del revisor\n\n${lines.join('\n')}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const need = (n) => process.env[n] || (() => { throw new Error(`falta ${n}`); })();
  await main({
    readApi: makeApi(need('GH_TOKEN_LECTURA')),
    writeApi: makeWriteApi(need('GH_TOKEN_ESCRITURA')),
    env: Object.fromEntries(REVISOR_SECRETS.map((n) => [n, process.env[n]])),
    origin: need('ORIGEN_SECRETOS'),
    summaryFile: process.env.GITHUB_STEP_SUMMARY,
  });
}
