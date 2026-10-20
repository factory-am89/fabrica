// scripts/hygiene.mjs and scripts/lib/hygiene.mjs: each code of CODES has a case that lists it and cases that must not, with exact values
// (limits included). Roots are built here; vocabulary comes from scripts/lib, never retyped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliHygiene, RECORDS_FLAG } from '../scripts/hygiene.mjs';
import { MIN_CASES_PER_CELL, STANDARD } from '../scripts/golden.mjs';
import { MS_DAY } from '../scripts/lib/audit-data.mjs';
import { EXIT } from '../scripts/lib/exit.mjs';
import { CODES, GROUP, NEEDS_RECORDS, NOT_COMPUTED, hygiene, hygieneCounts, humanHygiene, mergeCandidates, promoteCandidates, readLessonRows, retireTextCandidates, reworkCandidates } from '../scripts/lib/hygiene.mjs';
import { DOC, REF, overlaps } from '../scripts/lib/hygiene-refs.mjs';
import { LESSONS_DIR, NO_LESSON_FILE, NO_QUESTION, SIGNAL_MACHINE, SIGNAL_NONE } from '../scripts/lib/lessons.mjs';
import { ANSWER, answersSummary, buildRecord, formatBlock } from '../scripts/lib/record.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = 'test/a.test.js'; // a mechanism that is a test
const S = 'scripts/s.mjs'; // a mechanism that is a script
const lesson = (id, question, mechanism, signal = SIGNAL_MACHINE) => ({ id, question, mechanism, signal });
const bullet = (text) => `- **b.** ${text}\n`;
const skillText = (...bullets) => `# s\n## Lo que falló\n${bullets.join('')}`;
const only = (r, code) => r.candidates.filter((c) => c.code === code);

function put(root, rel, text) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text);
}
// lessons: [{id, question, mechanism, signal}], skills: {name: SKILL.md text or {skill, refs: {file: text}}}, scripts: the npm scripts, missing: mechanisms that do not exist.
function root(t, { lessons = [], skills = {}, scripts = ['known'], missing = [], sources = ['#1'] } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fabrica-hygiene-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  put(dir, 'package.json', JSON.stringify({ scripts: Object.fromEntries(scripts.map((s) => [s, 'x'])) }));
  put(dir, NO_LESSON_FILE, JSON.stringify({ version: 1, entries: [] }));
  for (const l of lessons) {
    put(dir, `${LESSONS_DIR}/${l.id}.json`, JSON.stringify({ question: l.question, mechanism: l.mechanism, signal: l.signal, sources }));
    if (!missing.includes(l.mechanism)) put(dir, l.mechanism, '');
  }
  for (const [name, s] of Object.entries(skills)) {
    const { skill, refs = {} } = typeof s === 'string' ? { skill: s } : s;
    put(dir, `.claude/skills/${name}/SKILL.md`, skill);
    for (const [f, text] of Object.entries(refs)) put(dir, `.claude/skills/${name}/referencias/${f}`, text);
  }
  return dir;
}

test('CODES: the result counts every code, in order, and the lists are only lists (exit OK)', (t) => {
  const r = hygiene(root(t));
  assert.deepEqual(Object.keys(r.byCode), Object.values(CODES));
  assert.deepEqual(r.byCode, { [CODES.MERGE]: 0, [CODES.PROMOTE]: 0, [CODES.RETIRE_TEXT]: null, [CODES.REWORK]: null, [CODES.OVERLAP]: 0, [CODES.DEAD_REF]: 0 });
  assert.deepEqual([r.total, cliHygiene([root(t)]).code], [0, EXIT.OK]);
});

test('MERGE: the same question or the same mechanism; «none» is no class; a lone lesson is not listed', () => {
  const rows = Array.of(lesson('c', NO_QUESTION, S), lesson('b', 'C1', S), lesson('d', NO_QUESTION, 'scripts/o.mjs'), lesson('a', 'C1', T), lesson('e', 'C2', 'scripts/p.mjs'));
  assert.deepEqual(mergeCandidates(rows), [
    { code: CODES.MERGE, key: `${GROUP.mechanism}:${S}`, items: ['b', 'c'], by: GROUP.mechanism, value: S },
    { code: CODES.MERGE, key: `${GROUP.question}:C1`, items: ['a', 'b'], by: GROUP.question, value: 'C1' },
  ]);
});

