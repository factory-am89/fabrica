// reviewer-no.json (chunk 1 of plans/registro-de-no.md): one row per «no» of the reviewer, with the class of the failure and what
// came of it. It replaces no-lesson.json. At the root, not in lessons/ (which is read whole as lessons).
// A row is an event, not a rule: the rule that sums up many events is a lesson, and `outcome` points to it by id (never copies it).
// Readers: test/reviewer-no.test.js now; scripts/lib/lesson-effect.mjs (readTriagedNo) and scripts/lib/free-values.mjs.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OTHER } from './entities.mjs';
import { readPulls } from './audit-data.mjs';
import { NO_QUESTION, PR_SOURCE, REASON_SINGLE, keysFault, noteFault, requiredOf, sourceNumber } from './lessons.mjs';
import { ANSWER, readCheckRuns } from './record.mjs';
import { ExitError } from './exit.mjs';

export const REVIEWER_NO_FILE = 'reviewer-no.json';
export const REVIEWER_NO_VERSION = 1;
// The key names are written once here; code and tests use REVIEWER_NO_KEYS.x and never the position in the list.
export const REVIEWER_NO_KEYS = Object.freeze({ source: 'source', question: 'question', kind: 'kind', kindNote: 'kind_note', outcome: 'outcome', outcomeNote: 'outcome_note' });
export const REVIEWER_NO_FIELDS = Object.values(REVIEWER_NO_KEYS);
export const REVIEWER_NO_OPTIONAL_FIELDS = [REVIEWER_NO_KEYS.kindNote, REVIEWER_NO_KEYS.outcomeNote];

// The class of the failure, measured on the «no» of the session that ordered the plan; `otro` + kind_note is the valve.
export const KINDS = ['afirmacion-sin-prueba', 'vocabulario-copiado', 'cuerpo-de-otro-pr', 'falta-de-rojo-antes', 'error-tragado', 'forma-del-cuerpo', OTHER];
// What came of the «no»: the id of a lesson of lessons/, or one of these closed values. `caso-unico` and `otro` are the lesson reasons themselves.
export const OUTCOME_PENDING = 'pendiente';
export const OUTCOME_NOISE = 'ruido-del-juez';
export const OUTCOME_REASONS = [OUTCOME_PENDING, OUTCOME_NOISE, REASON_SINGLE, OTHER];

export const REVIEWER_NO_FAULTS = Object.freeze(
  Object.fromEntries([
    'REVIEWER_NO_NOT_JSON',
    'REVIEWER_NO_BAD_FILE',
    'REVIEWER_NO_BAD_FIELDS',
    'REVIEWER_NO_BAD_SOURCE',
    'REVIEWER_NO_UNKNOWN_QUESTION',
    'REVIEWER_NO_BAD_KIND',
    'REVIEWER_NO_KIND_NOTE_MISMATCH',
    'REVIEWER_NO_BAD_OUTCOME',
    'REVIEWER_NO_OUTCOME_NOTE_MISMATCH',
    'REVIEWER_NO_DUPLICATE_ROW',
    'REVIEWER_NO_OUTCOME_AMBIGUOUS',
  ].map((c) => [c, c])),
);

export function readReviewerNo(root) {
  const file = path.join(root, REVIEWER_NO_FILE);
  if (!existsSync(file)) throw new Error(`${REVIEWER_NO_FILE} not found in ${root}`);
  return readFileSync(file, 'utf8');
}

const FILE_KEYS = ['$comment', 'version', 'rows'];

