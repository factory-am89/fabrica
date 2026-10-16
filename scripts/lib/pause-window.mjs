// The ruleset window: the time while Pablo has the ruleset of `main` paused to merge a PR by hand. In it GitHub merges at
// once every PR that has auto-merge armed (2026-10-16: #20 and #52 entered `main` without the `revisor` check).
// `abrir` disarms them all before Pablo pauses and saves the list; `cerrar` re-arms them once the ruleset is active again.
// This code never lifts, pauses or edits the ruleset: that is Pablo's owner action. It only READS it.
// All GitHub calls go through `run(args)` (args after `gh`; returns { status, stdout, stderr }), so tests use a simulated GitHub.
import * as fsReal from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { horaDeMadrid } from '../hora.mjs';

// Exit code per class. 1 is left for what nobody foresaw. (No shared map of codes exists in main yet; if one lands, this moves there.)
export const EXIT = {
  usage: 2,
  state: 3,
  github: 4,
  'ruleset-not-active': 5,
  'still-armed': 6,
  'born-in-window': 7,
  'rearm-failed': 8,
};

export class VentanaError extends Error {
  constructor(clase, message, options) {
    super(message, options);
    this.clase = clase;
  }
}

export const statePath = (home = homedir) => join(home(), '.fabrica', 'ventana.json');

// A check conclusion that counts as red: a PR with it must never be re-armed. A missing or pending check is not red.
const RED = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale']);
const PAGE = 100;

function call(run, args) {
  const r = run(args);
  if (r.status !== 0) throw new VentanaError('github', `gh ${args.join(' ')} failed (${r.status}): ${String(r.stderr).trim()}`);
  return r.stdout;
}

// An answer of GitHub missing a field we rely on is an error, never «false» or «none»: a PR without `auto_merge` read as
// not armed would print «armed: 0» (the failure of #20 and #52). Every field read below is checked first.
function expect(ok, what) {
  if (!ok) throw new VentanaError('github', `unexpected answer of GitHub: ${what}`);
}
const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function getJson(run, route) {
  const text = call(run, ['api', route]);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new VentanaError('github', `gh api ${route}: the answer is not JSON`, { cause: e });
  }
}

// Open PRs with auto-merge armed, with ONE REST call (the list of pulls carries `auto_merge`). No GraphQL.
export function listArmed(run, repo) {
  const pulls = getJson(run, `repos/${repo}/pulls?state=open&per_page=${PAGE}`);
  if (!Array.isArray(pulls)) throw new VentanaError('github', 'the list of pull requests is not an array');
  if (pulls.length >= PAGE) throw new VentanaError('github', `${pulls.length} open PRs: one page is not enough to be sure none is armed; paginate before trusting this`);
  pulls.forEach((p) => expect(isObject(p) && Number.isInteger(p.number) && 'auto_merge' in p, 'a pull of the open list has no number or no auto_merge field'));
  return pulls.filter((p) => p.auto_merge).map((p) => p.number).sort((a, b) => a - b);
}

