// Downloads the `revisor` check-runs of EVERY commit of each PR (all review rounds, not only the last) so that
// scripts/records.mjs can count them. GET calls only; writes nothing but the three files in --out (judge.json: the runs of golden.yml and the commits on the judge).
//   node scripts/collect-records.mjs --out <dir> [--since YYYY-MM-DD] [--repo owner/name]
// <dir>/check-runs.json is the array records.mjs reads (--file); <dir>/pulls.json lists each PR with its commits.
// Calls: 1 per page of PRs + 1 per PR (files of the PR, not per commit) + 1 per PR (commits) + 1 per commit (check-runs); --since limits the PRs by creation date.
// Plus, for the judge: 1 for the runs of golden.yml, 1 per page of commits per judge path, 1 for the date of the last good run's head_sha (--since does not limit them).
// Reads with `node scripts/token.mjs -- gh api` (the constructor identity). A failed call, a cut list or a malformed
// answer throws: a partial download would pass for a complete one.
// lesson: input-dropped-silently (only this file's cut-list case is tested; the class is judged by the reviewer, C5)
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOLDEN_WORKFLOW, MAIN_BRANCH, apiPath, lastPassed } from './lib/judge-debt.mjs';
import { REPO } from './lib/repo.mjs';
import { JUDGE_PATHS } from './golden.mjs';

const PER_PAGE = 100;
const MAX_PAGES = 50;
const FILES_CAP = 3000; // GitHub stops listing a PR's files here without saying so
const JSON_INDENT = 2;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'token.mjs');

// The real `get`: route -> parsed JSON, through the constructor token. Throws with the route and gh's own message.
export function getWithToken(route, run = spawnSync) {
  const r = run(process.execPath, [TOKEN_SCRIPT, '--', 'gh', 'api', route], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`GET ${route}: ${r.error.message}`, { cause: r.error });
  if (r.status !== 0) throw new Error(`GET ${route} failed (exit ${r.status}): ${String(r.stderr).trim().slice(0, 300)}`);
  try {
    return JSON.parse(r.stdout);
  } catch (e) {
    throw new Error(`GET ${route}: the answer is not JSON`, { cause: e });
  }
}

// All the pages of a list route (array answers), stopping at the first short page.
async function pages(get, route) {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await get(`${route}${route.includes('?') ? '&' : '?'}per_page=${PER_PAGE}&page=${page}`);
    if (!Array.isArray(batch)) throw new Error(`GET ${route}: expected a list`);
    items.push(...batch);
    if (batch.length < PER_PAGE) return items;
  }
  throw new Error(`GET ${route}: more than ${MAX_PAGES} pages; refusing to cut the list`);
}

// PRs (newest first) created on or after `since` (YYYY-MM-DD, or null for all).
export async function listPulls(get, repo, since) {
  if (since !== null && !DAY.test(since)) throw new Error(`--since must be YYYY-MM-DD, got ${since}`);
  const all = await pages(get, `repos/${repo}/pulls?state=all&sort=created&direction=desc`);
  return all.filter((p) => since === null || p.created_at.slice(0, 10) >= since);
}

const committerDate = (c, what) => {
  const date = c?.commit?.committer?.date;
  if (typeof date !== 'string') throw new Error(`${what}: no commit.committer.date in the answer`);
  return date;
};

