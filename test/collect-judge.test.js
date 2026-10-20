// The judge's part of scripts/collect-records.mjs (chunk 28): the runs of golden.yml, the commits of main on each JUDGE_PATH and the date of the
// head_sha of the last good run. No network: the fake GitHub is test/apoyo/judge-falso.mjs. It covers only what the collector downloads;
// counting the debt is test/judge-debt.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collect, writeOut } from '../scripts/collect-records.mjs';
import { JUDGE_PATHS } from '../scripts/golden.mjs';
import { GOLDEN_WORKFLOW, MAIN_BRANCH, apiPath } from '../scripts/lib/judge-debt.mjs';
import { COMMITS_BY_PATH, FAILED, FIRST_PATH, GOOD_NEW, GOOD_NEW_DATE, RUNS, SECOND_PATH, judgeAnswer } from './apoyo/judge-falso.mjs';

const REPO = 'o/r';
const HEAD_COMMIT = /commits\/[0-9a-f]{40}$/;
// A repo with no PRs and the given judge answers; `calls` records every route.
const getOf = (judge, calls = []) => async (route) => {
  calls.push(route);
  return route.includes('/pulls?') ? [] : judgeAnswer(REPO, route, judge);
};

test('the runs of golden.yml come with date, head_sha and conclusion only, and the head of the last good run with its date', async () => {
  const calls = [];
  const { judge } = await collect({ get: getOf(undefined, calls), repo: REPO });
  assert.deepEqual(judge.runs, RUNS.map(({ created_at, head_sha, conclusion }) => ({ created_at, head_sha, conclusion })));
  assert.ok(calls.includes(`repos/${REPO}/actions/workflows/${GOLDEN_WORKFLOW}/runs?per_page=100`));
  assert.deepEqual(judge.heads, { [GOOD_NEW]: GOOD_NEW_DATE });
  assert.deepEqual(calls.filter((c) => HEAD_COMMIT.test(c)), [`repos/${REPO}/commits/${GOOD_NEW}`]);
});

test('the commits of main are asked once per judge path, in its API form, and a commit of two paths is kept once', async () => {
  const calls = [];
  const { judge } = await collect({ get: getOf(undefined, calls), repo: REPO });
  const asked = calls.filter((c) => c.includes(`/commits?sha=${MAIN_BRANCH}&path=`)).map((c) => decodeURIComponent(c.match(/path=([^&]+)/)[1]));
  assert.deepEqual(asked, JUDGE_PATHS.map(apiPath));
  assert.ok(JUDGE_PATHS.some((p) => p !== apiPath(p)), 'a folder glob must reach the API as the folder');
  const all = Object.values(COMMITS_BY_PATH).flat();
  assert.equal(all.length, JUDGE_PATHS.length + 1);
  assert.deepEqual(judge.commits, [...new Map(all.map((c) => [c.sha, { sha: c.sha, date: c.commit.committer.date }])).values()]);
  assert.equal(judge.commits.length, JUDGE_PATHS.length);
});

test('with no run that ended well there is no head to date and no extra call', async () => {
  const calls = [];
  const { judge } = await collect({ get: getOf({ runs: RUNS.filter((r) => r.head_sha === FAILED) }, calls), repo: REPO });
  assert.deepEqual(judge.heads, {});
  assert.equal(calls.filter((c) => HEAD_COMMIT.test(c)).length, 0);
});

test('a cut or malformed answer throws instead of passing for the whole', async () => {
  const bad = (judge, what) => assert.rejects(collect({ get: getOf(judge), repo: REPO }), what);
  const cut = async (r) => (r.includes('/runs?') ? { total_count: RUNS.length + 1, workflow_runs: RUNS } : getOf()(r));
  await assert.rejects(collect({ get: cut, repo: REPO }), /cut or malformed/);
  await bad({ runs: [{ ...RUNS[0], head_sha: undefined }] }, /lacks head_sha, created_at or conclusion/);
  await bad({ runs: [{ ...RUNS[0], created_at: undefined }] }, /lacks head_sha, created_at or conclusion/);
  await bad({ runs: [{ ...RUNS[0], conclusion: undefined }] }, /lacks head_sha, created_at or conclusion/);
  await bad({ commitsByPath: { ...COMMITS_BY_PATH, [FIRST_PATH]: [{ commit: COMMITS_BY_PATH[FIRST_PATH][0].commit }] } }, /has no sha/);
  await bad({ commitsByPath: { ...COMMITS_BY_PATH, [SECOND_PATH]: [{ sha: 'x'.repeat(40) }] } }, /no commit\.committer\.date/);
  await assert.rejects(collect({ get: async (r) => (HEAD_COMMIT.test(r) ? {} : getOf()(r)), repo: REPO }), /no commit\.committer\.date/);
});

test('a run still going (conclusion null) is kept as it is, and writeOut leaves judge.json', async () => {
  const runs = [...RUNS, { id: 5, created_at: '2026-02-06T08:00:00Z', head_sha: FAILED, conclusion: null }];
  const datos = await collect({ get: getOf({ runs }), repo: REPO });
  assert.equal(datos.judge.runs.at(-1).conclusion, null);
  const dir = mkdtempSync(path.join(tmpdir(), 'collect-judge-'));
  try {
    writeOut(dir, datos);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'judge.json'), 'utf8')), datos.judge);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