test('PROMOTE: a «none»-signal lesson whose question already has a machine lesson with a test; its bullets are named', () => {
  const rows = Array.of(lesson('prose', 'C1', S, SIGNAL_NONE), lesson('alpha-prose', 'C1', S, SIGNAL_NONE), lesson('zz', 'C1', T), lesson('aa', 'C1', 'test/b.test.js'), lesson('other', 'C2', S, SIGNAL_NONE), lesson('script', 'C3', S), lesson('c3', 'C3', S, SIGNAL_NONE), lesson('nq', NO_QUESTION, S, SIGNAL_NONE), lesson('nq-test', NO_QUESTION, T));
  const skills = [{ name: 'sk', bullets: [bullet(`see ${LESSONS_DIR}/prose.json`)] }, { name: 'ab', bullets: [bullet(`also ${LESSONS_DIR}/prose.json`)] }, { name: 'ot', bullets: [bullet('no link')] }];
  assert.deepEqual(promoteCandidates(rows, skills), [
    { code: CODES.PROMOTE, key: 'alpha-prose', items: ['alpha-prose'], question: 'C1', test: 'test/b.test.js', bullets: [] },
    { code: CODES.PROMOTE, key: 'prose', items: ['prose'], question: 'C1', test: 'test/b.test.js', bullets: ['ab', 'sk'] },
  ]);
});

const effect = (...ls) => ({ lessons: ls });
const side = (cases, no) => ({ cases, no, rate: no / cases });
const eff = (id, before, after, conclusive = true) => ({ id, before, after, conclusive, change: before === null ? null : after.rate - before.rate });

test('RETIRE_TEXT: a machine lesson with no «no» in MIN_CASES_PER_CELL cases after it; one less case, one «no», or no machine: not listed', () => {
  const rows = Array.of(lesson('ok', 'C1', T), lesson('aa-ok', 'C2', T), lesson('few', 'C1', T), lesson('has-no', 'C1', T), lesson('prose', 'C1', T, SIGNAL_NONE), lesson('undated', NO_QUESTION, T));
  const e = effect(eff('ok', null, side(MIN_CASES_PER_CELL, 0), false), eff('aa-ok', null, side(MIN_CASES_PER_CELL + 1, 0), false), eff('few', null, side(MIN_CASES_PER_CELL - 1, 0), false), eff('has-no', side(MIN_CASES_PER_CELL, 1), side(MIN_CASES_PER_CELL, 1)), eff('prose', null, side(MIN_CASES_PER_CELL, 0), false), { id: 'undated', before: null, after: null, change: null, conclusive: false });
  assert.deepEqual(retireTextCandidates(rows, e), [
    { code: CODES.RETIRE_TEXT, key: 'aa-ok', items: ['aa-ok'], question: 'C2', after: side(MIN_CASES_PER_CELL + 1, 0) },
    { code: CODES.RETIRE_TEXT, key: 'ok', items: ['ok'], question: 'C1', after: side(MIN_CASES_PER_CELL, 0) },
  ]);
});

test('REWORK: conclusive, there was a «no» before and the rate did not go down (equal counts); lower, no «no» before, inconclusive: not listed', () => {
  const rows = Array.of(lesson('up', 'C2', T), lesson('same', 'C1', T), lesson('down', 'C3', T), lesson('none-before', 'C4', T), lesson('weak', 'C5', T));
  const n = MIN_CASES_PER_CELL;
  const e = effect(eff('same', side(n, 1), side(n, 1)), eff('up', side(n, 1), side(n, 2)), eff('down', side(n, 2), side(n, 1)), eff('none-before', side(n, 0), side(n, 0)), eff('weak', side(n, 1), side(n, 1), false));
  assert.deepEqual(reworkCandidates(rows, e).map((c) => [c.key, c.question, c.change]), [['same', 'C1', 0], ['up', 'C2', 1 / n]]);
  assert.deepEqual(reworkCandidates(rows, e)[0].before, side(n, 1));
  assert.deepEqual(reworkCandidates(rows, e)[0].after, side(n, 1));
  assert.throws(() => reworkCandidates(Array.of(lesson('lost', 'C1', T)), effect()), /lesson lost: not in the lesson-effect indicator/);
});

