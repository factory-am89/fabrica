// node scripts/check-plan.mjs --file <plan> [--json] [--closed-paths <list>] [--gate-files <list>]
// Form check only: runs nothing from the plan. Lists are one path (or prefix ending in "/") per line.
import { readFileSync } from 'node:fs';
import { checkPlan } from './lib/plan.mjs';

function usage(msg) {
  process.stderr.write(`check-plan: ${msg}\nusage: node scripts/check-plan.mjs --file <plan> [--json] [--closed-paths <list>] [--gate-files <list>]\n`);
  process.exit(1);
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (e) {
    return usage(`cannot read ${file}: ${e.message}`);
  }
}

const readList = (file) => (file ? readText(file).split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []);

const args = process.argv.slice(2);
const opts = { json: false };
const valued = { '--file': 'file', '--closed-paths': 'closedPaths', '--gate-files': 'gateFiles' };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json') opts.json = true;
  else if (valued[args[i]]) {
    if (i + 1 >= args.length) usage(`${args[i]} needs a value`);
    opts[valued[args[i]]] = args[++i];
  } else usage(`unknown argument ${args[i]}`);
}
if (!opts.file) usage('--file is required');

const { faults, chunks } = checkPlan(readText(opts.file), {
  closedPaths: readList(opts.closedPaths),
  gateFiles: readList(opts.gateFiles),
});

if (opts.json) {
  process.stdout.write(`${JSON.stringify({ ok: faults.length === 0, faults, chunks })}\n`);
} else if (faults.length === 0) {
  process.stdout.write('check-plan: ok\n');
  for (const c of chunks) process.stdout.write(`chunk ${c.n}: gate=${c.gate} needsPablo=${c.needsPablo.length ? c.needsPablo.join(',') : 'no'}\n`);
} else {
  for (const f of faults) process.stderr.write(`check-plan: ${f.code} [${f.where}] ${f.message}\n`);
}
process.exit(faults.length === 0 ? 0 : 1);
