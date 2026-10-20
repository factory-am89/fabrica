// The judge's debt (chunk 28 of plans/trabajar-solos.md): commits of main that touch the judge (JUDGE_PATHS of scripts/golden.mjs) after
// the head_sha of the last pass of the corpus (workflow golden.yml) that ended well. Pure functions over what scripts/collect-records.mjs
// downloads as `judge`: { runs: [{created_at, head_sha, conclusion}], commits: [{sha, date}], heads: { <head_sha of the last good run>: date } }.
// No `judge` in the data (no token, no network, or a file written before this chunk) is said out loud as «no calculado», never as 0.
// The pass itself is launched by Pablo (it costs money): nothing here starts it. A commit made in the same instant as the head_sha counts as debt.
import { MS_DAY } from './audit-data.mjs'; // a cycle on purpose: both only use the other's exports inside functions
export const MAIN_BRANCH = 'main';
export const GOLDEN_WORKFLOW = 'golden.yml';
export const GOLDEN_OK = 'success'; // the only conclusion of a run that ended well: failure, cancelled, timed_out and a run still going (null) are not
export const JUDGE_NOT_COMPUTED = 'no calculado';
export const JUDGE_WHY = Object.freeze({ noJudgeData: 'no-judge-data' });
const GLOB_TAIL = /\/\*\*$/;

// A path of JUDGE_PATHS as the `path` of the commits API: a folder glob is the folder.
export const apiPath = (p) => p.replace(GLOB_TAIL, '');

const when = (value, what) => {
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new Error(`judge: ${what} is not a date`);
  return t;
};

// The newest run that ended well, or null when none did.
export function lastPassed(runs) {
  if (!Array.isArray(runs)) throw new Error('judge: runs must be a list');
  const good = runs.filter((r) => r?.conclusion === GOLDEN_OK).map((r) => ({ run: r, at: when(r.created_at, 'a run created_at') }));
  return good.reduce((best, r) => (best === null || r.at > best.at ? r : best), null)?.run ?? null;
}

export function judgeDebt(judge, now) {
  if (judge === undefined || judge === null) return { computed: false, state: JUDGE_NOT_COMPUTED, conclusive: false, why: [JUDGE_WHY.noJudgeData] };
  if (!Array.isArray(judge.commits)) throw new Error('judge: commits must be a list');
  const passed = lastPassed(judge.runs);
  let headAt = null;
  if (passed !== null) {
    if (typeof passed.head_sha !== 'string' || !Object.hasOwn(judge.heads ?? {}, passed.head_sha)) throw new Error('judge: the head_sha of the last good run has no date in heads');
    headAt = when(judge.heads[passed.head_sha], 'the date of the head_sha');
  }
  const owed = judge.commits
    .map((c) => ({ sha: c.sha, at: when(c.date, `the date of commit ${c.sha}`) }))
    .filter((c) => passed === null || (c.sha !== passed.head_sha && c.at >= headAt))
    .sort((a, b) => a.at - b.at);
  return {
    computed: true,
    lastPassedSha: passed?.head_sha ?? null,
    lastPassedAt: passed?.created_at ?? null,
    count: owed.length,
    shas: owed.map((c) => c.sha),
    firstAt: owed.length === 0 ? null : new Date(owed[0].at).toISOString(),
    days: owed.length === 0 ? null : Math.floor((now - owed[0].at) / MS_DAY),
  };
}
