// The lesson registry validator: one JSON file per lesson in lessons/, a closed schema, nothing free-text.
// A lesson is an index row: the story lives once (a skill, a row of intervenciones.md, a PR) and the row points to it.
// Readers: test/lessons.test.js now, scripts/lessons.mjs (the count) in the next chunk.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OTHER } from './entities.mjs';
import { readQuestions } from './questions.mjs';

export const LESSON_FAULTS = Object.freeze(
  Object.fromEntries([
    'BAD_ID',
    'NOT_JSON',
    'BAD_FIELDS',
    'BAD_VERSION',
    'UNKNOWN_QUESTION',
    'QUESTION_WITHOUT_REASON',
    'BAD_SOURCES',
    'BAD_SOURCE',
    'SOURCE_IS_LINE',
    'BAD_SIGNAL',
    'MACHINE_SIGNAL_NOT_MACHINE',
    'SIGNAL_NONE_WITHOUT_REASON',
    'BAD_REASON',
    'REASON_NOTE_MISMATCH',
    'SINGLE_CASE_WITHOUT_REASON',
    'CASE_UNIQUE_WITH_MANY',
    'BAD_ESCAPED',
    'BAD_MECHANISM_KIND',
    'MECHANISM_MISSING',
    'MECHANISM_NO_MARK',
    'UNKNOWN_ORIGIN',
    'REPEATED_WITHOUT_LESSON',
  ].map((c) => [c, c])),
);

// v2 (chunk 5 of plans/trabajar-solos.md): `question` replaces v1 `class` (the same id, now mandatory), `sources`
// replaces `source` (a list), and `signal`, `reason`, `reason_note` and `escaped` are new. All but `reason` and
// `reason_note` are always present (an absent field is never read as a default); those two depend on the rules below.
export const FIELDS = ['v', 'question', 'sources', 'mechanism', 'origin', 'signal', 'reason', 'reason_note', 'escaped'];
export const OPTIONAL_FIELDS = ['reason', 'reason_note'];
export const VERSION = 2;
export const NO_QUESTION = 'none';
// `signal`: a machine (the mechanism is a test, hook or script carrying the mark) or none (then `reason` says why).
export const SIGNAL_MACHINE = 'machine';
export const SIGNAL_NONE = 'none';
export const SIGNALS = [SIGNAL_MACHINE, SIGNAL_NONE];
// `reason` is a list of closed values; the valve `otro` needs `reason_note`, and only it does.
export const REASON_PENDING = 'pregunta-pendiente';
export const REASON_NO_QUESTION = 'conducta-sin-pregunta';
export const REASON_SINGLE = 'caso-unico';
export const REASONS = [REASON_PENDING, REASON_NO_QUESTION, REASON_SINGLE, OTHER];
// Why a lesson may have no question, and why it may have no machine signal.
export const NO_QUESTION_REASONS = [REASON_PENDING, REASON_NO_QUESTION];
export const NO_SIGNAL_REASONS = [...NO_QUESTION_REASONS, OTHER];
const HUMAN_ORIGIN = 'pablo';
const ID_RE = /^[a-z0-9-]+$/;
export const PR_SOURCE = /^#[1-9]\d*$/;
// A line number points at the wrong row as soon as main adds rows (merge=union hides the shift): refused.
const LINE_SOURCE = /:[1-9]\d*$/;
export const INTERVENCIONES_FILE = 'intervenciones.md';
export const LESSONS_DIR = 'lessons';
export const DATED_ROW = /^\d{4}-\d{2}-\d{2} \| /;
const REPEATED = 'repetida: sí';
export const STANDARDS = ['standards/code.md', 'standards/plan.md'];

// What kind of mechanism a repo path is; null when the path is none of the known kinds (then it is a fault).
// [kind, path pattern, whether a machine runs it]: the third column is the only place that says which kinds are machines.
export const KINDS = [
  ['test', /^test\/[^/].*$/, true],
  ['hook', /^(\.claude\/hooks|\.githooks)\/[^/]+$/, true],
  ['skill', /^\.claude\/skills\/[^/]+\/(SKILL\.md|referencias\/[^/]+\.md)$/, false],
  ['standard', /^standards\/[^/]+\.md$/, false],
  ['script', /^scripts\/[^/].*$/, true],
];
// Derived from KINDS, never listed again.
export const MACHINE_KINDS = KINDS.filter(([, , machine]) => machine).map(([kind]) => kind);
export function mechanismKind(mechanism) {
  if (typeof mechanism !== 'string' || mechanism.split('/').includes('..')) return null;
  return KINDS.find(([, re]) => re.test(mechanism))?.[0] ?? null;
}

