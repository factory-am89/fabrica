// The indicator judge-rounds: judgments of the revisor per merged PR. Records are built with buildRecord (the schema lives in
// scripts/lib/record.mjs); the vocabulary of the figure (LAST_BUCKET, NOT_MEASURED) is imported, never retyped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditData } from '../scripts/audit.mjs';
import { BOUND, CAVEAT, DATA_IDS, readPulls } from '../scripts/lib/audit-data.mjs';
import { LAST_BUCKET, NOT_MEASURED, judgeRounds } from '../scripts/lib/judge-rounds.mjs';
import { buildRecord, formatBlock } from '../scripts/lib/record.mjs';

const sha = (n) => String(n).padStart(40, '0');
const NOW = Date.parse('2026-10-27T00:00:00Z');
const pull = (number, commits, merged = true) => ({
  number, state: 'closed', created_at: `2026-10-${10 + number}T10:00:00Z`, merged_at: merged ? `2026-10-${10 + number}T12:00:00Z` : null, head_ref: `feat/p${number}`, files: [`f${number}.js`], commits: commits.map(sha),
});
const record = (pr, n, ok, error = null) => buildRecord({ repo: 'o/r', pr, sha: sha(n), standard: 'standards/code.md', veredicto: { ok }, respuestas: { answers: { C1: ok ? 'sí' : 'no' } }, run: null, error });
const checkRun = (r) => ({ head_sha: r.sha, output: { title: 'x', summary: 'x', text: formatBlock(r) } });
const figure = (pulls, records) => judgeRounds(readPulls(pulls), records);

test('distribution, mean and share judged once, over merged PRs only; the last bucket gathers the rest', () => {
  const pulls = [pull(1, [1]), pull(2, [2, 3]), pull(3, [4, 5, 6, 7, 8, 9, 10]), pull(4, [11], false), pull(5, [12])];
  const records = [
    record(1, 1, true),
    record(2, 2, false), record(2, 3, true),
    ...[4, 5, 6, 7, 8, 9, 10].map((n) => record(3, n, n === 10)),
    record(4, 11, false),
  ];
  const f = figure(pulls, records);
  assert.equal(f.mergedPrs, 4);
  assert.equal(f.judgedPrs, 3);
  assert.equal(f.withoutJudgment, 1);
  assert.deepEqual(f.distribution, { 1: 1, 2: 1, [LAST_BUCKET]: 1 });
  assert.equal(f.judgments, 10);
  assert.equal(f.mean, 10 / 3);
  assert.deepEqual([f.firstTime, f.firstTimeRate], [1, 1 / 3]);
  assert.equal(f.recordsOfOtherPrs, 1);
  assert.ok(f.notMeasured.includes(NOT_MEASURED.pushWithoutNo));
});

test('what it does not measure is counted: pushes after a yes, reruns of the same sha, errors', () => {
  const pulls = [pull(1, [1, 2, 3])];
  const records = [record(1, 1, true), record(1, 2, false), record(1, 2, false), record(1, 3, false, 'output-unreadable')];
  const f = figure(pulls, records);
  assert.equal(f.judgments, 4);
  assert.equal(f.pushesAfterYes, 1);
  assert.equal(f.sameShaRepeats, 1);
  assert.equal(f.judgmentsWithError, 1);
});

test('no merged PR: no figure, nothing divided by zero', () => {
  const f = figure([pull(1, [1], false)], [record(1, 1, false)]);
  assert.deepEqual([f.mean, f.firstTimeRate, f.from, f.to, f.judgedPrs], [null, null, null, null, 0]);
});

test('auditData carries it as a data indicator, an upper bound with its caveat', () => {
  const out = auditData({ pulls: [pull(1, [1])], checkRuns: [checkRun(record(1, 1, true))] }, { now: NOW });
  assert.equal(out[DATA_IDS.judgeRounds].judgedPrs, 1);
  assert.equal(out[DATA_IDS.judgeRounds].bound, BOUND.upper);
  assert.equal(out[DATA_IDS.judgeRounds].caveat, CAVEAT.judgmentsNotAnswers);
});
