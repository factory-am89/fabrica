// Prints (or writes) the Evidence section of a PR body, produced by running the commands.
// Usage: node scripts/evidence.mjs [--focus <testfile> ...] [--out <file>]
// Exit 1 on any refusal or when a command exits non-zero (the block is still produced in that case).
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { collectEvidence, parseArgs, defaultRunner, EvidenceError } from './lib/evidence.mjs';

export function main(argv, { cwd = process.cwd(), write = (s) => process.stdout.write(s), err = (s) => console.error(s), runner = defaultRunner } = {}) {
  try {
    const { focus, out } = parseArgs(argv);
    const { markdown, failed } = collectEvidence({ cwd, focus, runner });
    if (out) writeFileSync(out, markdown);
    else write(markdown);
    if (failed) err('evidence: a command failed (see the exit codes in the block)');
    return failed ? 1 : 0;
  } catch (e) {
    if (!(e instanceof EvidenceError)) throw e;
    err(`evidence: ${e.message}`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
