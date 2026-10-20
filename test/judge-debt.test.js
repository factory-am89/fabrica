// scripts/lib/judge-debt.mjs (chunk 28): the count of commits of main on the judge after the head_sha of the last good pass of the corpus.
// Concrete values at the edges (one millisecond either side of the head, exactly N days, the run that did not end well). It does not cover
// the download (test/collect-judge.test.js) nor the audit entry point (test/audit.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JUDGE_PATHS } from '../scripts/golden.mjs';
import { MS_DAY } from '../scripts/lib/audit-data.mjs';
import { GOLDEN_OK, JUDGE_NOT_COMPUTED, JUDGE_WHY, apiPath, judgeDebt, lastPassed } from '../scripts/lib/judge-debt.mjs';

const T0 = Date.parse('2026-03-01T00:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const NOW = T0 + 10 * MS_DAY;
const sha = (n) => String(n).repeat(40).slice(0, 40);
const HEAD = sha('a');
const run = (headSha, offset, conclusion = GOLDEN_OK) => ({ created_at: iso(T0 + offset), head_sha: headSha, conclusion });
const commit = (n, offset) => ({ sha: sha(n), date: iso(T0 + offset) });
// A judge whose last good run has HEAD (committed at T0) as head_sha.
const judgeOf = (commits, runs = [run(HEAD, MS_DAY)]) => ({ runs, commits, heads: { [HEAD]: iso(T0) } });

test('the judge paths are the four the push of golden.yml had before chunk 25, and a folder glob is asked as the folder', () => {
  assert.deepEqual([...JUDGE_PATHS], ['.claude/agents/revisor.md', 'standards/**', '.github/workflows/revisor.yml', 'scripts/veredicto.mjs']);
  assert.deepEqual(JUDGE_PATHS.map(apiPath), ['.claude/agents/revisor.md', 'standards', '.github/workflows/revisor.yml', 'scripts/veredicto.mjs']);
});

test('without judge data the figure says «no calculado» out loud and is not a zero', () => {
  for (const missing of [undefined, null]) {
    const d = judgeDebt(missing, NOW);
    assert.deepEqual(d, { computed: false, state: JUDGE_NOT_COMPUTED, conclusive: false, why: [JUDGE_WHY.noJudgeData] });
    assert.equal(Object.hasOwn(d, 'count'), false);
  }
});

test('only the commits after the head_sha count: the head itself and one millisecond before it do not, one millisecond after it does', () => {
  const d = judgeDebt(judgeOf([{ sha: HEAD, date: iso(T0) }, commit(1, -1), commit(2, 1)]), NOW);
  assert.deepEqual(d.shas, [sha(2)]);
  assert.equal(d.count, 1);
});

test('a commit made in the same instant as the head_sha but not the head itself counts', () => {
  assert.deepEqual(judgeDebt(judgeOf([commit(1, 0)]), NOW).shas, [sha(1)]);
});

test('the last pass that ended well is the one that counts: failed, cancelled and still-going runs are skipped, whatever their date or order', () => {
  const other = sha('b');
  const runs = [run(sha('c'), 5 * MS_DAY, 'failure'), run(HEAD, MS_DAY), run(sha('d'), 6 * MS_DAY, 'cancelled'), run(sha('e'), 7 * MS_DAY, null), run(other, -MS_DAY)];
  const j = { runs, commits: [commit(1, 2 * MS_DAY)], heads: { [HEAD]: iso(T0) } };
  const d = judgeDebt(j, NOW);
  assert.deepEqual([d.lastPassedSha, d.lastPassedAt, d.count], [HEAD, iso(T0 + MS_DAY), 1]);
  assert.equal(lastPassed(runs).head_sha, HEAD);
  assert.equal(lastPassed([run(sha('c'), 0, 'failure'), run(sha('d'), 0, 'cancelled'), run(sha('e'), 0, null)]), null);
  assert.equal(lastPassed([]), null);
});

test('with no pass that ended well every commit on the judge is debt', () => {
  const d = judgeDebt({ runs: [run(sha('c'), 0, 'failure')], commits: [commit(1, -MS_DAY), commit(2, MS_DAY)], heads: {} }, NOW);
  assert.deepEqual([d.computed, d.lastPassedSha, d.lastPassedAt, d.count], [true, null, null, 2]);
  assert.equal(judgeDebt({ runs: [], commits: [commit(1, 0)], heads: {} }, NOW).count, 1);
});

test('the days run from the first commit owed: whole days, exactly N days is N, one millisecond short is N-1', () => {
  const at = (offset) => judgeDebt(judgeOf([commit(2, 9 * MS_DAY), commit(1, offset)]), NOW);
  assert.equal(at(NOW - T0 - 3 * MS_DAY).days, 3);
  assert.equal(at(NOW - T0 - 3 * MS_DAY + 1).days, 2);
  const first = at(MS_DAY);
  assert.deepEqual([first.days, first.firstAt, first.shas], [9, iso(T0 + MS_DAY), [sha(1), sha(2)]]);
});

test('nothing owed is zero commits with no days, but still computed', () => {
  const d = judgeDebt(judgeOf([commit(1, -1)]), NOW);
  assert.deepEqual(d, { computed: true, lastPassedSha: HEAD, lastPassedAt: iso(T0 + MS_DAY), count: 0, shas: [], firstAt: null, days: null });
});

test('malformed data throws instead of being read as no debt', () => {
  assert.throws(() => judgeDebt({ commits: [], heads: {} }, NOW), /runs must be a list/);
  assert.throws(() => judgeDebt({ runs: [], heads: {} }, NOW), /commits must be a list/);
  assert.throws(() => judgeDebt({ ...judgeOf([]), heads: {} }, NOW), /no date in heads/);
  assert.throws(() => judgeDebt({ ...judgeOf([]), heads: undefined }, NOW), /no date in heads/);
  assert.throws(() => judgeDebt({ ...judgeOf([]), heads: { [HEAD]: 'yesterday' } }, NOW), /date of the head_sha is not a date/);
  assert.throws(() => judgeDebt(judgeOf([{ sha: sha(1), date: 'soon' }]), NOW), /commit 1+ is not a date/);
  assert.throws(() => judgeDebt(judgeOf([], [run(HEAD, 0), { ...run(sha('b'), 0), created_at: 'never' }]), NOW), /run created_at is not a date/);
});
