// Checks an adopted project folder: it must own nothing of what it inherits from the Factory.
//   node scripts/adopted.mjs --dir <project folder> [--json]   (output rule and exit codes: scripts/lib/exit.mjs)
// Read-only on the project. Prints the starting figures and every fault; with a fault it exits ADOPTED_FAULTS.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExitError, runCommand, finish } from './lib/exit.mjs';
import { adoptedSummary, readInherited } from './lib/adopted.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function humanText(s) {
  return [
    `adopted: ${s.roles} roles, ${s.skills} skills, ${s.entities} entities, ${s.faults.length} faults`,
    ...Object.entries(s.byFault).map(([code, n]) => `  ${code}: ${n}`),
    ...s.faults.map((f) => `fault ${f.code} ${f.where}: ${f.message}`),
  ].join('\n');
}

export function cliAdopted(argv) {
  const refused = {}; // filled by run, so a refusal under --json still carries the figures and the faults
  return runCommand(argv, {
    refused,
    run: (args) => {
      const i = args.indexOf('--dir');
      if (i < 0 || args[i + 1] === undefined) throw new ExitError('USAGE', 'usage: node scripts/adopted.mjs --dir <project folder> [--json]');
      const s = adoptedSummary(path.resolve(args[i + 1]), readInherited(REPO));
      if (s.faults.length > 0) {
        Object.assign(refused, s);
        throw new ExitError('ADOPTED_FAULTS', humanText(s));
      }
      return s;
    },
    human: humanText,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) finish(cliAdopted(process.argv.slice(2)));
