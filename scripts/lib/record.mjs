// The per-PR verdict record: closed vocabulary only, never free text from the model (no proof, no message).
// scripts/veredicto.mjs writes one into the `output.text` of each `revisor` check-run (one JSON line in a ```json block);
// scripts/records.mjs reads them back. The schema and its version live here and nowhere else.
// Everything throws on anything unexpected: a broken record is never read as an empty one.
export const RECORD_VERSION = 1;
export const ANSWERS = ['sí', 'no', 'no aplica'];
export const ERRORS = ['standard-unloadable', 'output-unreadable'];
const FIELDS = ['v', 'repo', 'pr', 'sha', 'standard', 'ok', 'answers', 'invalid', 'error', 'run'];

const REPO = /^[\w.-]+\/[\w.-]+$/;
const SHA = /^[0-9a-f]{40}$/;
const STANDARD = /^standards\/[a-z0-9-]+\.md$/;
const ID = /^[A-Z]\d+$/;
const isCount = (n) => Number.isInteger(n) && n >= 0;
const isPosInt = (n) => Number.isInteger(n) && n > 0;
const plain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Validates a record and returns it; throws on the first thing outside the schema.
function check(r) {
  if (!plain(r)) throw new Error('record: not an object');
  const keys = Object.keys(r);
  if (keys.length !== FIELDS.length || !FIELDS.every((k) => keys.includes(k))) throw new Error(`record: fields must be exactly ${FIELDS.join(', ')}`);
  if (r.v !== RECORD_VERSION) throw new Error(`record: unknown version (expected ${RECORD_VERSION})`);
  if (typeof r.repo !== 'string' || !REPO.test(r.repo)) throw new Error('record: bad repo');
  if (!isPosInt(r.pr)) throw new Error('record: bad pr');
  if (typeof r.sha !== 'string' || !SHA.test(r.sha)) throw new Error('record: bad sha');
  if (r.standard !== null && !(typeof r.standard === 'string' && STANDARD.test(r.standard))) throw new Error('record: bad standard');
  if (typeof r.ok !== 'boolean') throw new Error('record: bad ok');
  if (!plain(r.answers)) throw new Error('record: bad answers');
  for (const [id, a] of Object.entries(r.answers)) {
    if (!ID.test(id)) throw new Error('record: answer id outside the vocabulary');
    if (a !== null && !ANSWERS.includes(a)) throw new Error('record: answer outside the vocabulary');
  }
  if (!isCount(r.invalid)) throw new Error('record: bad invalid');
  if (r.error !== null && !ERRORS.includes(r.error)) throw new Error('record: bad error');
  if (r.ok && r.error !== null) throw new Error('record: a yes cannot carry an error');
  if (r.run !== null && !(plain(r.run) && Object.keys(r.run).length === 2 && isPosInt(r.run.id) && isPosInt(r.run.attempt))) throw new Error('record: bad run');
  return r;
}

// respuestas: { answers: {<id>: answer|null}, invalid } already reduced to the vocabulary by the caller.
// Only `ok` comes from the verdict: its failure texts are not copied.
export function buildRecord({ repo, pr, sha, standard, veredicto, respuestas, run, error = null }) {
  return check({
    v: RECORD_VERSION,
    repo,
    pr: typeof pr === 'string' && /^\d+$/.test(pr) ? Number(pr) : pr,
    sha,
    standard: standard ?? null,
    ok: veredicto?.ok,
    answers: { ...respuestas?.answers },
    invalid: respuestas?.invalid ?? 0,
    error,
    run: run ?? null,
  });
}

export function parseRecord(text) {
  let r;
  try {
    r = JSON.parse(text);
  } catch {
    throw new Error('record: not JSON');
  }
  return check(r);
}

// {id, attempt} from GITHUB_RUN_ID / GITHUB_RUN_ATTEMPT; null when neither exists; throws on half or junk.
export function runFromEnv(env) {
  const { GITHUB_RUN_ID: id, GITHUB_RUN_ATTEMPT: attempt } = env;
  if (!id && !attempt) return null;
  if (!/^\d+$/.test(id ?? '') || !/^\d+$/.test(attempt ?? '')) throw new Error('GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT must both be numbers or both absent');
  return { id: Number(id), attempt: Number(attempt) };
}

const FENCE = '```';
export const formatBlock = (record) => `${FENCE}json\n${JSON.stringify(check(record))}\n${FENCE}`;

// The record inside the output.text of a check-run: exactly one ```json block holding one line.
export function extractRecord(text) {
  const blocks = [...String(text ?? '').matchAll(/```json\n([^\n]*)\n```/g)];
  if (blocks.length !== 1) throw new Error(`record: expected one json block, found ${blocks.length}`);
  return parseRecord(blocks[0][1]);
}

// check-runs (GitHub API objects) -> { records, unreadable: [{index, reason}] }. Nothing is skipped silently.
export function readCheckRuns(checkRuns) {
  const records = [];
  const unreadable = [];
  checkRuns.forEach((c, index) => {
    try {
      records.push(extractRecord(c?.output?.text));
    } catch (e) {
      unreadable.push({ index, reason: e.message });
    }
  });
  return { records, unreadable };
}

// records -> { porPr: {"repo#pr": {rondas, ok, no, salida-ilegible, standard-unloadable}}, porPregunta: {id: {sí, no, no aplica, sin-respuesta}} }
// rondas = records of that PR; `no` = a no verdict without error. A record with an error says nothing about the questions.
export function aggregate(records) {
  const porPr = {};
  const porPregunta = {};
  for (const r of records) {
    const k = `${r.repo}#${r.pr}`;
    const p = (porPr[k] ??= { rondas: 0, ok: 0, no: 0, 'salida-ilegible': 0, 'standard-unloadable': 0 });
    p.rondas += 1;
    if (r.error === 'output-unreadable') p['salida-ilegible'] += 1;
    else if (r.error === 'standard-unloadable') p['standard-unloadable'] += 1;
    else if (r.ok) p.ok += 1;
    else p.no += 1;
    if (r.error) continue;
    for (const [id, a] of Object.entries(r.answers)) {
      const q = (porPregunta[id] ??= { sí: 0, no: 0, 'no aplica': 0, 'sin-respuesta': 0 });
      q[a ?? 'sin-respuesta'] += 1;
    }
  }
  return { porPr, porPregunta };
}
