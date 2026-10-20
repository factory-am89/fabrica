// The data indicators of `audit --data`: figures about the PRs and their `revisor` rounds, computed from what
// scripts/collect-records.mjs downloads ({pulls, checkRuns}). Pure functions: no network, no clock unless `now` is given.
// Every figure that cannot be exact says which way it errs (BOUND) and the mix it hides (CAVEAT). Signals, not gates.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ExitError, runCommand } from './exit.mjs';
import { lessonIndicators } from './lesson-effect.mjs';
import { aggregate, readCheckRuns } from './record.mjs';

export const BOUND = Object.freeze({ lower: 'lower', upper: 'upper' });
export const CAVEAT = Object.freeze({
  reworkMixesCauses: 'rework-mixes-errors-and-changes-of-mind',
  escapesUnseen: 'a-defect-nobody-saw-does-not-count',
  messagesNotPerPr: 'messages-include-those-not-about-a-pr',
  roundsMissing: 'a-round-without-a-check-run-does-not-count',
  clashesNoEnd: 'closed-without-merge-has-no-end-date',
});
export const REWORK_HOURS = 48;
export const ESCAPE_DAYS = 14;
export const FIX_PREFIX = 'fix/';
const MS_MINUTE = 60000;
const MS_HOUR = 3600000;
const MS_DAY = 86400000;
const PR_OPEN = 'open';

const time = (pr, field) => {
  const t = Date.parse(pr[field]);
  if (Number.isNaN(t)) throw new Error(`PR #${pr.number}: ${field} is not a date`);
  return t;
};

// pulls as collect() writes them -> { number, ref, state, files: Set, commits: Set, created, merged|null }; throws on a malformed one.
export function readPulls(pulls) {
  if (!Array.isArray(pulls)) throw new Error('pulls must be a list');
  return pulls.map((p) => {
    if (!Number.isInteger(p?.number) || typeof p.head_ref !== 'string' || !Array.isArray(p.files) || !Array.isArray(p.commits)) throw new Error(`PR ${p?.number}: malformed (number, head_ref, files, commits)`);
    return { number: p.number, ref: p.head_ref, state: p.state, files: new Set(p.files), commits: new Set(p.commits), created: time(p, 'created_at'), merged: p.merged_at === null ? null : time(p, 'merged_at') };
  });
}

const shared = (a, b) => [...a.files].filter((f) => b.files.has(f)).sort();
const rate = (n, d) => (d === 0 ? null : n / d);

// PRs created within `window` ms after another PR was merged, touching a file of that one. `only` filters the later PR.
function touchesRecentlyMerged(prs, window, only = () => true) {
  return prs.filter(only).flatMap((b) => prs
    .filter((a) => a !== b && a.merged !== null && a.merged <= b.created && b.created - a.merged <= window)
    .map((a) => ({ pr: b.number, after: a.number, files: shared(a, b) }))
    .filter((x) => x.files.length > 0));
}
const distinct = (list) => [...new Set(list.map((x) => x.pr))].sort((a, b) => a - b);

export function rework(prs) {
  const hits = touchesRecentlyMerged(prs, REWORK_HOURS * MS_HOUR);
  return { windowHours: REWORK_HOURS, count: distinct(hits).length, prs: distinct(hits), hits, caveat: CAVEAT.reworkMixesCauses };
}

// Escapes: fix/ PRs that were merged and touch files of a PR merged in the ESCAPE_DAYS before they were opened, plus escaped lessons (null = not applicable).
export function escapes(prs, lessonsEscaped) {
  const merged = prs.filter((p) => p.merged !== null);
  const fixes = touchesRecentlyMerged(prs, ESCAPE_DAYS * MS_DAY, (p) => p.merged !== null && p.ref.startsWith(FIX_PREFIX));
  const count = distinct(fixes).length + (lessonsEscaped ?? 0);
  return { windowDays: ESCAPE_DAYS, mergedPrs: merged.length, fixPrs: distinct(fixes), lessonsEscaped, count, rate: rate(count, merged.length), bound: BOUND.lower, caveat: CAVEAT.escapesUnseen };
}