// text: the content of reviewer-no.json; ctx: see lessonContext in lessons.mjs; lessonIds: ids of the lessons present.
// Returns [{code, where, message}] (empty = green).
export function reviewerNoFaults(text, ctx, lessonIds) {
  const faults = [];
  const add = (where, code, message) => faults.push({ code, where, message });
  let d;
  try { d = JSON.parse(text); } catch (e) { add(REVIEWER_NO_FILE, REVIEWER_NO_FAULTS.REVIEWER_NO_NOT_JSON, e.message); return faults; }
  if (keysFault(d, FILE_KEYS, ['$comment']) || d.version !== REVIEWER_NO_VERSION || !Array.isArray(d.rows)) {
    add(REVIEWER_NO_FILE, REVIEWER_NO_FAULTS.REVIEWER_NO_BAD_FILE, `the file must be an object with version ${REVIEWER_NO_VERSION}, a list «rows» and, at most, a «$comment»`);
    return faults;
  }
  const { source: SOURCE, question: QUESTION, kind: KIND, kindNote: KIND_NOTE, outcome: OUTCOME, outcomeNote: OUTCOME_NOTE } = REVIEWER_NO_KEYS;
  for (const id of lessonIds.filter((i) => OUTCOME_REASONS.includes(i))) {
    add(REVIEWER_NO_FILE, REVIEWER_NO_FAULTS.REVIEWER_NO_OUTCOME_AMBIGUOUS, `the lesson «${id}» has the id of a closed value of ${OUTCOME}: a row could not say which one it means`);
  }
  const seen = new Set();
  d.rows.forEach((r, i) => {
    const where = `${REVIEWER_NO_FILE}#${i + 1}`;
    if (keysFault(r, REVIEWER_NO_FIELDS, REVIEWER_NO_OPTIONAL_FIELDS)) {
      add(where, REVIEWER_NO_FAULTS.REVIEWER_NO_BAD_FIELDS, `a row must have ${requiredOf(REVIEWER_NO_FIELDS, REVIEWER_NO_OPTIONAL_FIELDS).join(', ')} and, when ${KIND} or ${OUTCOME} is «${OTHER}», ${REVIEWER_NO_OPTIONAL_FIELDS.join(', ')}`);
      return;
    }
    if (typeof r[SOURCE] !== 'string' || !PR_SOURCE.test(r[SOURCE])) add(where, REVIEWER_NO_FAULTS.REVIEWER_NO_BAD_SOURCE, `${SOURCE} ${JSON.stringify(r[SOURCE])} must be #<n>`);
    if (r[QUESTION] === NO_QUESTION || !ctx.questions.includes(r[QUESTION])) {
      add(where, REVIEWER_NO_FAULTS.REVIEWER_NO_UNKNOWN_QUESTION, `${QUESTION} ${JSON.stringify(r[QUESTION])} is not a question id of the standards`);
    }
    if (!KINDS.includes(r[KIND])) add(where, REVIEWER_NO_FAULTS.REVIEWER_NO_BAD_KIND, `${KIND} must be one of ${KINDS.join(', ')}`);
    if (noteFault(r, KIND_NOTE, r[KIND] === OTHER)) {
      add(where, REVIEWER_NO_FAULTS.REVIEWER_NO_KIND_NOTE_MISMATCH, `${KIND_NOTE} must be a non-empty text exactly when ${KIND} is ${OTHER}`);
    }
    if (!OUTCOME_REASONS.includes(r[OUTCOME]) && !lessonIds.includes(r[OUTCOME])) {
      add(where, REVIEWER_NO_FAULTS.REVIEWER_NO_BAD_OUTCOME, `${OUTCOME} must be the id of a lesson of lessons/ or one of ${OUTCOME_REASONS.join(', ')}`);
    }
    if (noteFault(r, OUTCOME_NOTE, r[OUTCOME] === OTHER)) {
      add(where, REVIEWER_NO_FAULTS.REVIEWER_NO_OUTCOME_NOTE_MISMATCH, `${OUTCOME_NOTE} must be a non-empty text exactly when ${OUTCOME} is ${OTHER}`);
    }
    const key = JSON.stringify([r[SOURCE], r[QUESTION], r[KIND]]);
    if (seen.has(key)) add(where, REVIEWER_NO_FAULTS.REVIEWER_NO_DUPLICATE_ROW, `a row with the same ${SOURCE}, ${QUESTION} and ${KIND} is already in the file`);
    seen.add(key);
  });
  return faults;
}

// The signal of audit (chunk 6 of plans/registro-de-no.md): no-per-kind. Local, no network, no threshold.
// The two groups of outcome that name a lesson: the PR is in its sources (the row made the lesson) or it is not (the lesson already
// existed: a relapse). They are keys of the figure, not values of the file.
export const OUTCOME_GROUPS = Object.freeze({ lessonNew: 'leccion-nueva', lessonExisting: 'leccion-existente' });
const zeros = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));

export const reviewerNoRows = (root) => {
  const d = JSON.parse(readReviewerNo(root));
  if (!Array.isArray(d.rows)) throw new Error(`${REVIEWER_NO_FILE}: rows must be a list`);
  return d.rows;
};

// rows: the list of reviewer-no.json; lessons: [{id, sources: [PR number]}] (readLessonSources) ->
//   { total, byKind (every kind of KINDS, with 0), byOutcome (OUTCOME_GROUPS and every closed outcome, with 0),
//     byKindQuestion {kind: {question: n}} (only kinds with rows), otherNotes [{pr, question, field, note}] (rows kind or outcome otro),
//     relapses [{pr, question, kind, lesson}] (outcome is a lesson without that PR in its sources) }.
// A kind or an outcome outside the closed lists throws: it is never counted as «otro».
export function noPerKind(rows, lessons) {
  const { source: SOURCE, question: QUESTION, kind: KIND, kindNote: KIND_NOTE, outcome: OUTCOME, outcomeNote: OUTCOME_NOTE } = REVIEWER_NO_KEYS;
  const byKind = zeros(KINDS);
  const byOutcome = { ...zeros(Object.values(OUTCOME_GROUPS)), ...zeros(OUTCOME_REASONS) };
  const byKindQuestion = {};
  const otherNotes = [];
  const relapses = [];
  for (const r of rows) {
    const pr = sourceNumber(r[SOURCE]);
    const [question, kind, outcome] = [r[QUESTION], r[KIND], r[OUTCOME]];
    if (!KINDS.includes(kind)) throw new Error(`row #${pr}: ${KIND} ${JSON.stringify(kind)} is not in ${KINDS.join(', ')}`);
    byKind[kind] += 1;
    byKindQuestion[kind] = { ...byKindQuestion[kind], [question]: (byKindQuestion[kind]?.[question] ?? 0) + 1 };
    if (kind === OTHER) otherNotes.push({ pr, question, field: KIND, note: r[KIND_NOTE] });
    if (OUTCOME_REASONS.includes(outcome)) {
      byOutcome[outcome] += 1;
      if (outcome === OTHER) otherNotes.push({ pr, question, field: OUTCOME, note: r[OUTCOME_NOTE] });
      continue;
    }
    const lesson = lessons.find((l) => l.id === outcome);
    if (lesson === undefined) throw new Error(`row #${pr}: ${OUTCOME} ${JSON.stringify(outcome)} is neither a closed value nor a lesson`);
    if (lesson.sources.includes(pr)) byOutcome[OUTCOME_GROUPS.lessonNew] += 1;
    else {
      byOutcome[OUTCOME_GROUPS.lessonExisting] += 1;
      relapses.push({ pr, question, kind, lesson: lesson.id });
    }
  }
  return { total: rows.length, byKind, byOutcome, byKindQuestion, otherNotes, relapses };
}

