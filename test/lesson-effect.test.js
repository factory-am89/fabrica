// audit --data (chunk 17): the effect of each lesson on the «no» of its question, the «no» nobody triaged, and the false-«no» rate of each
// question. Histories are built here with exact numbers (and the edges: exactly at the lesson's date, 4 vs MIN_CASES_PER_CELL cases) so each
// rule has a test that goes red when it is broken. Vocabulary is imported from scripts/lib and scripts/golden.mjs, never retyped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDICATORS, auditData, cliAudit } from '../scripts/audit.mjs';
import { MIN_CASES_PER_CELL, STANDARD } from '../scripts/golden.mjs';
import { DATA_IDS, humanData } from '../scripts/lib/audit-data.mjs';
import { WHY, lessonIndicators, readTriagedNo } from '../scripts/lib/lesson-effect.mjs';
import { LESSONS_DIR, NO_QUESTION } from '../scripts/lib/lessons.mjs';
import { ANSWER, ERROR, OVERRIDE_TITLE, answersSummary, buildRecord, formatBlock } from '../scripts/lib/record.mjs';
import { KINDS, OUTCOME_NOISE, REVIEWER_NO_FILE, REVIEWER_NO_KEYS } from '../scripts/lib/reviewer-no.mjs';

// A «no» that ended in a lesson (outcome = the id of a lesson) and one that ended as noise of the judge.
const COVERED = 'some-lesson';
const NOISE = OUTCOME_NOISE;

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECORDS = path.join(RAIZ, 'test', 'fixtures', 'audit', 'records.json');
const DAY = 86400000;
const T0 = Date.parse('2026-03-01T00:00:00Z');
const DATE = T0 + 10 * DAY; // the merge of the source PR of the lessons below
const iso = (ms) => new Date(ms).toISOString();
const sha = (n) => n.toString(16).padStart(40, '0');
const Q = 'C5';
const OTHER_Q = 'C1';
const REPO_NAME = 'o/r';
const ELSEWHERE = path.join(tmpdir(), 'no-such-messages.jsonl');

const pull = (number, created, merged = null) => ({ number, state: merged === null ? 'open' : 'closed', created_at: iso(created), merged_at: merged === null ? null : iso(merged), head_ref: `feat/p${number}`, files: [], commits: [sha(number)] });
const round = (pr, answers, { error = null, shaOf = sha(pr) } = {}) => ({
  head_sha: shaOf,
  output: { title: 'x', summary: 'x', text: formatBlock(buildRecord({ repo: REPO_NAME, pr, sha: shaOf, standard: STANDARD, veredicto: { ok: !Object.values(answers).includes(ANSWER.no) && error === null }, respuestas: answersSummary(answers), run: null, error })) },
});
const override = (shaOf) => ({ head_sha: shaOf, output: { title: OVERRIDE_TITLE, summary: 'x', text: '' } });

// A root with the lessons ([{id, question, sources: ['#n']}]) and the triaged «no» ([{source, question, outcome}]) the indicators read.
function root(t, { lessons = [], entries = [] } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fabrica-effect-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, LESSONS_DIR));
  for (const l of lessons) writeFileSync(path.join(dir, LESSONS_DIR, `${l.id}.json`), JSON.stringify({ question: l.question, sources: l.sources }));
  writeFileSync(path.join(dir, REVIEWER_NO_FILE), JSON.stringify({ version: 1, rows: entries.map((e) => ({ [REVIEWER_NO_KEYS.source]: e.source, [REVIEWER_NO_KEYS.question]: e.question, [REVIEWER_NO_KEYS.kind]: e.kind ?? KINDS[0], [REVIEWER_NO_KEYS.outcome]: e.outcome })) }));
  return dir;
}
const measure = (t, setup, pulls, checkRuns, extra = {}) => auditData({ pulls, checkRuns }, { root: root(t, setup), now: T0, messagesPath: ELSEWHERE, ...extra });
const LESSON = { id: 'l1', question: Q, sources: ['#1'] };
// PR 1 (the source) merges at DATE; `before` PRs (PR 1 included) are created before it and `after` ones from it; all answer the question yes.
function history(before, after) {
  const pulls = [pull(1, T0, DATE)];
  for (let i = 1; i < before; i++) pulls.push(pull(100 + i, T0 + i * DAY));
  for (let i = 0; i < after; i++) pulls.push(pull(200 + i, DATE + i * DAY));
  return { pulls, checkRuns: pulls.map((p) => round(p.number, { [Q]: ANSWER.yes })) };
}