// Pairs of PRs open at the same time that touch the same file. A PR closed without merge has no end date: it is counted apart.
export function clashes(prs, now) {
  const end = (p) => (p.merged !== null ? p.merged : p.state === PR_OPEN ? now : null);
  const known = prs.filter((p) => end(p) !== null);
  const pairs = known.flatMap((a, i) => known.slice(i + 1)
    .filter((b) => a.created < end(b) && b.created < end(a))
    .map((b) => ({ prs: [a.number, b.number].sort((x, y) => x - y), files: shared(a, b) }))
    .filter((x) => x.files.length > 0));
  return { count: pairs.length, pairs, withoutEnd: prs.length - known.length, caveat: CAVEAT.clashesNoEnd };
}

export function minutes(prs) {
  const spans = prs.filter((p) => p.merged !== null).map((p) => (p.merged - p.created) / MS_MINUTE);
  const total = spans.reduce((a, m) => a + m, 0);
  return { merged: spans.length, total: Math.round(total), mean: spans.length === 0 ? null : Math.round(total / spans.length) };
}

// Rounds and "no" per question from the check-runs. An unreadable check-run stops the figure: counting around it would be false.
export function rounds(checkRuns) {
  const { records, overrides, unreadable } = readCheckRuns(checkRuns);
  if (unreadable.length > 0) throw new Error(`check-runs without a readable record (index: ${unreadable.map((u) => u.index).join(', ')})`);
  const { porPr, porPregunta } = aggregate(records);
  const prs = Object.keys(porPr).length;
  return { records: records.length, prs, mean: rate(records.length, prs), byPr: Object.fromEntries(Object.entries(porPr).map(([k, v]) => [k, v.rondas])), overrides, noPerQuestion: porPregunta, bound: BOUND.lower, caveat: CAVEAT.roundsMissing };
}

// The check-runs of the commits of `prs` (a check-run with no head_sha cannot be placed, so it stops the figure).
function checkRunsOf(prs, checkRuns) {
  const shas = new Set(prs.flatMap((p) => [...p.commits]));
  return checkRuns.filter((c) => {
    if (typeof c?.head_sha !== 'string') throw new Error('a check-run has no head_sha: it cannot be placed in a PR');
    return shas.has(c.head_sha);
  });
}

// What the project cost until its first merged PR: PRs opened up to that merge, their rounds and Pablo's overrides.
export function projectCost(prs, checkRuns) {
  const first = prs.filter((p) => p.merged !== null).sort((a, b) => a.merged - b.merged)[0] ?? null;
  const upTo = first === null ? prs : prs.filter((p) => p.created <= first.merged);
  const r = rounds(checkRunsOf(upTo, checkRuns));
  return { reachedFirstMerge: first !== null, firstMergedPr: first?.number ?? null, prs: upTo.length, rounds: r.records, overrides: r.overrides, bound: BOUND.lower };
}

// messages: contarMensajes() result or null (not applicable); the total is an upper bound per PR because not every message is about one.
export function messages(m, mergedPrs) {
  if (m === null) return null;
  return { total: m.total, sessions: Object.keys(m.porSesion).length, corrupt: m.corruptas, perMergedPr: rate(m.total, mergedPrs), bound: BOUND.upper, caveat: CAVEAT.messagesNotPerPr };
}


// The ids of the data indicators; scripts/audit.mjs spreads them into INDICATORS, the closed list.
export const DATA_IDS = Object.freeze({
  rounds: 'rounds',
  noPerQuestion: 'no-per-question',
  minutes: 'minutes',
  overrides: 'pablo-overrides',
  messages: 'messages',
  rework: 'rework',
  clashes: 'clashes',
  escapes: 'escapes',
  projectCost: 'project-cost',
  lessonEffect: 'lesson-effect',
  unsortedNo: 'unsorted-no',
  falseNo: 'false-no',
});
export const DATA_INDICATORS = Object.freeze(Object.values(DATA_IDS));

