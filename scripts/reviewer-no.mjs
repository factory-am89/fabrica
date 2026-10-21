// The debt of «no» of the reviewer (chunk 3 of plans/registro-de-no.md): the «no» of merged PRs without a row in reviewer-no.json,
// the rows still pendiente, and the rows no «no» backs. Computed from the records of the judge; nothing is stored here.
//   node scripts/reviewer-no.mjs --debt (--records <file> | --repo <owner/name>) [--json] [root]
// --repo downloads with scripts/collect-records.mjs WITHOUT --since (it filters by creation date and would lose a PR created before
// DEBT_SINCE and merged after); it is for use by hand. A reviewer-no.json with faults stops the command (REVIEWER_NO_FAULTS).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, getWithToken } from './collect-records.mjs';
import { ExitError, finish, runCommand } from './lib/exit.mjs';
import { lessonContext, readLessons } from './lib/lessons.mjs';
import { readReviewerNo, reviewerNoDebt, reviewerNoFaults } from './lib/reviewer-no.mjs';

const REPO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLAG = { debt: '--debt', records: '--records', repo: '--repo' };
const VALUE_FLAGS = [FLAG.records, FLAG.repo];
const USAGE = `usage: node scripts/reviewer-no.mjs ${FLAG.debt} (${FLAG.records} <file> | ${FLAG.repo} <owner/name>) [--json] [root]`;

// argv without --json -> { debt, records, repo, root }; anything outside the usage is a USAGE error.
export function parseArgs(args, defaultRoot = REPO_DIR) {
  const out = { debt: false, records: null, repo: null, root: defaultRoot };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === FLAG.debt) out.debt = true;
    else if (VALUE_FLAGS.includes(args[i])) {
      if (args[i + 1] === undefined) throw new ExitError('USAGE', `${args[i]} needs a value\n${USAGE}`);
      out[args[i].slice(2)] = args[++i];
    } else if (args[i].startsWith('--')) throw new ExitError('USAGE', `unknown flag ${args[i]}\n${USAGE}`);
    else out.root = path.resolve(args[i]);
  }
  if (!out.debt || (out.records === null) === (out.repo === null)) throw new ExitError('USAGE', USAGE);
  return out;
}

const rowsOf = (root) => {
  const text = readReviewerNo(root);
  const faults = reviewerNoFaults(text, lessonContext(root), readLessons(root).map((l) => l.id));
  return { faults, rows: faults.length === 0 ? JSON.parse(text).rows : [] };
};

export function humanDebt(d) {
  const section = (title, items, show) => [`${title}: ${items.length}`, ...items.map((i) => `  #${i.pr} ${i.question}${show(i)}`)];
  const none = d.missing.length + d.pending.length + d.unmatched.length === 0;
  return [
    `«no» of the reviewer in PRs merged since ${d.since} (what was merged before is not counted)`,
    ...section('missing', d.missing, () => ''),
    ...section('pending', d.pending, (i) => ` (${i.kind})`),
    ...section('unmatched', d.unmatched, () => ''),
    ...(none ? ['sin deuda'] : []),
  ].join('\n');
}

// collected: the downloaded {pulls, checkRuns} when --repo was used (runCommand is not async, so mainReviewerNo downloads first).
export function cliReviewerNo(argv, { collected = null } = {}) {
  const refused = {}; // filled by run, so a refusal under --json still carries the faults
  return runCommand(argv, {
    refused,
    run: (args) => {
      const a = parseArgs(args);
      const { faults, rows } = rowsOf(a.root);
      if (faults.length > 0) {
        refused.faults = faults;
        throw new ExitError('REVIEWER_NO_FAULTS', faults.map((f) => `fault ${f.code} ${f.where}: ${f.message}`).join('\n'));
      }
      return reviewerNoDebt(collected ?? JSON.parse(readFileSync(a.records, 'utf8')), rows);
    },
    human: humanDebt,
  });
}

const downloadWithToken = (repo) => collect({ get: async (route) => getWithToken(route), repo, since: null });

// A failed download is GH_FAILED; a usage error is still USAGE (the arguments are read before anything is downloaded).
export async function mainReviewerNo(argv, download = downloadWithToken) {
  try {
    const a = parseArgs(argv.filter((x) => x !== '--json'));
    return cliReviewerNo(argv, { collected: a.repo === null ? null : await download(a.repo) });
  } catch (e) {
    const failure = e instanceof ExitError ? e : new ExitError('GH_FAILED', e.message);
    return runCommand(argv, { run: () => { throw failure; }, human: humanDebt });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) finish(await mainReviewerNo(process.argv.slice(2)));
