// npm run hygiene: lists candidates to merge, promote, retire, rework, overlap or dead references among the lessons and skills, and changes nothing.
// The closed vocabulary (CODES) and the rules are in scripts/lib/hygiene.mjs. Signals, not gates: it exits OK whatever it finds.
//   node scripts/hygiene.mjs [--json] [--records <file>] [root]
// --records <file>: the {pulls, checkRuns} that scripts/collect-records.mjs writes; with it RETIRE_TEXT and REWORK are computed too.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPulls } from './lib/audit-data.mjs';
import { ExitError, finish, runCommand } from './lib/exit.mjs';
import { hygiene, humanHygiene } from './lib/hygiene.mjs';
import { lessonIndicators, localInputs } from './lib/lesson-effect.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RECORDS_FLAG = '--records';
const FLAG_PREFIX = '--';
const ARGV_START = 2; // node and the script come first

// argv without --json -> {records: file | null, root}; an unknown flag or a flag without its value is a USAGE error.
export function parseHygieneArgs(args) {
  const out = { records: null, root: REPO };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === RECORDS_FLAG) {
      if (args[i + 1] === undefined) throw new ExitError('USAGE', `${RECORDS_FLAG} needs a value`);
      out.records = args[++i];
    } else if (args[i].startsWith(FLAG_PREFIX)) throw new ExitError('USAGE', `unknown flag ${args[i]}`);
    else out.root = path.resolve(args[i]);
  }
  return out;
}

export function runHygiene({ records, root }) {
  if (records === null) return hygiene(root);
  const data = JSON.parse(readFileSync(records, 'utf8'));
  return hygiene(root, lessonIndicators(readPulls(data.pulls), data.checkRuns, localInputs(root, null)).lessonEffect);
}

export const cliHygiene = (argv) => runCommand(argv, { run: (args) => runHygiene(parseHygieneArgs(args)), human: humanHygiene });

if (process.argv[1] === fileURLToPath(import.meta.url)) finish(cliHygiene(process.argv.slice(ARGV_START)));
