// node scripts/check-plan.mjs (--file <plan> | --compare-file <json>) [--json] [--closed-paths <list>] [--gate-files <list>]
// Form check only: runs nothing from the plan. Lists are one path (or prefix ending in "/") per line;
// without the flags the real lists are used (standards/intervention.md and GATE_FILES).
// --compare-file: the compare JSON of a PR. No file under plans/ -> ok (not a plan PR); otherwise the PR
// shape is checked first (planPrFaults) and then the one plan file, read from the current directory.
import { readFileSync } from 'node:fs';
import { checkPlan, planPrFaults, PLAN_DIR } from './lib/plan.mjs';
import { loadClosedPaths } from './lib/intervention.mjs';
import { GATE_FILES } from './lib/gate.mjs';

const USAGE = 'usage: node scripts/check-plan.mjs (--file <plan> | --compare-file <json>) [--json] [--closed-paths <list>] [--gate-files <list>]';

function usage(msg) {
  process.stderr.write(`check-plan: ${msg}\n${USAGE}\n`);
  process.exit(1);
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (e) {
    return usage(`cannot read ${file}: ${e.message}`);
  }
}

const readList = (file) => readText(file).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

const args = process.argv.slice(2);
const opts = { json: false };
const valued = { '--file': 'file', '--compare-file': 'compareFile', '--closed-paths': 'closedPaths', '--gate-files': 'gateFiles' };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json') opts.json = true;
  else if (valued[args[i]]) {
    if (i + 1 >= args.length) usage(`${args[i]} needs a value`);
    opts[valued[args[i]]] = args[++i];
  } else usage(`unknown argument ${args[i]}`);
}
if (Boolean(opts.file) === Boolean(opts.compareFile)) usage('give exactly one of --file or --compare-file');

function report({ faults, chunks, note }) {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ ok: faults.length === 0, faults, chunks })}\n`);
  } else if (faults.length === 0) {
    process.stdout.write(note ? `check-plan: ${note}\n` : 'check-plan: ok\n');
    for (const c of chunks) process.stdout.write(`chunk ${c.n}: gate=${c.gate} needsPablo=${c.needsPablo.length ? c.needsPablo.join(',') : 'no'}\n`);
  } else {
    for (const f of faults) process.stderr.write(`check-plan: ${f.code} [${f.where}] ${f.message}\n`);
  }
  process.exit(faults.length === 0 ? 0 : 1);
}

let planFile = opts.file;
if (opts.compareFile) {
  let data;
  try {
    data = JSON.parse(readText(opts.compareFile));
  } catch (e) {
    usage(`${opts.compareFile} is not JSON: ${e.message}`);
  }
  if (!Array.isArray(data?.files)) usage('compare JSON has no files array');
  const prFaults = planPrFaults(data.files);
  if (prFaults.length) report({ faults: prFaults, chunks: [] });
  const plan = data.files.find((f) => f.filename.startsWith(PLAN_DIR));
  if (!plan) report({ faults: [], chunks: [], note: 'no file under plans/ in this PR; not a plan PR, nothing to check' });
  planFile = plan.filename;
}

const { faults, chunks } = checkPlan(readText(planFile), {
  closedPaths: opts.closedPaths ? readList(opts.closedPaths) : loadClosedPaths(),
  gateFiles: opts.gateFiles ? readList(opts.gateFiles) : GATE_FILES,
});
report({ faults, chunks });
