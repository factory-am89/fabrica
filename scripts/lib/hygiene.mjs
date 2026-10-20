// Hygiene of the lessons (chunk 19 of plans/trabajar-solos.md): the machine lists candidates, a closed vocabulary (CODES), and changes nothing.
// Each candidate is drafted by an agent in a PR of its own and judged by the reviewer. Signals, not gates: no candidate makes anything fail.
// «class» of the plan is the `question` of a lesson (v2 replaced `class` by it); a lesson without question (`none`) has no class to group by.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MIN_CASES_PER_CELL } from '../golden.mjs';
import { DOC, byText, citedPaths, deadRefs, overlaps, readSkills } from './hygiene-refs.mjs';
import { LESSONS_DIR, NO_QUESTION, SIGNALS, SIGNAL_MACHINE, SIGNAL_NONE, mechanismKind, readLessons } from './lessons.mjs';

export const CODES = Object.freeze(Object.fromEntries(['MERGE', 'PROMOTE', 'RETIRE_TEXT', 'REWORK', 'OVERLAP', 'DEAD_REF'].map((c) => [c, c])));
// The codes that need the PRs and rounds of `audit --data` (a records file); without it they are not computed, and the result says so.
export const NEEDS_RECORDS = Object.freeze([CODES.RETIRE_TEXT, CODES.REWORK]);
export const NOT_COMPUTED = Object.freeze({ noRecords: 'needs-records' });
export const GROUP = Object.freeze({ question: 'question', mechanism: 'mechanism' });
// The kind of mechanism that is a test: the one a path of test/ has, read from lessons.mjs and not retyped.
const TEST_KIND = mechanismKind('test/x.test.js');

const sorted = (list, key) => [...list].sort((a, b) => byText(key(a), key(b)));
const candidate = (code, key, items, extra = {}) => ({ code, key, items, ...extra });

// [{id, question, mechanism, signal, sources}] of lessons/; a lesson that cannot be read stops the command (a wrong figure is worse than none).
export function readLessonRows(root) {
  return readLessons(root).map((l) => {
    const d = JSON.parse(l.text);
    const bad = (what) => new Error(`lesson ${l.id}: ${what}`);
    if (typeof d.question !== 'string') throw bad('question must be a text');
    if (typeof d.mechanism !== 'string') throw bad('mechanism must be a text');
    if (!SIGNALS.includes(d.signal)) throw bad(`signal must be one of ${SIGNALS.join(', ')}`);
    return { id: l.id, question: d.question, mechanism: d.mechanism, signal: d.signal };
  });
}

// MERGE: lessons of the same question (not «none») or of the same mechanism.
export function mergeCandidates(rows) {
  const out = [];
  for (const by of Object.values(GROUP)) {
    const groups = new Map();
    for (const r of rows) if (by !== GROUP.question || r.question !== NO_QUESTION) groups.set(r[by], [...(groups.get(r[by]) ?? []), r.id]);
    for (const [value, ids] of groups) if (ids.length > 1) out.push(candidate(CODES.MERGE, `${by}:${value}`, ids.sort(byText), { by, value }));
  }
  return sorted(out, (c) => c.key);
}

// PROMOTE: a lesson with signal «none» and a question, whose question already has a lesson of signal machine whose mechanism is a test.
// `bullets` = the skills with a bullet that links the lesson: that prose goes once the test is the memory.
export function promoteCandidates(rows, skills) {
  const out = [];
  for (const r of rows.filter((x) => x.signal === SIGNAL_NONE && x.question !== NO_QUESTION)) {
    const test = sorted(rows.filter((x) => x.question === r.question && x.signal === SIGNAL_MACHINE && mechanismKind(x.mechanism) === TEST_KIND), (x) => x.id)[0];
    if (test === undefined) continue;
    const bullets = skills.filter((s) => s.bullets.some((b) => b.includes(`${LESSONS_DIR}/${r.id}.json`))).map((s) => s.name).sort(byText);
    out.push(candidate(CODES.PROMOTE, r.id, [r.id], { question: r.question, test: test.mechanism, bullets }));
  }
  return sorted(out, (c) => c.key);
}

