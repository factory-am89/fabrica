// npm run audit: measures the Factory from its local sources, with a closed list of indicators (INDICATORS).
// Every indicator is a signal, not a gate: no threshold here ever fails the command. Later chunks of
// plans/trabajar-solos.md add their own ids to INDICATORS; the readers (chunks 20 and 22) take the list from here.
//   node scripts/audit.mjs [--json] [root]   (output rule and exit codes: scripts/lib/exit.mjs)
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCommands } from './lib/audit-cli.mjs';
import { hitlOf, lessonsOf, lineCount, listFiles, questionsOf, readText, rulesWithoutReader } from './lib/audit-local.mjs';
import { DATA_IDS, dataIndicators } from './lib/audit-data.mjs';
import { HITL_IDS, hitlIndicators, readHitlInputs } from './lib/audit-hitl.mjs';
import { baseHoles, readEntities } from './lib/entities.mjs';
import { finish } from './lib/exit.mjs';
import { freeValues, humanFreeValues } from './lib/free-values.mjs';
import { DEBT_ID, passesPath, debtOf, staticDebt } from './lib/goals-debt.mjs';
import { readGoals } from './lib/goals.mjs';
import { hygieneCounts } from './lib/hygiene.mjs';
import { localInputs, readLessonSources } from './lib/lesson-effect.mjs';
import { noPerKind, reviewerNoRows } from './lib/reviewer-no.mjs';
import { exportedStrings, stringsOf } from './lib/quoted-strings.mjs';
import { contarMensajes } from './lib/message-log.mjs';
import { collect, getWithToken } from './collect-records.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// The closed list of what this command measures: the key of each value in the result.
export const INDICATORS = Object.freeze({
  questions: 'questions',
  lessonsSignal: 'lessons-signal',
  lessonsReason: 'lessons-reason',
  rulesWithoutReader: 'rules-without-reader',
  hitlSelfDeclared: 'hitl-self-declared',
  scriptsWithoutJson: 'scripts-without-json',
  longFiles: 'long-files',
  magicNumbers: 'magic-numbers',
  baseHoles: 'base-holes',
  testDuplication: 'test-duplication',
  freeValues: 'free-values',
  noPerKind: 'no-per-kind', // the «no» of the reviewer by kind of failure, outcome and question, and the relapses (scripts/lib/reviewer-no.mjs)
  hygiene: 'hygiene', // candidates by code (npm run hygiene lists them)
  goalsDebt: DEBT_ID, // what the goals owe: holes, readers that fire by hand (scripts/lib/goals-debt.mjs); a pass of audit --data or --hitl adds its indicators that cannot conclude
  ...DATA_IDS, // the data indicators (audit --data), listed in scripts/lib/audit-data.mjs
  ...HITL_IDS, // the indicators of audit --hitl, listed in scripts/lib/audit-hitl.mjs
});

// Parameters of the signals (none is a gate). MIN_DUP_LENGTH was fixed with the counts of the PR that created it.
export const LONG_FILE_LINES = 200;
export const MIN_DUP_LENGTH = 8;
// no-magic-numbers is run here and not in lint, where it would turn everything red.
const MAGIC_RULE = 'no-magic-numbers';
const MAGIC_ALLOWED = [-1, 0, 1];
const SOURCE_EXT = /\.(mjs|js)$/;
const JSON_FLAG = '--json';

function longFiles(root) {
  const files = ['scripts', 'test'].flatMap((d) => listFiles(root, d, (f) => SOURCE_EXT.test(f)));
  const long = files.map((f) => ({ file: f, lines: lineCount(readText(root, f)) })).filter((f) => f.lines > LONG_FILE_LINES);
  return { limit: LONG_FILE_LINES, count: long.length, files: long.sort((a, b) => b.lines - a.lines) };
}

