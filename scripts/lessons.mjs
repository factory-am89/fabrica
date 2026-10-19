// Reader of the lesson registry (lessons/*.json): counts per question, per signal, per mechanism kind and per origin, and how many escaped to main,
// and the faults found by the validator in scripts/lib/lessons.mjs. Keys come from the data, not from a list.
//   node scripts/lessons.mjs [--json] [root]   (root defaults to this repo; output rule and exit codes: scripts/lib/exit.mjs)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExitError, runCommand, finish } from './lib/exit.mjs';
import { lessonContext, lessonFaults, mechanismKind, readLessons } from './lib/lessons.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Object.hasOwn, not out[v] ?? 0: an origin may be called «constructor», which every plain object already has.
const tally = (values) => {
  const out = {};
  for (const v of values) out[v] = Object.hasOwn(out, v) ? out[v] + 1 : 1;
  return out;
};

// Counts only the lessons with no fault (a faulty one has no trustworthy fields); the faults are listed apart.
export function summarize(root) {
  const lessons = readLessons(root);
  const faults = lessonFaults(lessons, lessonContext(root));
  const bad = new Set(faults.map((f) => f.where));
  const good = lessons.filter((l) => !bad.has(`lessons/${l.file}`)).map((l) => JSON.parse(l.text));
  return {
    total: lessons.length,
    byQuestion: tally(good.map((d) => d.question)),
    bySignal: tally(good.map((d) => d.signal)),
    byMechanism: tally(good.map((d) => mechanismKind(d.mechanism))),
    byOrigin: tally(good.map((d) => d.origin)),
    escaped: good.filter((d) => d.escaped).length,
    faults,
  };
}

const lines = (title, counts) => [`${title}:`, ...Object.entries(counts).map(([k, n]) => `  ${k}: ${n}`)];

export function humanText(s) {
  return [
    `lessons: ${s.total}`,
    ...lines('per question', s.byQuestion),
    ...lines('per signal', s.bySignal),
    ...lines('per mechanism', s.byMechanism),
    ...lines('per origin', s.byOrigin),
    `escaped to main: ${s.escaped}`,
    ...s.faults.map((f) => `fault ${f.code} ${f.where}: ${f.message}`),
  ].join('\n');
}

export function cliLessons(argv) {
  const refused = {}; // filled by run, so a refusal under --json still carries the counts and the faults
  return runCommand(argv, {
    refused,
    run: ([root = REPO]) => {
      const s = summarize(path.resolve(root));
      if (s.faults.length > 0) {
        Object.assign(refused, s);
        throw new ExitError('LESSON_FAULTS', humanText(s));
      }
      return s;
    },
    human: humanText,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) finish(cliLessons(process.argv.slice(2)));