// The saved list. No file: null. A file that is not what we wrote: throws (it is never overwritten or guessed).
export function readState(path, fs = fsReal) {
  let raw;
  try {
    raw = fs.readFileSync(path, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return null;
    throw new VentanaError('state', `cannot read the state file ${path}: ${e.message}`, { cause: e });
  }
  let d;
  try {
    d = JSON.parse(raw);
  } catch (e) {
    throw new VentanaError('state', `the state file ${path} is not JSON: fix or delete it by hand, nothing was changed`, { cause: e });
  }
  const ok = d && d.version === 1 && typeof d.repo === 'string' && Array.isArray(d.prs) && d.prs.every((n) => Number.isInteger(n) && n > 0);
  if (!ok) throw new VentanaError('state', `the state file ${path} has the wrong shape: fix or delete it by hand, nothing was changed`);
  return d;
}

function writeState(path, state, fs = fsReal) {
  fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

const stamp = (clock) => horaDeMadrid(clock());
const union = (a, b) => [...new Set([...a, ...b])].sort((x, y) => x - y);
const tags = (nums) => nums.map((n) => `#${n}`).join(', ');

// Before Pablo pauses the ruleset: save the armed PRs (joined to a previous list, never replacing it), disarm all, list again.
export function abrir({ run, repo, path = statePath(), fs = fsReal, clock = () => new Date() }) {
  const previous = readState(path, fs);
  if (previous && previous.repo !== repo) throw new VentanaError('state', `the saved list is for ${previous.repo}, not ${repo}: close that window first`);
  const armed = listArmed(run, repo);
  const saved = union(previous?.prs ?? [], armed);
  writeState(path, { version: 1, repo, prs: saved }, fs);
  const problems = [];
  for (const n of armed) {
    const r = run(['pr', 'merge', String(n), '--repo', repo, '--disable-auto']);
    if (r.status !== 0) problems.push({ clase: 'still-armed', pr: n, message: `could not disarm #${n}: ${String(r.stderr).trim()}` });
  }
  const left = listArmed(run, repo);
  if (left.length) problems.push({ clase: 'still-armed', pr: left, message: `still armed after disarming: ${tags(left)}. DO NOT pause the ruleset` });
  return { command: 'abrir', repo, time: stamp(clock), saved, disarmed: armed, armed: left.length, problems };
}

function assertRulesetActive(run, repo) {
  const list = getJson(run, `repos/${repo}/rulesets`);
  if (!Array.isArray(list)) throw new VentanaError('github', 'the list of rulesets is not an array');
  list.forEach((r) => expect(isObject(r) && typeof r.name === 'string' && typeof r.enforcement === 'string', 'a ruleset has no name or no enforcement'));
  const main = list.find((r) => r.name === 'main');
  if (!main) throw new VentanaError('ruleset-not-active', `no ruleset named «main» in ${repo}: nothing was re-armed`);
  if (main.enforcement !== 'active') throw new VentanaError('ruleset-not-active', `the ruleset «main» is «${main.enforcement}», not «active»: nothing was re-armed. Ask Pablo to restore it`);
}

// The newest `revisor` check of a check-runs answer, or undefined when the PR has none. A shape we do not know, or a page
// that may hide more checks, throws: it must never read as «not red».
function latestRevisor(answer, n) {
  const runs = answer?.check_runs;
  expect(Array.isArray(runs) && runs.every((c) => isObject(c) && typeof c.name === 'string'), `check-runs of #${n}: unexpected shape`);
  if (runs.length >= PAGE) throw new VentanaError('github', `#${n} has ${runs.length} check-runs: one page is not enough to find the revisor; paginate before trusting this`);
  const revisors = runs.filter((c) => c.name === 'revisor');
  expect(revisors.every((c) => Number.isInteger(c.id) && 'conclusion' in c && (c.conclusion === null || typeof c.conclusion === 'string')), `the revisor check of #${n} has no id or no conclusion field`);
  return revisors.sort((x, y) => y.id - x.id)[0];
}

// Why a saved PR must not be re-armed, or null when it can be.
function reasonToSkip(run, repo, n) {
  const pr = getJson(run, `repos/${repo}/pulls/${n}`);
  expect(isObject(pr) && typeof pr.state === 'string' && typeof pr.merged === 'boolean', `pull #${n} has no state or no merged field`);
  if (pr.merged) return 'already merged';
  if (pr.state !== 'open') return 'closed';
  expect(typeof pr.head?.sha === 'string', `pull #${n} has no head.sha`);
  const revisor = latestRevisor(getJson(run, `repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=${PAGE}`), n);
  if (!revisor) return 'no verdict from the revisor';
  if (RED.has(revisor.conclusion)) return `check revisor is red (${revisor.conclusion})`;
  return null;
}

// After Pablo restored the ruleset: only if it is active, re-arm the saved list; then list again and flag any
// armed PR that was not in the list (born inside the window). The state file is deleted only when all went clean.
export function cerrar({ run, repo, path = statePath(), fs = fsReal, clock = () => new Date() }) {
  const state = readState(path, fs);
  if (!state) throw new VentanaError('state', `no saved list at ${path}: run «abrir» before the window`);
  if (state.repo !== repo) throw new VentanaError('state', `the saved list is for ${state.repo}, not ${repo}`);
  assertRulesetActive(run, repo);
  const rearmed = [];
  const skipped = [];
  const problems = [];
  for (const n of state.prs) {
    const why = reasonToSkip(run, repo, n);
    if (why) {
      skipped.push({ pr: n, reason: why });
      continue;
    }
    const r = run(['pr', 'merge', String(n), '--repo', repo, '--auto', '--squash']);
    if (r.status === 0) rearmed.push(n);
    else problems.push({ clase: 'rearm-failed', pr: n, message: `could not re-arm #${n}: ${String(r.stderr).trim()}` });
  }
  const born = listArmed(run, repo).filter((n) => !state.prs.includes(n));
  if (born.length) problems.push({ clase: 'born-in-window', pr: born, message: `armed PR(s) that were not in the saved list: ${tags(born)}. Born inside the window: check them` });
  if (!problems.length) fs.rmSync(path);
  return { command: 'cerrar', repo, time: stamp(clock), rearmed, skipped, born, problems };
}