test('lesson effect: the «no» rate of the question before and after the date of the lesson, with exact counts', (t) => {
  const answers = [[1, ANSWER.no], [2, ANSWER.no], [3, ANSWER.yes], [4, ANSWER.yes]];
  const pulls = [pull(1, T0, DATE), pull(2, T0 + DAY), pull(3, T0 + 2 * DAY), pull(4, T0 + 3 * DAY), pull(5, DATE - 1), pull(6, T0), pull(7, T0), pull(8, T0)];
  const runs = answers.map(([pr, a]) => round(pr, { [Q]: a, [OTHER_Q]: ANSWER.no }));
  runs.push(round(5, { [Q]: ANSWER.yes, [OTHER_Q]: ANSWER.no }));
  runs.push(round(6, { [Q]: ANSWER.notApplicable }), round(7, { [Q]: null }), round(8, { [Q]: ANSWER.no }, { error: ERROR.standardUnloadable }));
  const later = [[9, DATE, ANSWER.yes], [10, DATE + DAY, ANSWER.yes], [11, DATE + DAY, ANSWER.yes], [12, DATE + DAY, ANSWER.yes], [13, DATE + DAY, ANSWER.no]];
  for (const [pr, created, a] of later) {
    pulls.push(pull(pr, created));
    runs.push(round(pr, { [Q]: a, [OTHER_Q]: ANSWER.no }));
  }
  const e = measure(t, { lessons: [LESSON] }, pulls, runs)[DATA_IDS.lessonEffect];
  assert.deepEqual([e.minCases, e.count, e.conclusive], [MIN_CASES_PER_CELL, 1, 1]);
  const [l] = e.lessons;
  assert.deepEqual([l.id, l.question, l.date, l.conclusive, l.why], [LESSON.id, Q, iso(DATE), true, []]);
  assert.deepEqual(l.before, { cases: 5, no: 2, rate: 0.4 });
  assert.deepEqual(l.after, { cases: 5, no: 1, rate: 0.2 });
  assert.ok(Math.abs(l.change - (0.2 - 0.4)) < Number.EPSILON * 4, String(l.change));
});

test('lesson effect: fewer than MIN_CASES_PER_CELL cases on either side is «no concluyente»; exactly MIN is conclusive', (t) => {
  const at = (before, after) => measure(t, { lessons: [LESSON] }, ...Object.values(history(before, after)))[DATA_IDS.lessonEffect];
  const enough = at(MIN_CASES_PER_CELL, MIN_CASES_PER_CELL);
  assert.deepEqual([enough.conclusive, enough.lessons[0].why], [1, []]);
  for (const [before, after] of [[MIN_CASES_PER_CELL - 1, MIN_CASES_PER_CELL], [MIN_CASES_PER_CELL, MIN_CASES_PER_CELL - 1]]) {
    const [l] = at(before, after).lessons;
    assert.deepEqual([l.conclusive, l.why, l.change], [false, [WHY.fewCases], null], `${before}/${after}`);
    assert.deepEqual([l.before.cases, l.after.cases], [before, after]);
  }
});

test('lesson effect: the date is the latest merged source; a lesson without question or without a merged source says why', (t) => {
  const later = DATE + 10 * DAY;
  const pulls = [pull(1, T0, DATE), pull(2, T0, later), pull(4, T0)];
  const lessons = [
    { id: 'latest', question: Q, sources: ['#1', '#2', '#4'] },
    { id: 'noq', question: NO_QUESTION, sources: ['#1'] },
    { id: 'nodate', question: Q, sources: ['#4'] },
    { id: 'absent', question: Q, sources: ['#3'] },
    { id: 'partial', question: Q, sources: ['#1', '#3'] },
    { id: 'neither', question: NO_QUESTION, sources: ['#3'] },
  ];
  const effect = measure(t, { lessons }, pulls, [])[DATA_IDS.lessonEffect];
  assert.deepEqual([effect.count, effect.conclusive], [lessons.length, 0]);
  const byId = Object.fromEntries(effect.lessons.map((l) => [l.id, l]));
  assert.equal(byId.latest.date, iso(later));
  assert.deepEqual(byId.latest.why, [WHY.fewCases]);
  assert.deepEqual([byId.noq.date, byId.noq.why, byId.noq.before, byId.noq.after, byId.noq.conclusive], [iso(DATE), [WHY.noQuestion], null, null, false]);
  assert.deepEqual([byId.nodate.date, byId.nodate.why, byId.nodate.before], [null, [WHY.noDate], null]);
  assert.deepEqual([byId.absent.date, byId.absent.why], [null, [WHY.sourceNotInData]]);
  assert.deepEqual([byId.partial.date, byId.partial.why], [null, [WHY.sourceNotInData]]);
  assert.deepEqual(byId.neither.why, [WHY.noQuestion, WHY.sourceNotInData]);
});