test('OVERLAP: skills that cite the same file, or a skill and a lesson of its mechanism it does not link; lesson-lesson and a linked lesson are not listed', (t) => {
  const r = hygiene(root(t, {
    lessons: [lesson('l1', 'C1', T), lesson('l2', 'C2', T), lesson('l3', 'C3', S)],
    skills: { alpha: skillText(bullet(`uses ${T} and ${S}.`)), beta: skillText(bullet(`uses ${S}, not ${LESSONS_DIR}/l3.json`)), gamma: { skill: skillText(bullet('x')), refs: { 'r.md': `cites ${T} ${S}` } } },
  }));
  assert.deepEqual(only(r, CODES.OVERLAP).map((c) => [c.key, c.files]), [
    [`lesson:l1 ~ skill:alpha`, [T]], [`lesson:l1 ~ skill:gamma`, [T]], [`lesson:l2 ~ skill:alpha`, [T]], [`lesson:l2 ~ skill:gamma`, [T]],
    [`lesson:l3 ~ skill:alpha`, [S]], [`lesson:l3 ~ skill:gamma`, [S]], [`skill:alpha ~ skill:beta`, [S]], [`skill:alpha ~ skill:gamma`, [S, T]], [`skill:beta ~ skill:gamma`, [S]],
  ]);
});

test('overlaps: the pairs come sorted whatever the order of the docs, and each pair is sorted too', () => {
  const doc = (kind, name) => ({ kind, name, cited: [T], text: '' });
  assert.deepEqual(overlaps([doc(DOC.skill, 'z'), doc(DOC.skill, 'a'), doc(DOC.skill, 'm')]), [
    { a: `${DOC.skill}:a`, b: `${DOC.skill}:m`, files: [T] },
    { a: `${DOC.skill}:a`, b: `${DOC.skill}:z`, files: [T] },
    { a: `${DOC.skill}:m`, b: `${DOC.skill}:z`, files: [T] },
  ]);
});

test('DEAD_REF: a missing path (SKILL.md or referencias, trailing dot included) or an npm command that does not exist; existing ones and non-paths are not listed', (t) => {
  const r = hygiene(root(t, {
    lessons: [lesson('gone', 'C1', 'scripts/gone.mjs'), lesson('odd', 'C2', 'nowhere/odd.txt'), lesson('live', 'C3', 'scripts/lib/live.mjs'), lesson('live2', 'C4', S)],
    missing: ['scripts/gone.mjs', 'nowhere/odd.txt'],
    skills: { sk: { skill: skillText(bullet(`see ${S}, run npm run known and npm run zabsent, edit scripts/nope.mjs.`)), refs: { 'r.md': 'also scripts/aaa.mjs and scripts/lib/ and scripts/<x>.mjs' } } },
  }));
  const dead = only(r, CODES.DEAD_REF).map((c) => [c.items[0], c.file, c.ref, c.kind]);
  assert.deepEqual(dead, [
    ['lesson:gone', `${LESSONS_DIR}/gone.json`, 'scripts/gone.mjs', REF.path],
    ['skill:sk', '.claude/skills/sk/SKILL.md', 'zabsent', REF.command],
    ['skill:sk', '.claude/skills/sk/SKILL.md', 'scripts/nope.mjs', REF.path],
    ['skill:sk', '.claude/skills/sk/referencias/r.md', 'scripts/aaa.mjs', REF.path],
  ]);
});

test('without records RETIRE_TEXT and REWORK are not computed (null, said apart); with them they are counted', (t) => {
  const dir = root(t);
  assert.deepEqual(hygiene(dir).notComputed, NEEDS_RECORDS.map((code) => ({ code, reason: NOT_COMPUTED.noRecords })));
  assert.deepEqual(NEEDS_RECORDS, [CODES.RETIRE_TEXT, CODES.REWORK]);
  const w = hygiene(dir, effect());
  assert.deepEqual([w.notComputed, w.byCode[CODES.RETIRE_TEXT], w.byCode[CODES.REWORK]], [[], 0, 0]);
});

test('readLessonRows: a lesson whose question, mechanism or signal is not readable stops it, naming the lesson', (t) => {
  const ok = { question: 'C1', mechanism: T, signal: SIGNAL_MACHINE };
  const bad = (id, d) => { const dir = root(t); put(dir, `${LESSONS_DIR}/${id}.json`, JSON.stringify({ ...ok, ...d })); return () => readLessonRows(dir); };
  assert.throws(bad('q', { question: 1 }), /lesson q: question must be a text/);
  assert.throws(bad('m', { mechanism: null }), /lesson m: mechanism must be a text/);
  assert.throws(bad('s', { signal: 'x' }), /lesson s: signal must be one of/);
});

test('a root without package.json stops hygiene (the commands cannot be checked), it is not read as no commands', (t) => {
  const dir = root(t);
  rmSync(path.join(dir, 'package.json'));
  assert.throws(() => hygiene(dir), /package.json/);
});