// Numbers written in the code of scripts/ (no-magic-numbers of ESLint, as a warning so the exit code stays 0).
function magicNumbers(root) {
  const cli = path.join(path.dirname(createRequire(import.meta.url).resolve('eslint')), '..', 'bin', 'eslint.js');
  const rule = JSON.stringify({ [MAGIC_RULE]: ['warn', { ignore: MAGIC_ALLOWED, ignoreArrayIndexes: true }] });
  const r = spawnSync(process.execPath, [cli, '--no-config-lookup', '--format', 'json', '--rule', rule, 'scripts'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0 && r.status !== 1) throw new Error(`eslint failed (exit ${r.status}): ${r.stderr}`);
  const results = JSON.parse(r.stdout);
  // ESLint also exits 1 for a file it cannot read: that is a failure of the measure, never a number.
  const fatal = results.flatMap((f) => f.messages.filter((m) => m.fatal).map((m) => `${f.filePath}: ${m.message}`));
  if (fatal.length > 0) throw new Error(`eslint could not read: ${fatal.join('; ')}`);
  const files = results
    .map((f) => ({ file: path.relative(root, f.filePath).split(path.sep).join('/'), count: f.messages.filter((m) => m.ruleId === MAGIC_RULE).length }))
    .filter((f) => f.count > 0);
  return { count: files.reduce((a, f) => a + f.count, 0), files: files.sort((a, b) => b.count - a.count) };
}

function scriptsWithoutJson(root) {
  const files = listFiles(root, 'scripts', (f) => f.split('/').length === 2 && f.endsWith('.mjs'));
  const without = files.filter((f) => !readText(root, f).includes(JSON_FLAG));
  return { total: files.length, count: without.length, files: without };
}

// Vocabulary copied into tests: strings of length >= minLength found in a test/ file and in an `export const` of scripts/lib/.
export function duplicationInTests(root, minLength = MIN_DUP_LENGTH) {
  const lib = new Map();
  for (const f of listFiles(root, 'scripts/lib', (p) => p.endsWith('.mjs'))) {
    for (const s of exportedStrings(readText(root, f))) if (s.length >= minLength) lib.set(s, [...new Set([...(lib.get(s) ?? []), f])]);
  }
  const hits = new Map();
  for (const f of listFiles(root, 'test', (p) => SOURCE_EXT.test(p))) {
    for (const s of new Set(stringsOf(readText(root, f)))) {
      if (lib.has(s)) hits.set(s, [...(hits.get(s) ?? []), f]);
    }
  }
  const values = [...hits].map(([value, tests]) => ({ value, tests, lib: lib.get(value) })).sort((a, b) => b.tests.length - a.tests.length || a.value.localeCompare(b.value));
  return { minLength, count: values.length, values };
}

export function audit(root, { logPath } = {}) {
  const lessons = lessonsOf(root);
  return {
    [INDICATORS.questions]: questionsOf(root),
    [INDICATORS.lessonsSignal]: lessons.signal,
    [INDICATORS.lessonsReason]: lessons.reason,
    [INDICATORS.rulesWithoutReader]: rulesWithoutReader(root),
    [INDICATORS.hitlSelfDeclared]: hitlOf(root, logPath),
    [INDICATORS.scriptsWithoutJson]: scriptsWithoutJson(root),
    [INDICATORS.longFiles]: longFiles(root),
    [INDICATORS.magicNumbers]: magicNumbers(root),
    [INDICATORS.baseHoles]: { holes: baseHoles(readEntities(root)) },
    [INDICATORS.testDuplication]: duplicationInTests(root),
    [INDICATORS.freeValues]: freeValues(root),
    [INDICATORS.noPerKind]: noPerKind(reviewerNoRows(root), readLessonSources(root)),
    [INDICATORS.hygiene]: hygieneCounts(root),
    [INDICATORS.goalsDebt]: debtOf(staticDebt(readGoals(root), root)),
  };
}

export function auditData(data, { root = null, now = Date.now(), messagesPath, golden = null } = {}) {
  const local = root !== null;
  return dataIndicators(data, {
    now,
    lessonsEscaped: local ? lessonsOf(root).escaped : null,
    local: local ? localInputs(root, golden) : null,
    messageCounts: local ? contarMensajes(messagesPath === undefined ? undefined : { ruta: messagesPath }) : null,
  });
}

// audit --hitl: the intervention and message logs (or the ones at logPath / messagesPath) beside the escapes of `data`.
export const auditHitl = (data, { root, logPath, messagesPath }) => hitlIndicators(data, { lessonsEscaped: lessonsOf(root).escaped, inputs: readHitlInputs({ logPath, messagesPath }) });

export function humanLocal(r) {
  const line = (id, text) => `${id}: ${text}`;
  return [
    line(INDICATORS.questions, `${r[INDICATORS.questions].total} ${JSON.stringify(r[INDICATORS.questions].byCheckedBy)}`),
    line(INDICATORS.lessonsSignal, JSON.stringify(r[INDICATORS.lessonsSignal])),
    line(INDICATORS.lessonsReason, JSON.stringify(r[INDICATORS.lessonsReason])),
    line(INDICATORS.rulesWithoutReader, `${r[INDICATORS.rulesWithoutReader].total} ${JSON.stringify(r[INDICATORS.rulesWithoutReader].bySkill)}`),
    line(INDICATORS.hitlSelfDeclared, JSON.stringify(r[INDICATORS.hitlSelfDeclared])),
    line(INDICATORS.scriptsWithoutJson, `${r[INDICATORS.scriptsWithoutJson].count} of ${r[INDICATORS.scriptsWithoutJson].total}`),
    line(INDICATORS.longFiles, `${r[INDICATORS.longFiles].count} over ${r[INDICATORS.longFiles].limit} lines`),
    line(INDICATORS.magicNumbers, String(r[INDICATORS.magicNumbers].count)),
    line(INDICATORS.baseHoles, String(r[INDICATORS.baseHoles].holes.length)),
    line(INDICATORS.testDuplication, `${r[INDICATORS.testDuplication].count} strings of >= ${r[INDICATORS.testDuplication].minLength} chars`),
    ...r[INDICATORS.testDuplication].values.map((v) => `  ${JSON.stringify(v.value)}: ${v.tests.join(', ')} <- ${v.lib.join(', ')}`),
    ...humanFreeValues(INDICATORS.freeValues, r[INDICATORS.freeValues]),
    line(INDICATORS.noPerKind, `${r[INDICATORS.noPerKind].total} rows, ${r[INDICATORS.noPerKind].relapses.length} relapses, ${r[INDICATORS.noPerKind].otherNotes.length} notes of otro`),
    `  by kind: ${JSON.stringify(r[INDICATORS.noPerKind].byKind)}`,
    `  by outcome: ${JSON.stringify(r[INDICATORS.noPerKind].byOutcome)}`,
    line(INDICATORS.hygiene, `${r[INDICATORS.hygiene].total} ${JSON.stringify(r[INDICATORS.hygiene].byCode)}`),
  ].join('\n');
}

const downloadWithToken = (repo, since) => collect({ get: async (route) => getWithToken(route), repo, since });
export const { cliAudit, mainAudit } = makeCommands({ root: REPO, audit, auditData, auditHitl, humanLocal, download: downloadWithToken });

if (process.argv[1] === fileURLToPath(import.meta.url)) finish(await mainAudit(process.argv.slice(2), undefined, { file: passesPath(), now: Date.now() }));