test('unsorted «no»: a (PR, question) with a «no» that no lesson of that PR and question, nor triaged entry, covers; sorted, with its rounds', (t) => {
  const pulls = [1, 2, 3, 4, 5, 6, 7].map((n) => pull(n, T0));
  const runs = [
    round(7, { [OTHER_Q]: ANSWER.no }),
    round(1, { [Q]: ANSWER.no, [OTHER_Q]: ANSWER.no }),
    round(2, { [Q]: ANSWER.no }),
    round(3, { [Q]: ANSWER.no, [OTHER_Q]: ANSWER.no }),
    round(3, { [Q]: ANSWER.no }, { shaOf: sha(33) }),
    round(4, { [Q]: ANSWER.no }),
    round(5, { [Q]: ANSWER.no }),
    round(6, { [Q]: ANSWER.no }, { error: ERROR.standardUnloadable }),
    round(6, { [Q]: ANSWER.yes }, { shaOf: sha(66) }),
  ];
  const lessons = [{ id: 'covers-1', question: Q, sources: ['#1'] }, { id: 'no-question', question: NO_QUESTION, sources: ['#4'] }, { id: 'other-pr', question: Q, sources: ['#9'] }];
  const entries = [{ source: '#2', question: Q, outcome: COVERED }, { source: '#5', question: OTHER_Q, outcome: NOISE }];
  const u = measure(t, { lessons, entries }, pulls, runs)[DATA_IDS.unsortedNo];
  assert.deepEqual(u.items, [{ pr: 1, question: OTHER_Q, rounds: 1 }, { pr: 3, question: OTHER_Q, rounds: 1 }, { pr: 3, question: Q, rounds: 2 }, { pr: 4, question: Q, rounds: 1 }, { pr: 5, question: Q, rounds: 1 }, { pr: 7, question: OTHER_Q, rounds: 1 }]);
  assert.deepEqual([u.total, u.count], [8, 6]);
});

test('false «no»: (noise entries + overrides) over the «no» of each question; an override counts once per question of its round and an unplaced one is counted apart', (t) => {
  const pulls = [1, 2, 3, 4, 5].map((n) => pull(n, T0));
  const runs = [
    round(1, { [Q]: ANSWER.no }),
    round(2, { [Q]: ANSWER.no, [OTHER_Q]: ANSWER.no }),
    round(2, { [Q]: ANSWER.no, [OTHER_Q]: ANSWER.no }, { shaOf: sha(22) }),
    round(2, { [Q]: ANSWER.no, [OTHER_Q]: ANSWER.no }),
    round(3, { [Q]: ANSWER.no }),
    round(4, { [Q]: ANSWER.yes, [OTHER_Q]: ANSWER.yes }),
    round(5, { [Q]: ANSWER.no }, { error: ERROR.outputUnreadable }),
    override(sha(2)), override(sha(22)), override(sha(5)), override(sha(404)),
  ];
  const entries = [
    { source: '#1', question: Q, outcome: NOISE }, { source: '#2', question: Q, outcome: NOISE }, { source: '#3', question: Q, outcome: COVERED },
    { source: '#3', question: 'C9', outcome: NOISE },
  ];
  const f = measure(t, { entries }, pulls, runs)[DATA_IDS.falseNo];
  assert.deepEqual(f.byQuestion[Q], { no: 5, noise: 2, overrides: 2, falseNo: 4, rate: 0.8, unstable: null });
  assert.deepEqual(f.byQuestion[OTHER_Q], { no: 3, noise: 0, overrides: 2, falseNo: 2, rate: 2 / 3, unstable: null });
  assert.deepEqual(f.byQuestion.C9, { no: 0, noise: 1, overrides: 0, falseNo: 1, rate: null, unstable: null });
  assert.deepEqual(Object.keys(f.byQuestion), [OTHER_Q, Q, 'C9']);
  assert.deepEqual([f.overridesUnattributed, f.unstableQuestions], [2, null]);
});