// What audit --data needs for the judge's debt (scripts/lib/judge-debt.mjs): the runs of golden.yml (date, head_sha, conclusion), the commits of main
// that touch each of JUDGE_PATHS, and the date of the head_sha of the last run that ended well. A cut or malformed answer throws.
export async function collectJudge({ get, repo }) {
  const res = await get(`repos/${repo}/actions/workflows/${GOLDEN_WORKFLOW}/runs?per_page=${PER_PAGE}`);
  if (!Array.isArray(res?.workflow_runs) || res.workflow_runs.length !== res.total_count) throw new Error(`runs of ${GOLDEN_WORKFLOW}: answer cut or malformed (total_count ${res?.total_count})`);
  const runs = res.workflow_runs.map((r) => {
    if (typeof r?.head_sha !== 'string' || typeof r.created_at !== 'string' || !(r.conclusion === null || typeof r.conclusion === 'string')) throw new Error(`a run of ${GOLDEN_WORKFLOW} lacks head_sha, created_at or conclusion`);
    return { created_at: r.created_at, head_sha: r.head_sha, conclusion: r.conclusion };
  });
  const bySha = new Map();
  for (const p of JUDGE_PATHS) {
    for (const c of await pages(get, `repos/${repo}/commits?sha=${MAIN_BRANCH}&path=${encodeURIComponent(apiPath(p))}`)) {
      if (typeof c?.sha !== 'string') throw new Error(`commits of ${p}: a commit has no sha`);
      bySha.set(c.sha, committerDate(c, `commit ${c.sha}`));
    }
  }
  const passed = lastPassed(runs);
  const heads = passed === null ? {} : { [passed.head_sha]: committerDate(await get(`repos/${repo}/commits/${passed.head_sha}`), `commit ${passed.head_sha}`) };
  return { runs, commits: [...bySha].map(([sha, date]) => ({ sha, date })), heads };
}

// { pulls: [{number, state, created_at, merged_at, head_ref, files: [path], commits: [sha]}], checkRuns: [check-run], judge } with the `revisor` check-runs of every commit.
export async function collect({ get, repo = REPO, since = null }) {
  const pulls = [];
  const checkRuns = [];
  const seen = new Set();
  for (const p of await listPulls(get, repo, since)) {
    if (typeof p.head?.ref !== 'string') throw new Error(`PR #${p.number}: no head.ref in the answer`);
    const files = (await pages(get, `repos/${repo}/pulls/${p.number}/files`)).map((f) => f.filename);
    if (files.length >= FILES_CAP) throw new Error(`PR #${p.number}: ${files.length} files reaches GitHub's listing cap (${FILES_CAP}); the list may be cut`);
    const commits = (await pages(get, `repos/${repo}/pulls/${p.number}/commits`)).map((c) => c.sha);
    for (const sha of commits) {
      const res = await get(`repos/${repo}/commits/${sha}/check-runs?check_name=revisor&per_page=${PER_PAGE}`);
      if (!Array.isArray(res?.check_runs) || res.check_runs.length !== res.total_count) {
        throw new Error(`check-runs of ${sha}: answer cut or malformed (total_count ${res?.total_count})`);
      }
      for (const c of res.check_runs) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        checkRuns.push(c);
      }
    }
    pulls.push({ number: p.number, state: p.state, created_at: p.created_at, merged_at: p.merged_at ?? null, head_ref: p.head.ref, files, commits });
  }
  return { pulls, checkRuns, judge: await collectJudge({ get, repo }) };
}

export function writeOut(dir, { pulls, checkRuns, judge }) {
  mkdirSync(dir, { recursive: true });
  for (const [file, value] of [['judge.json', judge], ['pulls.json', pulls], ['check-runs.json', checkRuns]]) writeFileSync(path.join(dir, file), JSON.stringify(value, null, JSON_INDENT));
}

export function parseArgs(argv) {
  const out = { out: null, since: null, repo: REPO };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!['--out', '--since', '--repo'].includes(k) || !v) throw new Error('usage: node scripts/collect-records.mjs --out <dir> [--since YYYY-MM-DD] [--repo owner/name]');
    out[k.slice(2)] = v;
  }
  if (!out.out) throw new Error('--out <dir> is required');
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { out, since, repo } = parseArgs(process.argv.slice(2));
    const datos = await collect({ get: async (route) => getWithToken(route), repo, since });
    writeOut(out, datos);
    console.log(`pulls: ${datos.pulls.length}`);
    console.log(`check-runs: ${datos.checkRuns.length}`);
    console.log(`next: node scripts/records.mjs --file ${path.join(out, 'check-runs.json')}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