// The debt (chunk 3 of plans/registro-de-no.md). The rule «triar los no» started when #112 merged; what was merged before is not counted.
export const DEBT_SINCE = '2026-10-19';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pairKey = (pr, question) => JSON.stringify([pr, question]);

// {pulls, checkRuns} as scripts/collect-records.mjs writes them, rows = the list of reviewer-no.json -> { since, missing, pending, unmatched }:
//   missing: [{pr, question}] a «no» of a PR merged on or after `since` (UTC) with no row;
//   pending: [{pr, question, kind}] the rows whose outcome is pendiente;
//   unmatched: [{pr, question}] rows whose pair is no «no» in any record (an invented row or a wrong PR). An open PR's «no» is a legit pair: the row is written in the fix;
//   errored: [{pr, error}] the rounds that ended in an error of the judge: they say nothing about the questions, so they are not debt, but they are listed.
// A check-run without a readable record stops the figure with an error (REVIEWER_NO_UNREADABLE); counting around it would be false
// (as `rounds` of audit-data.mjs). The exception: one that belongs only to PRs the debt does not count (not merged since `since`) is not
// read, but it is shown: ignored: [{pr, checkRuns}] (its PR, how many). One that no PR holds by head_sha (or with no head_sha) still stops.
//   (with `ignored`, the other fields as above)
export function reviewerNoDebt({ pulls, checkRuns }, rows, since = DEBT_SINCE) {
  if (!DAY.test(since)) throw new Error(`since must be YYYY-MM-DD, got ${since}`);
  const from = Date.parse(`${since}T00:00:00Z`);
  const prs = readPulls(pulls);
  const mergedSince = new Set(prs.filter((p) => p.merged !== null && p.merged >= from).map((p) => p.number));
  const { records, unreadable } = readCheckRuns(checkRuns);
  const ignoredBy = new Map();
  const stopping = [];
  for (const u of unreadable) {
    const sha = checkRuns[u.index]?.head_sha;
    const owners = prs.filter((p) => p.commits.has(sha)).map((p) => p.number); // no head_sha: no owner, so it stops
    if (owners.length === 0 || owners.some((n) => mergedSince.has(n))) stopping.push(u.index);
    else for (const n of owners) ignoredBy.set(n, (ignoredBy.get(n) ?? 0) + 1);
  }
  if (stopping.length > 0) throw new ExitError('REVIEWER_NO_UNREADABLE', `check-runs without a readable record (index: ${stopping.join(', ')})`);
  const ignored = [...ignoredBy].map(([pr, n]) => ({ pr, checkRuns: n })).sort((a, b) => a.pr - b.pr);
  const noPairs = new Map();
  const errored = [];
  for (const r of records) {
    if (r.error !== null) { // a record with an error says nothing about the questions (aggregate does the same), but it is shown, not lost
      errored.push({ pr: r.pr, error: r.error });
      continue;
    }
    for (const [question, answer] of Object.entries(r.answers)) if (answer === ANSWER.no) noPairs.set(pairKey(r.pr, question), { pr: r.pr, question });
  }
  const { source: SOURCE, question: QUESTION, kind: KIND, outcome: OUTCOME } = REVIEWER_NO_KEYS;
  const mine = rows.map((r) => ({ pr: sourceNumber(r[SOURCE]), question: r[QUESTION], kind: r[KIND], outcome: r[OUTCOME] }));
  const covered = new Set(mine.map((r) => pairKey(r.pr, r.question)));
  const byPair = (a, b) => a.pr - b.pr || a.question.localeCompare(b.question);
  return {
    since,
    missing: [...noPairs.values()].filter((p) => mergedSince.has(p.pr) && !covered.has(pairKey(p.pr, p.question))).sort(byPair),
    pending: mine.filter((r) => r.outcome === OUTCOME_PENDING).map(({ pr, question, kind }) => ({ pr, question, kind })),
    unmatched: mine.filter((r) => !noPairs.has(pairKey(r.pr, r.question))).map(({ pr, question }) => ({ pr, question })),
    errored: errored.sort((a, b) => a.pr - b.pr || a.error.localeCompare(b.error)),
    ignored,
  };
}
