// The judge with memory (Pablo, 2026-11-03, intervenciones.md): round 1 answers everything; from round 2 on, a «no» is checked again,
// a «sí» or «no aplica» stays unless the new code touches a file its proof cited, and a new finding only fails the check if it is severe
// (record.mjs GRAVE); the rest is an aviso. The previous verdict comes only from a `revisor` check of the App (its record), never from
// the PR. Pure: no network. scripts/veredicto.mjs (MODO=ronda) does the API calls and `decidir` applies the rule.
import { ANSWER, ANSWERS, GRAVES, MEMORY_FIELDS, extractRecord } from './record.mjs';

// Why a judgment is a round 1: closed reasons, the only text of this module that reaches a check.
export const MOTIVO = {
  none: 'sin veredicto anterior de la App en este PR',
  old: 'el veredicto anterior no trae memoria (juez de antes)',
  unreadable: 'no se pudo leer el veredicto anterior',
};
export const MOTIVOS = Object.values(MOTIVO);
// How many shas of the PR are searched for a previous verdict, newest first; each one is one API call.
export const MAX_CANDIDATES = 15;
const SHA = /^[0-9a-f]{40}$/;
const NULL_SHA = /^0{40}$/;
const plain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Where to look for the previous verdict, newest first: the head itself (the body was edited, or a rerun), the head before the push
// (github.event.before; it covers a force-push, whose old commits leave the PR) and the PR's commits from the newest. No repeats.
export function candidates(sha, before, commits) {
  const all = [sha, before, ...[...commits].reverse()].filter((s) => typeof s === 'string' && SHA.test(s) && !NULL_SHA.test(s));
  return [...new Set(all)].slice(0, MAX_CANDIDATES);
}

// The newest record among the App's `revisor` check-runs of one sha (already filtered by App and sorted newest first) that belongs to
// this PR and says something about the questions (no error). Check-runs without a record (judging, cut, override) are skipped.
export function previousRecord(checkRuns, { repo, pr }) {
  for (const c of checkRuns) {
    if (c?.status !== 'completed') continue;
    let r;
    try {
      r = extractRecord(c?.output?.text);
    } catch {
      continue;
    }
    if (r.repo === repo && r.pr === Number(pr) && r.error === null) return r;
  }
  return null;
}

export const hasMemory = (record) => MEMORY_FIELDS.every((k) => k in record);

// The files whose change in the PR is not the same at both heads: a different status, blob or old name, or present at only one.
// before/now: the `files` of the compare from the PR's base to each head. A file only the base changed has the same PR change at
// both, so it is not touched; one the base and the PR both changed may show up, which only makes the judge look again.
export function touchedFiles(before, now) {
  const sig = (f) => `${f.status}|${f.sha ?? ''}|${f.previous_filename ?? ''}`;
  const map = (files) => new Map(files.map((f) => [f.filename, sig(f)]));
  const a = map(before);
  const b = map(now);
  const touched = new Set();
  for (const [name, s] of b) if (a.get(name) !== s) touched.add(name);
  for (const name of a.keys()) if (!b.has(name)) touched.add(name);
  return [...touched].sort();
}

// The diff between the two heads, kept to the touched files (what the base brought in other files goes away).
export function filterDiff(diff, touched) {
  const keep = new Set(touched);
  return String(diff)
    .split(/^(?=diff --git )/m)
    .filter((chunk) => {
      const m = chunk.match(/^diff --git a\/(\S+) b\/(\S+)/);
      return m && (keep.has(m[1]) || keep.has(m[2]));
    })
    .join('');
}

// Paths a proof cites: anything with a file extension, with or without folders («scripts/veredicto.mjs:120», «revisor.yml»).
const CITED = /[\w./-]*[\w-]\.[A-Za-z][A-Za-z0-9]{0,7}\b/g;
export function citesTouched(proof, touched) {
  const cited = String(proof ?? '').match(CITED) ?? [];
  return cited.some((c) => touched.some((t) => t === c || t.endsWith(`/${c.replace(/^\.?\//, '')}`)));
}

// What MODO=ronda hands to the verdict step (one line of GITHUB_OUTPUT) and to the model (anterior.json). Throws on anything else:
// it is written by the judge itself, so a bad shape is a bug, never a round 1 in silence.
export function readPrevious(text) {
  let x;
  try {
    x = JSON.parse(text);
  } catch {
    throw new Error('ronda: ANTERIOR is not JSON');
  }
  if (!plain(x) || !Number.isInteger(x.ronda) || x.ronda < 1) throw new Error('ronda: bad ronda');
  if (x.ronda === 1) {
    if (!MOTIVOS.includes(x.motivo)) throw new Error('ronda: a round 1 needs a closed motivo');
    return { ronda: 1, motivo: x.motivo };
  }
  if (!SHA.test(String(x.sha))) throw new Error('ronda: bad sha');
  if (!plain(x.answers) || !Object.values(x.answers).every((a) => a === null || ANSWERS.includes(a))) throw new Error('ronda: bad answers');
  if (!plain(x.pruebas) || !Object.values(x.pruebas).every((p) => typeof p === 'string')) throw new Error('ronda: bad pruebas');
  if (!Array.isArray(x.tocados) || !x.tocados.every((t) => typeof t === 'string')) throw new Error('ronda: bad tocados');
  return { ronda: x.ronda, sha: x.sha, answers: x.answers, pruebas: x.pruebas, tocados: x.tocados };
}

// One question in a round 2+. previous: the round it read (readPrevious); r: the model's answer, already known to be a «no».
// Returns { kind: 'no' } (fails as in round 1), { kind: 'grave', grave } (fails, marked) or { kind: 'aviso', answer } (does not fail;
// the answer kept is the previous one).
export function newFinding(id, r, previous) {
  const before = previous?.answers?.[id];
  const wasFine = before === ANSWER.yes || before === ANSWER.notApplicable;
  if (!previous || previous.ronda < 2 || !wasFine || citesTouched(previous.pruebas?.[id], previous.tocados)) return { kind: 'no' };
  if (GRAVES.includes(r?.grave)) return { kind: 'grave', grave: r.grave, located: /\S+:\d+/.test(String(r.prueba ?? '')) };
  return { kind: 'aviso', answer: before };
}
