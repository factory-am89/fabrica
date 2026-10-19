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
export const MACHINE_KINDS = ['test', 'hook', 'script'];
// `reason` is a list of closed values; the valve `otro` needs `reason_note`, and only it does.
export const REASON_PENDING = 'pregunta-pendiente';
export const REASON_NO_QUESTION = 'conducta-sin-pregunta';
export const REASON_SINGLE = 'caso-unico';
export const REASONS = [REASON_PENDING, REASON_NO_QUESTION, REASON_SINGLE, OTHER];
// Why a lesson may have no question, and why it may have no machine signal.
export const NO_QUESTION_REASONS = [REASON_PENDING, REASON_NO_QUESTION];
export const NO_SIGNAL_REASONS = [REASON_PENDING, REASON_NO_QUESTION, OTHER];
const HUMAN_ORIGIN = 'pablo';
const ID_RE = /^[a-z0-9-]+$/;
const PR_SOURCE = /^#[1-9]\d*$/;
// A line number points at the wrong row as soon as main adds rows (merge=union hides the shift): refused.
const LINE_SOURCE = /:[1-9]\d*$/;
const DATED_ROW = /^\d{4}-\d{2}-\d{2} \| /;
const REPEATED = 'repetida: sí';
const STANDARDS = ['standards/code.md', 'standards/plan.md'];

// What kind of mechanism a repo path is; null when the path is none of the known kinds (then it is a fault).
const KINDS = [
  ['test', /^test\/[^/].*$/],
  ['hook', /^(\.claude\/hooks|\.githooks)\/[^/]+$/],
  ['skill', /^\.claude\/skills\/[^/]+\/(SKILL\.md|referencias\/[^/]+\.md)$/],
  ['standard', /^standards\/[^/]+\.md$/],
  ['script', /^scripts\/[^/].*$/],
];
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
    intervenciones: readFileSync(path.join(root, 'intervenciones.md'), 'utf8'),
    fileText: (p) => (existsSync(path.join(root, p)) ? readFileSync(path.join(root, p), 'utf8') : null),
  };
}

// [{id, text}] for every entry of lessons/ (an entry that is not NAME.json is kept, so BAD_ID can name it).
export function readLessons(root) {
  const dir = path.join(root, 'lessons');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().map((f) => ({ id: f.replace(/\.json$/, ''), file: f, text: readFileSync(path.join(dir, f), 'utf8') }));
}

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
  const note = Object.hasOwn(d, 'reason_note');
  if (reasons.includes(OTHER) !== note || (note && (typeof d.reason_note !== 'string' || d.reason_note.trim() === ''))) {
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
    const required = FIELDS.filter((f) => !OPTIONAL_FIELDS.includes(f));
    const keys = d === null || typeof d !== 'object' || Array.isArray(d) ? null : Object.keys(d);
    if (keys === null || !required.every((f) => keys.includes(f)) || !keys.every((k) => FIELDS.includes(k))) {
      add(LESSON_FAULTS.BAD_FIELDS, `the fields must be ${required.join(', ')} and, when the rules ask, ${OPTIONAL_FIELDS.join(', ')}`);
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
      faults.push({ code: LESSON_FAULTS.REPEATED_WITHOUT_LESSON, where: `intervenciones.md:${i + 1}`, message: `a row marked «${REPEATED}» cites no lessons/<id>.json of a lesson present` });
    }
  });
  return faults;
}
