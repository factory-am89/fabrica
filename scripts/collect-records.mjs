// Downloads the `revisor` check-runs of EVERY commit of each PR (all review rounds, not only the last) so that
// scripts/records.mjs can count them. GET calls only; writes nothing but the two files in --out.
//   node scripts/collect-records.mjs --out <dir> [--since YYYY-MM-DD] [--repo owner/name]
// <dir>/check-runs.json is the array records.mjs reads (--file); <dir>/pulls.json lists each PR with its commits.
// Calls: 1 per page of PRs + 1 per PR (files of the PR, not per commit) + 1 per PR (commits) + 1 per commit (check-runs); --since limits the PRs by creation date.
// Reads with `node scripts/token.mjs -- gh api` (the constructor identity). A failed call, a cut list or a malformed
// answer throws: a partial download would pass for a complete one.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO } from './lib/repo.mjs';

const PER_PAGE = 100;
const MAX_PAGES = 50;
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

// { pulls: [{number, state, created_at, merged_at, head_ref, files: [path], commits: [sha]}], checkRuns: [check-run] } with the `revisor` check-runs of every commit.
export async function collect({ get, repo = REPO, since = null }) {
  const pulls = [];
  const checkRuns = [];
  const seen = new Set();
  for (const p of await listPulls(get, repo, since)) {
    if (typeof p.head?.ref !== 'string') throw new Error(`PR #${p.number}: no head.ref in the answer`);
    const files = (await pages(get, `repos/${repo}/pulls/${p.number}/files`)).map((f) => f.filename);
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
  return { pulls, checkRuns };
}

export function writeOut(dir, { pulls, checkRuns }) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'pulls.json'), JSON.stringify(pulls, null, 2));
  writeFileSync(path.join(dir, 'check-runs.json'), JSON.stringify(checkRuns, null, 2));
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