test('output: the human text names the totals, what is not computed and each candidate; hygieneCounts has no candidates', (t) => {
  const dir = root(t, { lessons: [lesson('a', 'C1', T), lesson('b', 'C1', S)] });
  const r = hygiene(dir);
  assert.deepEqual(humanHygiene(r).split('\n'), [
    `hygiene: 1 candidates ${JSON.stringify(r.byCode)}`,
    ...NEEDS_RECORDS.map((c) => `not computed ${c}: ${NOT_COMPUTED.noRecords}`),
    `${CODES.MERGE} ${GROUP.question}:C1: a, b`,
  ]);
  assert.deepEqual(Object.keys(hygieneCounts(dir)).sort(), ['byCode', 'notComputed', 'total']);
});

// A history where PR #1 (the source of both lessons) merges at DATE; MIN_CASES_PER_CELL rounds before it and as many from it.
const T0 = Date.parse('2026-03-01T00:00:00Z');
const DATE = T0 + 10 * MS_DAY;
const iso = (ms) => new Date(ms).toISOString();
const sha = (n) => n.toString(16).padStart(40, '0');
function records(answersOf) {
  const prs = [{ number: 1, created: T0, merged: DATE }];
  for (let i = 1; i < MIN_CASES_PER_CELL; i++) prs.push({ number: 100 + i, created: T0 + i * MS_DAY, merged: null });
  for (let i = 0; i < MIN_CASES_PER_CELL; i++) prs.push({ number: 200 + i, created: DATE + i * MS_DAY, merged: null });
  return {
    pulls: prs.map((p) => ({ number: p.number, state: 'open', created_at: iso(p.created), merged_at: p.merged === null ? null : iso(p.merged), head_ref: `feat/p${p.number}`, files: [], commits: [sha(p.number)] })),
    checkRuns: prs.map((p, i) => ({ head_sha: sha(p.number), output: { title: 'x', summary: 'x', text: formatBlock(buildRecord({ repo: 'o/r', pr: p.number, sha: sha(p.number), standard: STANDARD, veredicto: { ok: true }, respuestas: answersSummary(answersOf(i)), run: null, error: null })) } })),
  };
}

test('--records: RETIRE_TEXT and REWORK from a real history, through the command (text, --json and USAGE errors)', (t) => {
  const dir = root(t, { lessons: [lesson('quiet', 'C1', T), lesson('noisy', 'C2', S, SIGNAL_NONE)] });
  const file = path.join(dir, 'records.json');
  writeFileSync(file, JSON.stringify(records((i) => ({ C1: ANSWER.yes, C2: i === 0 || i === MIN_CASES_PER_CELL ? ANSWER.no : ANSWER.yes }))));
  const r = cliHygiene(['--json', RECORDS_FLAG, file, dir]);
  assert.equal(r.code, EXIT.OK, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual([out.byCode, out.notComputed], [{ [CODES.MERGE]: 0, [CODES.PROMOTE]: 0, [CODES.RETIRE_TEXT]: 1, [CODES.REWORK]: 1, [CODES.OVERLAP]: 0, [CODES.DEAD_REF]: 0 }, []]);
  assert.deepEqual(out.candidates.map((c) => [c.code, c.key, c.question]), [[CODES.RETIRE_TEXT, 'quiet', 'C1'], [CODES.REWORK, 'noisy', 'C2']]);
  assert.deepEqual(out.candidates[0].after, { cases: MIN_CASES_PER_CELL, no: 0, rate: 0 });
  assert.match(cliHygiene([RECORDS_FLAG, file, dir]).stdout, new RegExp(`^${CODES.RETIRE_TEXT} quiet: quiet$`, 'm'));
  assert.equal(cliHygiene([dir, RECORDS_FLAG]).code, EXIT.USAGE);
  assert.equal(cliHygiene(['--nope', dir]).code, EXIT.USAGE);
  assert.equal(cliHygiene([RECORDS_FLAG, path.join(dir, 'missing.json'), dir]).code, EXIT.UNEXPECTED);
});

test('the real entry point: node scripts/hygiene.mjs --json prints one JSON object with the three keys and the candidates', () => {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'hygiene.mjs'), '--json'], { encoding: 'utf8', cwd: RAIZ });
  assert.equal(r.status, EXIT.OK, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual([out.ok, Object.keys(out.byCode), out.total], [true, Object.values(CODES), out.candidates.length]);
});
