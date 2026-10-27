// The per-PR verdict record: closed vocabulary only, never free text from the model (no proof, no message).
// scripts/veredicto.mjs writes one into the `output.text` of each `revisor` check-run (one JSON line in a ```json block);
// scripts/records.mjs reads them back. The schema and its version live here and nowhere else.
// Everything throws on anything unexpected: a broken record is never read as an empty one.
import { ID_SOURCE } from './questions.mjs';

export const RECORD_VERSION = 1;
export const ANSWER = { yes: 'sí', no: 'no', notApplicable: 'no aplica' };
export const ANSWERS = Object.values(ANSWER);
export const ERROR = { standardUnloadable: 'standard-unloadable', outputUnreadable: 'output-unreadable' };
export const ERRORS = Object.values(ERROR);
// Title of the check-run that scripts/veredicto.mjs publishes when Pablo's approval overrides a no; it has no record (the round it overrides has its own).
export const OVERRIDE_TITLE = 'override by Pablo';
// Title of the in_progress `revisor` check-run that marks a judgment under way; it has no record yet, and it is not a round (counted in `pending`).
export const PENDING_TITLE = 'juzgando';
export const UNANSWERED = 'sin-respuesta'; // aggregate's bucket for a question with a null answer
const FIELDS = ['v', 'repo', 'pr', 'sha', 'standard', 'ok', 'answers', 'invalid', 'error', 'run'];

const REPO = /^[\w.-]+\/[\w.-]+$/;
const SHA = /^[0-9a-f]{40}$/;
// The shape of a standard path, written once: scripts/veredicto.mjs builds its STANDARD check from it too.
export const STANDARD_SOURCE = String.raw`standards/[a-z0-9-]+\.md`;
const STANDARD = new RegExp(`^${STANDARD_SOURCE}$`);
const ID = new RegExp(`^${ID_SOURCE}$`);
const DIGITS = /^\d+$/;
// The shape of the answers part of a record (and of what `decidir` returns for it); the one place `{answers, invalid}` is written.
export const answersSummary = (answers = {}, invalid = 0) => ({ answers, invalid });
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
    pr: typeof pr === 'string' && DIGITS.test(pr) ? Number(pr) : pr,
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
  if (!DIGITS.test(id ?? '') || !DIGITS.test(attempt ?? '')) throw new Error('GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT must both be numbers or both absent');
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

// check-runs (GitHub API objects) -> { records, overrides, pending, unreadable: [{index, reason}] }. Override check-runs and
// in_progress check-runs titled PENDING_TITLE (a judgment not finished) are counted, not read. Nothing else is skipped silently:
// a completed check-run without record stays unreadable.
export function readCheckRuns(checkRuns) {
  const records = [];
  const unreadable = [];
  let overrides = 0;
  let pending = 0;
  checkRuns.forEach((c, index) => {
    if (c?.output?.title === OVERRIDE_TITLE) {
      overrides += 1;
      return;
    }
    if (c?.status === 'in_progress' && c?.output?.title === PENDING_TITLE) {
      pending += 1;
      return;
    }
    try {
      records.push(extractRecord(c?.output?.text));
    } catch (e) {
      unreadable.push({ index, reason: e.message });
    }
  });
  return { records, overrides, pending, unreadable };
}

// records (and the answer and error vocabularies, ANSWERS and ERRORS by default) -> { porPr: {"repo#pr": {rondas, ok, no, <one counter per ERRORS value>}}, porPregunta: {id: {<one counter per answer>, sin-respuesta}} }
// rondas = records of that PR; `no` = a no verdict without error. A record with an error says nothing about the questions.
export function aggregate(records, answers = ANSWERS, errors = ERRORS) {
  const porPr = {};
  const porPregunta = {};
  for (const r of records) {
    const k = `${r.repo}#${r.pr}`;
    const p = (porPr[k] ??= { rondas: 0, ok: 0, no: 0, ...Object.fromEntries(errors.map((e) => [e, 0])) });
    p.rondas += 1;
    if (r.error !== null) {
      if (!(r.error in p)) throw new Error(`aggregate: error outside the vocabulary in ${r.repo}#${r.pr}`);
      p[r.error] += 1;
    } else if (r.ok) p.ok += 1;
    else p.no += 1;
    if (r.error) continue;
    for (const [id, a] of Object.entries(r.answers)) {
      const q = (porPregunta[id] ??= Object.fromEntries([...answers, UNANSWERED].map((x) => [x, 0])));
      const clave = a ?? UNANSWERED;
      if (!(clave in q)) throw new Error(`aggregate: answer outside the vocabulary in ${r.repo}#${r.pr}`);
      q[clave] += 1;
    }
  }
  return { porPr, porPregunta };
}
