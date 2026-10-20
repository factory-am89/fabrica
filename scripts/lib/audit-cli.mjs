// The command line of scripts/audit.mjs: its flags, the three modes (local, --data, --hitl) and the entry points. Moved out of
// audit-data.mjs, which was at the 200-line limit; the figures of each mode live in audit-data.mjs and audit-hitl.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_IDS, DATA_INDICATORS, humanData } from './audit-data.mjs';
import { HITL_INDICATORS, humanHitl } from './audit-hitl.mjs';
import { ExitError, runCommand } from './exit.mjs';
import { DEBT_ID, PASS_MODE, humanDebt, stampPass } from './goals-debt.mjs';
import { readGoals } from './goals.mjs';
import { judgeDatumPath, recordJudgeDatum } from './periodic-state.mjs';

const FLAG = { data: '--data', hitl: '--hitl', records: '--records', repo: '--repo', since: '--since', golden: '--golden', log: '--log', messages: '--messages' };
const VALUE_FLAGS = [FLAG.records, FLAG.repo, FLAG.since, FLAG.golden, FLAG.log, FLAG.messages];
const FLAG_PREFIX = '--';
const key = (flag) => flag.slice(FLAG_PREFIX.length);

// argv without --json -> { data, hitl, root, records, repo, since, golden, log, messages }; a flag that needs a value without one, or a flag in the wrong mode, is a USAGE error.
export function parseAuditArgs(args, defaultRoot) {
  const out = { data: false, hitl: false, root: defaultRoot, records: null, repo: null, since: null, golden: null, log: null, messages: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === FLAG.data) out.data = true;
    else if (args[i] === FLAG.hitl) out.hitl = true;
    else if (VALUE_FLAGS.includes(args[i])) {
      if (args[i + 1] === undefined) throw new ExitError('USAGE', `${args[i]} needs a value`);
      out[key(args[i])] = args[++i];
    } else out.root = path.resolve(args[i]);
  }
  if (out.data && out.hitl) throw new ExitError('USAGE', `${FLAG.data} and ${FLAG.hitl} are two modes: pick one`);
  const extras = [FLAG.records, FLAG.repo, FLAG.since].filter((f) => out[key(f)] !== null);
  if (!out.data && !out.hitl && extras.length > 0) throw new ExitError('USAGE', `${[FLAG.records, FLAG.repo, FLAG.since, FLAG.golden].join(', ')} go with ${FLAG.data}`);
  if (out.data && (out.records === null) === (out.repo === null)) throw new ExitError('USAGE', `${FLAG.data} needs exactly one of ${FLAG.records} <file> or ${FLAG.repo} <owner/name>`);
  if (out.hitl && (out.records === null || out.repo !== null)) throw new ExitError('USAGE', `${FLAG.hitl} reads the Fábrica's own logs: it needs ${FLAG.records} <file> (for the escapes) and no ${FLAG.repo}`);
  if (out.golden !== null && out.records === null) throw new ExitError('USAGE', `${FLAG.golden} reads the Fábrica's own files: it goes with ${FLAG.records}, not ${FLAG.repo}`);
  if (!out.hitl && (out.log !== null || out.messages !== null)) throw new ExitError('USAGE', `${FLAG.log} and ${FLAG.messages} go with ${FLAG.hitl}`);
  return out;
}

const modeOf = (a) => (a.hitl ? PASS_MODE.hitl : a.data ? PASS_MODE.data : PASS_MODE.local);

// The entry points of scripts/audit.mjs. `download(repo, since)` is the async --repo download (runCommand is not async):
// a repo the token cannot read, or any failed call, stops the command with its own class and prints nothing as data.
// `passes` ({ file, now }) is given only by the real entry: it dates the goals debt, adds it to the three modes and records the pass.
export function makeCommands({ root: defaultRoot, audit, auditData, auditHitl, humanLocal, download }) {
  const has = (ids, r) => ids.every((id) => Object.hasOwn(r, id));
  const body = (r) => (has(DATA_INDICATORS, r) ? humanData(r) : has(HITL_INDICATORS, r) ? humanHitl(r) : humanLocal(r));
  const human = (r) => [body(r), ...(Object.hasOwn(r, DEBT_ID) ? humanDebt(r[DEBT_ID]) : [])].join('\n');
  const measure = (a, collected) => {
    if (a.hitl) return auditHitl(JSON.parse(readFileSync(a.records, 'utf8')), { root: a.root, logPath: a.log ?? undefined, messagesPath: a.messages ?? undefined });
    if (!a.data) return audit(a.root);
    if (a.records === null) return auditData(collected, { now: Date.now() });
    return auditData(JSON.parse(readFileSync(a.records, 'utf8')), { root: a.root, golden: a.golden });
  };
  const cliAudit = (argv, { collected = null, passes = null } = {}) => runCommand(argv, {
    run: (args) => {
      const a = parseAuditArgs(args, defaultRoot);
      const result = measure(a, collected);
      if (passes === null) return result;
      const stamped = stampPass(result, modeOf(a), { registry: readGoals(a.root), root: a.root, file: passes.file, now: passes.now });
      // The last judge debt of `audit --data` is kept beside the passes for the startup step (scripts/lib/periodic-state.mjs).
      if (a.data) recordJudgeDatum(judgeDatumPath(passes.file), stamped[DATA_IDS.judgeDebt], passes.now);
      return stamped;
    },
    human,
  });
  const mainAudit = async (argv, downloadIt = download, passes = null) => {
    try {
      const a = parseAuditArgs(argv.filter((x) => x !== '--json'), defaultRoot);
      return cliAudit(argv, { collected: a.repo === null ? null : await downloadIt(a.repo, a.since), passes });
    } catch (e) {
      const failure = e instanceof ExitError ? e : new ExitError('GH_FAILED', e.message);
      return runCommand(argv, { run: () => { throw failure; }, human });
    }
  };
  return { cliAudit, mainAudit };
}
