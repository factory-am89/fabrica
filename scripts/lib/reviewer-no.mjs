// reviewer-no.json (chunk 1 of plans/registro-de-no.md): one row per «no» of the reviewer, with the class of the failure and what
// came of it. It replaces no-lesson.json. At the root, not in lessons/ (which is read whole as lessons).
// A row is an event, not a rule: the rule that sums up many events is a lesson, and `outcome` points to it by id (never copies it).
// Readers: test/reviewer-no.test.js now; scripts/lib/lesson-effect.mjs (readTriagedNo) and scripts/lib/free-values.mjs.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OTHER } from './entities.mjs';
import { NO_QUESTION, PR_SOURCE, REASON_SINGLE, keysFault, noteFault, requiredOf } from './lessons.mjs';

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
