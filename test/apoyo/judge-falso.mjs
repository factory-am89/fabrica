// A fake GitHub for the judge's part of the collector: the runs of golden.yml, the commits of main per judge path and the commit of a head_sha.
// `judgeAnswer(repo, route, calls)` answers the three routes and returns undefined for any other, so a test composes it with its own fake.
import { JUDGE_PATHS } from '../../scripts/golden.mjs';
import { GOLDEN_OK, GOLDEN_WORKFLOW, MAIN_BRANCH, apiPath } from '../../scripts/lib/judge-debt.mjs';

export const sha = (n) => String(n).repeat(40).slice(0, 40);
export const GOOD_OLD = sha('a');
export const GOOD_NEW = sha('b');
export const FAILED = sha('c');
export const CANCELLED = sha('d');
export const GOOD_NEW_DATE = '2026-01-19T09:00:00Z';
export const RUNS = [
  { id: 1, created_at: '2026-01-05T08:00:00Z', head_sha: GOOD_OLD, conclusion: GOLDEN_OK },
  { id: 2, created_at: '2026-01-20T08:00:00Z', head_sha: GOOD_NEW, conclusion: GOLDEN_OK },
  { id: 3, created_at: '2026-02-01T08:00:00Z', head_sha: FAILED, conclusion: 'failure' },
  { id: 4, created_at: '2026-02-05T08:00:00Z', head_sha: CANCELLED, conclusion: 'cancelled' },
];
// One commit per judge path (same order as JUDGE_PATHS), a different date each; the first path also lists the second's commit (a commit that touches two paths).
export const COMMITS_BY_PATH = Object.fromEntries(JUDGE_PATHS.map((p, i) => [apiPath(p), [{ sha: sha(i + 1), commit: { committer: { date: `2026-02-0${i + 2}T10:00:00Z` } } }]]));
export const [FIRST_PATH, SECOND_PATH] = JUDGE_PATHS.map(apiPath);
COMMITS_BY_PATH[FIRST_PATH].push(COMMITS_BY_PATH[SECOND_PATH][0]);

export function judgeAnswer(repo, route, { runs = RUNS, commitsByPath = COMMITS_BY_PATH } = {}) {
  if (route === `repos/${repo}/actions/workflows/${GOLDEN_WORKFLOW}/runs?per_page=100`) return { total_count: runs.length, workflow_runs: runs };
  const list = route.match(new RegExp(`^repos/${repo}/commits\\?sha=${MAIN_BRANCH}&path=([^&]+)&per_page=100&page=1$`));
  if (list) {
    const found = commitsByPath[decodeURIComponent(list[1])];
    if (found === undefined) throw new Error(`unexpected judge path in ${route}`);
    return found;
  }
  const one = route.match(new RegExp(`^repos/${repo}/commits/([0-9a-f]{40})$`));
  if (one) return { sha: one[1], commit: { committer: { date: GOOD_NEW_DATE } } };
  return undefined;
}