// data = { pulls, checkRuns } as scripts/collect-records.mjs writes them. lessonsEscaped (a count) and messageCounts
// (contarMensajes()) and `local` (localInputs() of scripts/lib/lesson-effect.mjs) belong to the Fábrica's own files: null means not applicable (a --repo run).
export function dataIndicators(data, { now, lessonsEscaped, messageCounts, local }) {
  const prs = readPulls(data.pulls);
  const r = rounds(data.checkRuns);
  const lesson = lessonIndicators(prs, data.checkRuns, local);
  return {
    [DATA_IDS.rounds]: { records: r.records, prs: r.prs, mean: r.mean, byPr: r.byPr, bound: r.bound, caveat: r.caveat },
    [DATA_IDS.noPerQuestion]: r.noPerQuestion,
    [DATA_IDS.minutes]: minutes(prs),
    [DATA_IDS.overrides]: { count: r.overrides },
    [DATA_IDS.messages]: messages(messageCounts, prs.filter((p) => p.merged !== null).length),
    [DATA_IDS.rework]: rework(prs),
    [DATA_IDS.clashes]: clashes(prs, now),
    [DATA_IDS.escapes]: escapes(prs, lessonsEscaped),
    [DATA_IDS.projectCost]: projectCost(prs, data.checkRuns),
    [DATA_IDS.lessonEffect]: lesson.lessonEffect,
    [DATA_IDS.unsortedNo]: lesson.unsortedNo,
    [DATA_IDS.falseNo]: lesson.falseNo,
  };
}

const FLAG = { data: '--data', records: '--records', repo: '--repo', since: '--since', golden: '--golden' };
const VALUE_FLAGS = [FLAG.records, FLAG.repo, FLAG.since, FLAG.golden];
const FLAG_PREFIX = '--';
// argv without --json -> { data, root, records, repo, since, golden }; a flag that needs a value without one is a USAGE error.
export function parseAuditArgs(args, defaultRoot) {
  const out = { data: false, root: defaultRoot, records: null, repo: null, since: null, golden: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === FLAG.data) out.data = true;
    else if (VALUE_FLAGS.includes(args[i])) {
      if (args[i + 1] === undefined) throw new ExitError('USAGE', `${args[i]} needs a value`);
      out[args[i].slice(FLAG_PREFIX.length)] = args[++i];
    } else out.root = path.resolve(args[i]);
  }
  const extras = VALUE_FLAGS.filter((f) => out[f.slice(FLAG_PREFIX.length)] !== null);
  if (!out.data && extras.length > 0) throw new ExitError('USAGE', `${VALUE_FLAGS.join(', ')} go with ${FLAG.data}`);
  if (out.data && (out.records === null) === (out.repo === null)) throw new ExitError('USAGE', `${FLAG.data} needs exactly one of ${FLAG.records} <file> or ${FLAG.repo} <owner/name>`);
  if (out.golden !== null && out.records === null) throw new ExitError('USAGE', `${FLAG.golden} reads the Fábrica's own files: it goes with ${FLAG.records}, not ${FLAG.repo}`);
  return out;
}

export const humanData = (r) => DATA_INDICATORS.map((id) => `${id}: ${JSON.stringify(r[id])}`).join('\n');

// The entry points of scripts/audit.mjs. `download(repo, since)` is the async --repo download (runCommand is not async):
// a repo the token cannot read, or any failed call, stops the command with its own class and prints nothing as data.
export function makeCommands({ root: defaultRoot, audit, auditData, humanLocal, download }) {
  const human = (r) => (DATA_INDICATORS.every((id) => Object.hasOwn(r, id)) ? humanData(r) : humanLocal(r));
  const cliAudit = (argv, { collected = null } = {}) => runCommand(argv, {
    run: (args) => {
      const a = parseAuditArgs(args, defaultRoot);
      if (!a.data) return audit(a.root);
      if (a.records === null) return auditData(collected, { now: Date.now() });
      return auditData(JSON.parse(readFileSync(a.records, 'utf8')), { root: a.root, golden: a.golden });
    },
    human,
  });
  const mainAudit = async (argv, downloadIt = download) => {
    try {
      const a = parseAuditArgs(argv.filter((x) => x !== '--json'), defaultRoot);
      return cliAudit(argv, { collected: a.repo === null ? null : await downloadIt(a.repo, a.since) });
    } catch (e) {
      const failure = e instanceof ExitError ? e : new ExitError('GH_FAILED', e.message);
      return runCommand(argv, { run: () => { throw failure; }, human });
    }
  };
  return { cliAudit, mainAudit };
}
