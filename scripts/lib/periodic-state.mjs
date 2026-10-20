// What the startup step «periodico» (scripts/lib/periodic.mjs, chunk 21 of plans/trabajar-solos.md) remembers between sessions: two small
// files in ~/.fabrica/, beside the passes file of `audit` (scripts/lib/goals-debt.mjs). Their directory is derived from that file and never retyped.
//   judge-debt.json     the last judge debt that `audit --data` computed (the only place of that figure; `audit --data` writes it when it ends,
//                       the startup step reads it without network). A run that could not compute it (no judge data) leaves the file as it was.
//   periodic-last.json  the lines of the local audit the step printed last time, to say only what changed.
// A file that is there but cannot be read throws (principle 3); a file that is not there is `null`, and the caller says so.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// The name of the step (a leaf module on purpose: scripts/al-arrancar.mjs reads it while periodic.mjs may still be loading, see there).
export const STEP_NAME = 'periodico';
export const JUDGE_FILE = 'judge-debt.json';
export const SNAPSHOT_FILE = 'periodic-last.json';
const DIR_MODE = 0o700;

export const besidePasses = (passesFile, name) => join(dirname(passesFile), name);
export const judgeDatumPath = (passesFile) => besidePasses(passesFile, JUDGE_FILE);
export const snapshotPath = (passesFile) => besidePasses(passesFile, SNAPSHOT_FILE);

function write(file, value) {
  mkdirSync(dirname(file), { recursive: true, mode: DIR_MODE });
  writeFileSync(file, `${JSON.stringify(value)}\n`);
}

function read(file, check) {
  if (!existsSync(file)) return null;
  let value;
  try { value = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${file} is not JSON`, { cause: e }); }
  if (Number.isNaN(Date.parse(value?.t))) throw new Error(`${file}: it needs a time (t)`);
  const problem = check(value);
  if (problem !== null) throw new Error(`${file}: ${problem}`);
  return value;
}

// `judge` is the `judge-debt` indicator of audit --data. Only a computed one is kept; returns whether it wrote.
export function recordJudgeDatum(file, judge, now) {
  if (judge?.computed !== true) return false;
  write(file, { t: new Date(now).toISOString(), judge });
  return true;
}

const judgeProblem = (v) => {
  const j = v.judge;
  if (j?.computed !== true) return 'judge.computed must be true';
  if (!Number.isInteger(j.count) || !Array.isArray(j.shas)) return 'judge needs a count and a list of shas';
  return null;
};

// { t, judge } of the last `audit --data`, or null when none left one.
export const readJudgeDatum = (file) => read(file, judgeProblem);

export const writeSnapshot = (file, now, lines) => write(file, { t: new Date(now).toISOString(), lines });

const snapshotProblem = (v) => (v.lines === null || typeof v.lines !== 'object' || Array.isArray(v.lines) || Object.values(v.lines).some((l) => typeof l !== 'string') ? 'lines must be an object of texts' : null);

// { t, lines: { <indicator id>: <text> } } of the last run of the step, or null at the first run.
export const readSnapshot = (file) => read(file, snapshotProblem);