// effect: the `lesson-effect` indicator of audit --data ({lessons: [{id, question, before, after, change, conclusive}]}).
const effectOf = (effect, id) => {
  const e = effect.lessons.find((l) => l.id === id);
  if (e === undefined) throw new Error(`lesson ${id}: not in the lesson-effect indicator (the records and the lessons do not match)`);
  return e;
};

// RETIRE_TEXT: a lesson of signal machine whose question had no «no» in MIN_CASES_PER_CELL cases or more after it: the text goes, the test stays.
export function retireTextCandidates(rows, effect) {
  const out = [];
  for (const r of rows.filter((x) => x.signal === SIGNAL_MACHINE)) {
    const e = effectOf(effect, r.id);
    if (e.after !== null && e.after.cases >= MIN_CASES_PER_CELL && e.after.no === 0) out.push(candidate(CODES.RETIRE_TEXT, r.id, [r.id], { question: r.question, after: e.after }));
  }
  return sorted(out, (c) => c.key);
}

// REWORK: a conclusive effect (MIN_CASES_PER_CELL cases on each side) whose «no» rate did not go down while there was something to lower (before had a «no»).
export function reworkCandidates(rows, effect) {
  const out = [];
  for (const r of rows) {
    const e = effectOf(effect, r.id);
    if (e.conclusive && e.before.no > 0 && e.after.rate >= e.before.rate) out.push(candidate(CODES.REWORK, r.id, [r.id], { question: r.question, before: e.before, after: e.after, change: e.change }));
  }
  return sorted(out, (c) => c.key);
}

// OVERLAP and DEAD_REF: what the lessons and the skills cite (see hygiene-refs.mjs).
export function refCandidates(root, rows, skills) {
  const scriptNames = Object.keys(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts);
  const docs = [
    ...rows.map((r) => ({ kind: DOC.lesson, name: r.id, cited: mechanismKind(r.mechanism) === null ? [] : [r.mechanism], text: null })),
    ...skills.map((s) => ({ kind: DOC.skill, name: s.name, cited: [...new Set(s.files.flatMap((f) => citedPaths(f.text)))].sort(), text: s.files.map((f) => f.text).join('\n') })),
  ];
  return [
    ...overlaps(docs).map((o) => candidate(CODES.OVERLAP, `${o.a} ~ ${o.b}`, [o.a, o.b], { files: o.files })),
    ...deadRefs({ skills, lessons: rows, root, scriptNames }).map((d) => candidate(CODES.DEAD_REF, `${d.doc} -> ${d.ref}`, [d.doc], { file: d.file, ref: d.ref, kind: d.kind })),
  ];
}

// effect = null: no records, so the codes of NEEDS_RECORDS are not computed (count null, never 0) and notComputed names them.
export function hygiene(root, effect = null) {
  const rows = readLessonRows(root);
  const skills = readSkills(root);
  const refs = refCandidates(root, rows, skills);
  const found = [
    ...mergeCandidates(rows),
    ...promoteCandidates(rows, skills),
    ...(effect === null ? [] : retireTextCandidates(rows, effect)),
    ...(effect === null ? [] : reworkCandidates(rows, effect)),
    ...refs.filter((c) => c.code === CODES.OVERLAP),
    ...refs.filter((c) => c.code === CODES.DEAD_REF),
  ];
  const skipped = effect === null ? NEEDS_RECORDS : [];
  const byCode = Object.fromEntries(Object.values(CODES).map((c) => [c, skipped.includes(c) ? null : found.filter((x) => x.code === c).length]));
  return { total: found.length, byCode, notComputed: skipped.map((code) => ({ code, reason: NOT_COMPUTED.noRecords })), candidates: found };
}

// What audit counts: the totals by code and what was not computed, without the candidates themselves.
export const hygieneCounts = (root) => {
  const { total, byCode, notComputed } = hygiene(root);
  return { total, byCode, notComputed };
};

export const humanHygiene = (r) => [
  `hygiene: ${r.total} candidates ${JSON.stringify(r.byCode)}`,
  ...r.notComputed.map((n) => `not computed ${n.code}: ${n.reason}`),
  ...r.candidates.map((c) => `${c.code} ${c.key}: ${c.items.join(', ')}`),
].join('\n');