test('false «no»: a rate below one, and noise of another question or of another reason does not count', (t) => {
  const pulls = [1, 2, 3, 4].map((n) => pull(n, T0));
  const runs = pulls.map((p) => round(p.number, { [Q]: ANSWER.no }));
  const entries = [{ source: '#1', question: Q, outcome: NOISE }, { source: '#2', question: Q, outcome: COVERED }, { source: '#3', question: OTHER_Q, outcome: NOISE }];
  assert.deepEqual(measure(t, { entries }, pulls, runs)[DATA_IDS.falseNo].byQuestion[Q], { no: 4, noise: 1, overrides: 0, falseNo: 1, rate: 0.25, unstable: null });
});

test('without the Fábrica\'s own files (--repo) the three indicators are null, not zero', () => {
  const d = JSON.parse(cliAudit(['--json', '--data', '--records', RECORDS]).stdout);
  assert.notEqual(d[DATA_IDS.lessonEffect], null);
  const none = auditData({ pulls: [pull(1, T0)], checkRuns: [] }, { now: T0 });
  for (const id of [DATA_IDS.lessonEffect, DATA_IDS.unsortedNo, DATA_IDS.falseNo]) assert.equal(none[id], null, id);
  assert.ok([DATA_IDS.lessonEffect, DATA_IDS.unsortedNo, DATA_IDS.falseNo].every((id) => Object.values(INDICATORS).includes(id)));
});

test('the text output has one line per indicator, with the figures', (t) => {
  const { pulls, checkRuns } = history(MIN_CASES_PER_CELL, MIN_CASES_PER_CELL);
  const lines = humanData(measure(t, { lessons: [LESSON] }, pulls, checkRuns)).split('\n');
  for (const id of [DATA_IDS.lessonEffect, DATA_IDS.unsortedNo, DATA_IDS.falseNo]) assert.ok(lines.some((l) => l.startsWith(`${id}: {`)), id);
  assert.ok(lines.find((l) => l.startsWith(`${DATA_IDS.unsortedNo}: `)).includes('"count":0'));
});

test('the triaged «no» are read in one place and come out normalised; broken inputs stop the figure', (t) => {
  const entries = [{ source: '#12', question: Q, outcome: NOISE }, { source: '#3', question: OTHER_Q, outcome: COVERED }];
  assert.deepEqual(readTriagedNo(root(t, { entries })), [{ source: 12, question: Q, noise: true }, { source: 3, question: OTHER_Q, noise: false }]);
  // Two classes of failure on one PR and one question are two items, each read on its own.
  const twoKinds = [{ source: '#4', question: Q, kind: KINDS[0], outcome: NOISE }, { source: '#4', question: Q, kind: KINDS[1], outcome: COVERED }];
  assert.deepEqual(readTriagedNo(root(t, { entries: twoKinds })), [{ source: 4, question: Q, noise: true }, { source: 4, question: Q, noise: false }]);
  const fresh = mkdtempSync(path.join(tmpdir(), 'fabrica-effect-'));
  t.after(() => rmSync(fresh, { recursive: true, force: true }));
  assert.throws(() => measure(t, {}, [], [], { root: fresh }), /not found/);
  writeFileSync(path.join(fresh, REVIEWER_NO_FILE), JSON.stringify({ rows: {} }));
  assert.throws(() => measure(t, {}, [], [], { root: fresh }), /rows must be a list/);
  const noSources = root(t);
  writeFileSync(path.join(noSources, LESSONS_DIR, 'x.json'), JSON.stringify({ question: Q }));
  assert.throws(() => measure(t, {}, [], [], { root: noSources }), /lesson x: no list of sources/);
  for (const bad of ['4', '#0', '#x', 4]) {
    const lesson = root(t, { lessons: [{ id: 'bad', question: Q, sources: [bad] }] });
    assert.throws(() => measure(t, {}, [], [], { root: lesson }), /must be #<n>/, String(bad));
    const entry = root(t, { entries: [{ source: bad, question: Q, outcome: NOISE }] });
    assert.throws(() => measure(t, {}, [], [], { root: entry }), /must be #<n>/, String(bad));
  }
  assert.throws(() => measure(t, {}, [pull(1, T0)], [round(2, { [Q]: ANSWER.yes })]), /PR #2 has no PR/);
  assert.throws(() => measure(t, {}, [], [{ output: { title: OVERRIDE_TITLE } }]), /override check-run has no head_sha/);
  assert.throws(() => measure(t, {}, [], [{ head_sha: sha(1), output: { text: 'sin registro' } }]), /readable record/);
  assert.throws(() => lessonIndicators([], [{ head_sha: sha(1), output: { text: 'sin registro' } }], { lessons: [], triaged: [], unstable: null }), /readable record/);
});