// Everything the rules compare a lesson with, read from the repo at `root`:
// {questions, origins, intervenciones, fileText(path) -> string | null}.
export function lessonContext(root) {
  const questions = STANDARDS.flatMap((s) => readQuestions(readFileSync(path.join(root, s), 'utf8')).map((q) => q.id));
  const agents = readdirSync(path.join(root, '.claude', 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  return {
    questions: [...questions, NO_QUESTION],
    origins: [...agents, HUMAN_ORIGIN],
    intervenciones: readFileSync(path.join(root, INTERVENCIONES_FILE), 'utf8'),
    fileText: (p) => (existsSync(path.join(root, p)) ? readFileSync(path.join(root, p), 'utf8') : null),
  };
}

// [{id, text}] for every entry of lessons/ (an entry that is not NAME.json is kept, so BAD_ID can name it).
export function readLessons(root) {
  const dir = path.join(root, LESSONS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().map((f) => ({ id: f.replace(/\.json$/, ''), file: f, text: readFileSync(path.join(dir, f), 'utf8') }));
}

// Shared by lessons.json-like files: a plain object, the required keys (all minus optional) and no key outside `all`, and the `otro` note rule.
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNote = (v) => typeof v === 'string' && v.trim() !== '';
const requiredOf = (all, optional) => all.filter((f) => !optional.includes(f));
const keysFault = (obj, all, optional) => !isPlainObject(obj) || !requiredOf(all, optional).every((f) => Object.hasOwn(obj, f)) || !Object.keys(obj).every((k) => all.includes(k));
// The note is present exactly when the reason is the valve `otro`, and then it is a non-empty text.
const noteFault = (obj, noteKey, isOther) => Object.hasOwn(obj, noteKey) !== isOther || (Object.hasOwn(obj, noteKey) && !isNote(obj[noteKey]));

// The rules that tie `reason` to `question`, `signal` and the number of sources; `sources` is null when it is not a list.
function reasonFaults(d, sources, add) {
  const has = Object.hasOwn(d, 'reason');
  const list = has && Array.isArray(d.reason) && d.reason.length > 0 && new Set(d.reason).size === d.reason.length && d.reason.every((r) => REASONS.includes(r)) ? d.reason : null;
  if (has && list === null) add(LESSON_FAULTS.BAD_REASON, `reason must be a non-empty list of different values of ${REASONS.join(', ')}`);
  const reasons = list ?? [];
  const some = (set) => reasons.some((r) => set.includes(r));
  if (d.question === NO_QUESTION && !some(NO_QUESTION_REASONS)) {
    add(LESSON_FAULTS.QUESTION_WITHOUT_REASON, `question «${NO_QUESTION}» needs a reason of ${NO_QUESTION_REASONS.join(', ')}`);
  }
  if (d.question !== NO_QUESTION && some(NO_QUESTION_REASONS)) add(LESSON_FAULTS.BAD_REASON, `reason ${NO_QUESTION_REASONS.join(' and ')} contradicts a lesson that has a question`);
  if (d.signal === SIGNAL_NONE && !some(NO_SIGNAL_REASONS)) {
    add(LESSON_FAULTS.SIGNAL_NONE_WITHOUT_REASON, `signal «${SIGNAL_NONE}» needs a reason of ${NO_SIGNAL_REASONS.join(', ')}`);
  }
  if (sources?.length === 1 && !reasons.includes(REASON_SINGLE)) {
    add(LESSON_FAULTS.SINGLE_CASE_WITHOUT_REASON, `one source is a test of the case, not of the class: reason must include ${REASON_SINGLE}`);
  }
  if (sources?.length > 1 && reasons.includes(REASON_SINGLE)) add(LESSON_FAULTS.CASE_UNIQUE_WITH_MANY, `${REASON_SINGLE} contradicts ${sources.length} sources`);
  if (noteFault(d, 'reason_note', reasons.includes(OTHER))) {
    add(LESSON_FAULTS.REASON_NOTE_MISMATCH, `reason_note must be a non-empty text exactly when reason includes «${OTHER}»`);
  }
}

// lessons: [{id, text, file?}], ctx: see lessonContext. Returns [{code, where, message}] (empty = green).
export function lessonFaults(lessons, ctx) {
  const faults = [];
  const ids = lessons.map((l) => l.id);
  for (const l of lessons) {
    const where = `lessons/${l.file ?? `${l.id}.json`}`;
    const add = (code, message) => faults.push({ code, where, message });
    if (!ID_RE.test(l.id) || (l.file ?? `${l.id}.json`) !== `${l.id}.json`) add(LESSON_FAULTS.BAD_ID, `the file must be <id>.json with id matching ${ID_RE}`);
    let d;
    try { d = JSON.parse(l.text); } catch (e) { add(LESSON_FAULTS.NOT_JSON, e.message); continue; }
    if (keysFault(d, FIELDS, OPTIONAL_FIELDS)) {
      add(LESSON_FAULTS.BAD_FIELDS, `the fields must be ${requiredOf(FIELDS, OPTIONAL_FIELDS).join(', ')} and, when the rules ask, ${OPTIONAL_FIELDS.join(', ')}`);
      continue;
    }
    if (d.v !== VERSION) add(LESSON_FAULTS.BAD_VERSION, `v must be ${VERSION}`);
    if (!ctx.questions.includes(d.question)) add(LESSON_FAULTS.UNKNOWN_QUESTION, `question ${JSON.stringify(d.question)} is not a question id nor «${NO_QUESTION}»`);
    if (!ctx.origins.includes(d.origin)) add(LESSON_FAULTS.UNKNOWN_ORIGIN, `origin ${JSON.stringify(d.origin)} is not an agent of .claude/agents/ nor «${HUMAN_ORIGIN}»`);
    const sources = Array.isArray(d.sources) && d.sources.length > 0 ? d.sources : null;
    if (sources === null || new Set(sources).size !== sources.length) {
      add(LESSON_FAULTS.BAD_SOURCES, 'sources must be a non-empty list of different #<n>');
    }
    for (const s of Array.isArray(d.sources) ? d.sources : []) {
      if (typeof s === 'string' && LINE_SOURCE.test(s)) {
        add(LESSON_FAULTS.SOURCE_IS_LINE, `source ${JSON.stringify(s)} cites a line number, which moves when main adds rows; cite the PR as #<n>`);
      } else if (typeof s !== 'string' || !PR_SOURCE.test(s)) {
        add(LESSON_FAULTS.BAD_SOURCE, `source ${JSON.stringify(s)} must be #<n>`);
      }
    }
    if (typeof d.escaped !== 'boolean') add(LESSON_FAULTS.BAD_ESCAPED, 'escaped must be true or false (did the failure reach main before it was seen)');
    const kind = mechanismKind(d.mechanism);
    if (!SIGNALS.includes(d.signal)) add(LESSON_FAULTS.BAD_SIGNAL, `signal must be one of ${SIGNALS.join(', ')}`);
    else if (d.signal === SIGNAL_MACHINE && kind !== null && !MACHINE_KINDS.includes(kind)) {
      add(LESSON_FAULTS.MACHINE_SIGNAL_NOT_MACHINE, `signal «${SIGNAL_MACHINE}» needs a mechanism of kind ${MACHINE_KINDS.join(', ')}, not ${kind}`);
    }
    reasonFaults(d, sources, add);
    if (kind === null) {
      add(LESSON_FAULTS.BAD_MECHANISM_KIND, `mechanism ${JSON.stringify(d.mechanism)} is not a test, hook, skill, standard or script path`);
    } else {
      const text = ctx.fileText(d.mechanism);
      if (text === null) add(LESSON_FAULTS.MECHANISM_MISSING, `${d.mechanism} does not exist`);
      else if (!new RegExp(`lesson: ${l.id}(?![a-z0-9-])`).test(text)) add(LESSON_FAULTS.MECHANISM_NO_MARK, `${d.mechanism} does not contain «lesson: ${l.id}»`);
    }
  }
  ctx.intervenciones.split('\n').forEach((line, i) => {
    if (DATED_ROW.test(line) && line.split(' | ').at(-1).startsWith(REPEATED) && !ids.some((id) => line.includes(`lessons/${id}.json`))) {
      faults.push({ code: LESSON_FAULTS.REPEATED_WITHOUT_LESSON, where: `${INTERVENCIONES_FILE}:${i + 1}`, message: `a row marked «${REPEATED}» cites no lessons/<id>.json of a lesson present` });
    }
  });
  return faults;
}

// no-lesson.json (chunk 7 of plans/trabajar-solos.md): the triaged «no» of the reviewer that got no lesson. At the root, not in lessons/.
export const NO_LESSON_FILE = 'no-lesson.json';
export const NO_LESSON_VERSION = 1;
// The key names are written once here; code and tests use NO_LESSON_KEYS.x and never the position in the list.
export const NO_LESSON_KEYS = Object.freeze({ source: 'source', question: 'question', reason: 'reason', ref: 'reason_ref', note: 'reason_note' });
export const NO_LESSON_FIELDS = Object.values(NO_LESSON_KEYS);
export const NO_LESSON_OPTIONAL_FIELDS = [NO_LESSON_KEYS.ref, NO_LESSON_KEYS.note];
export const REASON_NOISE = 'ruido-del-juez';
export const REASON_COVERED = 'ya-cubierta';
// `caso-unico` and `otro` are the lesson reasons themselves, not copies.
export const NO_LESSON_REASONS = [REASON_NOISE, REASON_COVERED, REASON_SINGLE, OTHER];

export const NO_LESSON_FAULTS = Object.freeze(
  Object.fromEntries([
    'NO_LESSON_NOT_JSON',
    'NO_LESSON_BAD_FILE',
    'NO_LESSON_BAD_FIELDS',
    'NO_LESSON_BAD_SOURCE',
    'NO_LESSON_UNKNOWN_QUESTION',
    'NO_LESSON_BAD_REASON',
    'NO_LESSON_REF_MISMATCH',
    'NO_LESSON_UNKNOWN_LESSON',
    'NO_LESSON_NOTE_MISMATCH',
  ].map((c) => [c, c])),
);

export function readNoLesson(root) {
  const file = path.join(root, NO_LESSON_FILE);
  if (!existsSync(file)) throw new Error(`${NO_LESSON_FILE} not found in ${root}`);
  return readFileSync(file, 'utf8');
}

// text: the content of no-lesson.json; ctx: see lessonContext; lessonIds: ids of the lessons present. Returns [{code, where, message}].
const NO_LESSON_FILE_KEYS = ['$comment', 'version', 'entries'];

export function noLessonFaults(text, ctx, lessonIds) {
  const faults = [];
  const add = (where, code, message) => faults.push({ code, where, message });
  let d;
  try { d = JSON.parse(text); } catch (e) { add(NO_LESSON_FILE, NO_LESSON_FAULTS.NO_LESSON_NOT_JSON, e.message); return faults; }
  if (keysFault(d, NO_LESSON_FILE_KEYS, ['$comment']) || d.version !== NO_LESSON_VERSION || !Array.isArray(d.entries)) {
    add(NO_LESSON_FILE, NO_LESSON_FAULTS.NO_LESSON_BAD_FILE, `the file must be an object with version ${NO_LESSON_VERSION}, a list «entries» and, at most, a «$comment»`);
    return faults;
  }
  const { source: SOURCE, question: QUESTION, reason: REASON, ref: REF, note: NOTE } = NO_LESSON_KEYS;
  d.entries.forEach((e, i) => {
    const where = `${NO_LESSON_FILE}#${i + 1}`;
    if (keysFault(e, NO_LESSON_FIELDS, NO_LESSON_OPTIONAL_FIELDS)) {
      add(where, NO_LESSON_FAULTS.NO_LESSON_BAD_FIELDS, `an entry must have ${requiredOf(NO_LESSON_FIELDS, NO_LESSON_OPTIONAL_FIELDS).join(', ')} and, when the reason asks, ${NO_LESSON_OPTIONAL_FIELDS.join(', ')}`);
      return;
    }
    if (typeof e[SOURCE] !== 'string' || !PR_SOURCE.test(e[SOURCE])) add(where, NO_LESSON_FAULTS.NO_LESSON_BAD_SOURCE, `${SOURCE} ${JSON.stringify(e[SOURCE])} must be #<n>`);
    if (e[QUESTION] === NO_QUESTION || !ctx.questions.includes(e[QUESTION])) {
      add(where, NO_LESSON_FAULTS.NO_LESSON_UNKNOWN_QUESTION, `${QUESTION} ${JSON.stringify(e[QUESTION])} is not a question id of the standards`);
    }
    if (!NO_LESSON_REASONS.includes(e[REASON])) add(where, NO_LESSON_FAULTS.NO_LESSON_BAD_REASON, `${REASON} must be one of ${NO_LESSON_REASONS.join(', ')}`);
    const covered = e[REASON] === REASON_COVERED;
    if (Object.hasOwn(e, REF) !== covered || (covered && !isNote(e[REF]))) {
      add(where, NO_LESSON_FAULTS.NO_LESSON_REF_MISMATCH, `${REF} must be a lesson id exactly when ${REASON} is ${REASON_COVERED}`);
    } else if (covered && !lessonIds.includes(e[REF])) {
      add(where, NO_LESSON_FAULTS.NO_LESSON_UNKNOWN_LESSON, `${REF} ${JSON.stringify(e[REF])} is not the id of a lesson of lessons/`);
    }
    if (noteFault(e, NOTE, e[REASON] === OTHER)) {
      add(where, NO_LESSON_FAULTS.NO_LESSON_NOTE_MISMATCH, `${NOTE} must be a non-empty text exactly when ${REASON} is ${OTHER}`);
    }
  });
  return faults;
}
