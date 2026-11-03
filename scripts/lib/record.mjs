// The per-PR verdict record: closed vocabulary, plus the judge's memory for the next round (`pruebas`: the one free text of the
// model, each one cleaned by cleanProof, which strips anything shaped like a token and caps the length; chunk «juez con memoria»).
// scripts/veredicto.mjs writes one into the `output.text` of each `revisor` check-run (one JSON line in a ```json block);
// scripts/records.mjs reads them back. The schema and its version live here and nowhere else.
// Everything throws on anything unexpected: a broken record is never read as an empty one.
import { ID_SOURCE } from './questions.mjs';

export const RECORD_VERSION = 1;
export const ANSWER = { yes: 'sí', no: 'no', notApplicable: 'no aplica' };
export const ANSWERS = Object.values(ANSWER);
export const ERROR = { standardUnloadable: 'standard-unloadable', outputUnreadable: 'output-unreadable' };
export const ERRORS = Object.values(ERROR);
// Title of the check-run that scripts/veredicto.mjs publishes when an owner's approval overrides a no: the prefix and the login of who
// overrides (plans/puente-2-alvaro.md, chunk 6). It has no record (the round it overrides has its own). The old fixed title,
// «override by Pablo», has the same prefix, so the check-runs published before still count as overrides.
export const OVERRIDE_PREFIX = 'override by ';
export const overrideTitle = (login) => {
  if (typeof login !== 'string' || !login.trim()) throw new Error('overrideTitle: no login');
  return `${OVERRIDE_PREFIX}${login}`;
};
export const isOverrideTitle = (title) => typeof title === 'string' && title.startsWith(OVERRIDE_PREFIX);
// Title of the in_progress `revisor` check-run that marks a judgment under way; it has no record yet, and it is not a round (counted in `pending`).
export const PENDING_TITLE = 'juzgando';
// Title of the `revisor` check-run that closes, in failure, a judgment that was cut before its verdict (run cancelled); it has no record and is not a round (counted in `cut`).
export const CUT_TITLE = 'juicio cortado';
export const UNANSWERED = 'sin-respuesta'; // aggregate's bucket for a question with a null answer
export const FIELDS = ['v', 'repo', 'pr', 'sha', 'standard', 'ok', 'answers', 'invalid', 'error', 'run'];
// The judge's memory: all five or none (a record without them was written by a judge before the memory, and the next round is a
// round 1). ronda: 1, 2…; anterior: the sha of the record that round read (null in round 1); pruebas: {id: cleaned proof};
// avisos: ids of new non-severe findings of a round 2+, which do not fail the check (their answer stays the previous one);
// graves: {id: GRAVE} for the new findings of a round 2+ that do fail it.
export const MEMORY_FIELDS = ['ronda', 'anterior', 'pruebas', 'avisos', 'graves'];
// What makes a new finding in round 2+ severe enough to fail the check (Pablo, 2026-11-03, intervenciones.md). Closed list.
export const GRAVE = { production: 'produccion', data: 'datos', security: 'seguridad', falseClaim: 'afirmacion-falsa' };
export const GRAVES = Object.values(GRAVE);
// 1000: the 247 real proofs of HoMenu (2026-10-30 to 11-03) run to 916 at most, so none is cut; 600 cut 48 of them (19%). With some 15
// questions the record stays near 15,000 of the 65,535 characters a check text holds.
export const MAX_PROOF = 1000;
// Anything that looks like a credential or an encoded blob: GitHub and Anthropic token prefixes, a JWT, or 48+ characters with no
// space of the base64/hex alphabet. The model can Read files outside the diff (the action cannot narrow Read), so its text could
// carry a secret; the check is public where the repo is. A 40-hex sha is shorter than 48 and survives, and so does a long path (folders
// of at most 40 characters, no + nor =, followed by a file extension), which the next round needs to know what the proof cited.
const SECRET_SHAPES = [/\b(?:sk-ant-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]+/g, /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+/g];
const LONG_RUN = /[A-Za-z0-9+/=_-]{48,}/g;
const isPath = (run, next) => next === '.' && run.includes('/') && !/[+=]/.test(run) && run.split('/').every((s) => s.length <= 40);
export const REDACTED = '[quitado]';
// The proof as it may travel in a check: one line, no backtick fence (a ``` would break the one-json-block rule), no secret shape, capped.
// One pass can leave something a second pass would change (the cut can drop the «.» that made a long run a path), and a record only
// holds proofs that a pass leaves as they are: so it repeats until nothing changes. Each pass only shortens or redacts, so it ends fast.
function cleanOnce(text) {
  let t = String(text ?? '').replace(/\s+/g, ' ').replace(/`{3,}/g, "'").trim();
  for (const re of SECRET_SHAPES) t = t.replace(re, REDACTED);
  t = t.replace(LONG_RUN, (run, at, all) => (isPath(run, all[at + run.length]) ? run : REDACTED));
  return t.length > MAX_PROOF ? `${t.slice(0, MAX_PROOF - 1)}…` : t;
}
export function cleanProof(text) {
  let t = cleanOnce(text);
  for (let i = 0; i < 10; i += 1) {
    const again = cleanOnce(t);
    if (again === t) return t;
    t = again;
  }
  throw new Error('cleanProof: the proof does not settle');
}

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
  const withMemory = MEMORY_FIELDS.some((k) => keys.includes(k));
  const fields = withMemory ? [...FIELDS, ...MEMORY_FIELDS] : FIELDS;
  if (keys.length !== fields.length || !fields.every((k) => keys.includes(k))) throw new Error(`record: fields must be exactly ${FIELDS.join(', ')}, and either all or none of ${MEMORY_FIELDS.join(', ')}`);
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
  if (withMemory) checkMemory(r);
  return r;
}

function checkMemory(r) {
  if (!isPosInt(r.ronda)) throw new Error('record: bad ronda');
  if (r.ronda === 1 ? r.anterior !== null : !(typeof r.anterior === 'string' && SHA.test(r.anterior))) throw new Error('record: bad anterior (null only in round 1)');
  if (!plain(r.pruebas)) throw new Error('record: bad pruebas');
  for (const [id, p] of Object.entries(r.pruebas)) {
    if (!ID.test(id)) throw new Error('record: proof id outside the vocabulary');
    if (typeof p !== 'string' || p !== cleanProof(p)) throw new Error('record: a proof that is not clean');
  }
  if (!Array.isArray(r.avisos) || !r.avisos.every((id) => typeof id === 'string' && ID.test(id))) throw new Error('record: bad avisos');
  if (!plain(r.graves)) throw new Error('record: bad graves');
  for (const [id, g] of Object.entries(r.graves)) if (!ID.test(id) || !GRAVES.includes(g)) throw new Error('record: grave outside the vocabulary');
  if (r.ronda === 1 && (r.avisos.length || Object.keys(r.graves).length)) throw new Error('record: round 1 has no avisos nor graves');
}

// respuestas: { answers: {<id>: answer|null}, invalid } already reduced to the vocabulary by the caller.
// Only `ok` comes from the verdict: its failure texts are not copied.
// memoria: {ronda, anterior, pruebas, avisos, graves} or absent (then the record has none of them).
export function buildRecord({ repo, pr, sha, standard, veredicto, respuestas, run, error = null, memoria }) {
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
    ...(memoria ? Object.fromEntries(MEMORY_FIELDS.map((k) => [k, memoria[k]])) : {}),
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

// check-runs (GitHub API objects) -> { records, overrides, pending, cut, unreadable: [{index, reason}] }. Override check-runs,
// in_progress check-runs titled PENDING_TITLE (a judgment not finished) and completed/failure check-runs titled CUT_TITLE
// (a judgment cut before its verdict) are counted, not read. Nothing else is skipped silently: any other check-run without
// record stays unreadable (CUT_TITLE in another state or conclusion included).
export function readCheckRuns(checkRuns) {
  const records = [];
  const unreadable = [];
  let overrides = 0;
  let pending = 0;
  let cut = 0;
  checkRuns.forEach((c, index) => {
    if (isOverrideTitle(c?.output?.title)) {
      overrides += 1;
      return;
    }
    if (c?.status === 'completed' && c?.conclusion === 'failure' && c?.output?.title === CUT_TITLE) {
      cut += 1;
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
  return { records, overrides, pending, cut, unreadable };
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
