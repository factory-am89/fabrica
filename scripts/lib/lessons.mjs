// The lesson registry validator: one JSON file per lesson in lessons/, a closed schema, nothing free-text.
// A lesson is an index row: the story lives once (a skill, a row of intervenciones.md, a PR) and the row points to it.
// Readers: test/lessons.test.js now, scripts/lessons.mjs (the count) in the next chunk.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readQuestions } from './questions.mjs';

export const LESSON_FAULTS = Object.freeze(
  Object.fromEntries([
    'BAD_ID',
    'NOT_JSON',
    'BAD_FIELDS',
    'BAD_VERSION',
    'UNKNOWN_CLASS',
    'BAD_SOURCE',
    'SOURCE_IS_LINE',
    'BAD_MECHANISM_KIND',
    'MECHANISM_MISSING',
    'MECHANISM_NO_MARK',
    'UNKNOWN_ORIGIN',
    'REPEATED_WITHOUT_LESSON',
  ].map((c) => [c, c])),
);

export const FIELDS = ['v', 'class', 'source', 'mechanism', 'origin'];
const VERSION = 1;
const NO_CLASS = 'none';
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
// {classes, origins, intervenciones, fileText(path) -> string | null}.
export function lessonContext(root) {
  const classes = STANDARDS.flatMap((s) => readQuestions(readFileSync(path.join(root, s), 'utf8')).map((q) => q.id));
  const agents = readdirSync(path.join(root, '.claude', 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  return {
    classes: [...classes, NO_CLASS],
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

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

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
    if (d === null || typeof d !== 'object' || Array.isArray(d) || !sameSet(Object.keys(d), FIELDS)) {
      add(LESSON_FAULTS.BAD_FIELDS, `the fields must be exactly ${FIELDS.join(', ')}`);
      continue;
    }
    if (d.v !== VERSION) add(LESSON_FAULTS.BAD_VERSION, `v must be ${VERSION}`);
    if (!ctx.classes.includes(d.class)) add(LESSON_FAULTS.UNKNOWN_CLASS, `class ${JSON.stringify(d.class)} is not a question id nor «${NO_CLASS}»`);
    if (!ctx.origins.includes(d.origin)) add(LESSON_FAULTS.UNKNOWN_ORIGIN, `origin ${JSON.stringify(d.origin)} is not an agent of .claude/agents/ nor «${HUMAN_ORIGIN}»`);
    if (typeof d.source === 'string' && LINE_SOURCE.test(d.source)) {
      add(LESSON_FAULTS.SOURCE_IS_LINE, `source ${JSON.stringify(d.source)} cites a line number, which moves when main adds rows; cite the PR as #<n>`);
    } else if (typeof d.source !== 'string' || !PR_SOURCE.test(d.source)) {
      add(LESSON_FAULTS.BAD_SOURCE, `source ${JSON.stringify(d.source)} must be #<n>`);
    }
    if (mechanismKind(d.mechanism) === null) {
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
