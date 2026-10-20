// What `audit` owes about the goals (scripts/lib/goals-debt.mjs): the holes, the readers that fire by hand and the indicators that cannot
// conclude, each with the days since the last pass of its mode; and the record of every pass (a throwaway home, never the real ~/.fabrica).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDICATORS, audit, cliAudit } from '../scripts/audit.mjs';
import { DATA_IDS, MS_DAY } from '../scripts/lib/audit-data.mjs';
import { HITL_IDS } from '../scripts/lib/audit-hitl.mjs';
import { EXIT } from '../scripts/lib/exit.mjs';
import { GOALS_FILE, HOLE, HOLE_REASONS, KEY, LIST, readGoals } from '../scripts/lib/goals.mjs';
import { DEBT_ID, DEBT_KIND, NEVER, PASS_MODE, debtOf, humanDebt, inconclusiveDebt, passesPath, readPasses, recordPass, staticDebt, stampPass, withDays } from '../scripts/lib/goals-debt.mjs';
import { rutaDeRegistro } from '../scripts/lib/op-log.mjs';
import { FALTAS } from '../scripts/lib/intervention-log.mjs';
import { WHY } from '../scripts/lib/lesson-effect.mjs';
import { casaDeAudit } from './apoyo/audit-casa.mjs';
import { fixture, goalsOf, put } from './apoyo/audit-raiz.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'audit.mjs');
const RECORDS = path.join(RAIZ, 'test', 'fixtures', 'audit', 'records.json');
const NO_FILE = 'no-such-file.jsonl';
const NOW = Date.parse('2026-06-15T12:00:00Z');
const clone = (x) => JSON.parse(JSON.stringify(x));
const real = () => readGoals(RAIZ);
const line = (mode, t) => `${JSON.stringify({ t: new Date(t).toISOString(), mode })}\n`;
const holeGoals = () => goalsOf([HOLE], { [KEY.holeReason]: HOLE_REASONS[0] });
const writeFileIn = (casa, text) => { put(casa.casa, path.relative(casa.casa, casa.file), text); };

test('a goal with a hole and a reader that fires only by hand are the static debt, seen by the local pass; the rest is not debt', () => {
  const r = clone(real());
  const [first, second] = r[LIST.goals];
  Object.assign(first, { [KEY.indicators]: [HOLE], [KEY.holeReason]: HOLE_REASONS[0] });
  second[KEY.readers].push('audit');
  assert.deepEqual(staticDebt(r, RAIZ), [
    { kind: DEBT_KIND.hole, ref: first[KEY.id], goals: [first[KEY.id]], mode: PASS_MODE.local, detail: { reason: HOLE_REASONS[0] } },
    { kind: DEBT_KIND.manualReader, ref: 'audit', goals: [second[KEY.id]], mode: PASS_MODE.local, detail: null },
  ]);
  assert.deepEqual(staticDebt(real(), RAIZ), []);
});

test('an indicator with a case that cannot conclude is debt, by indicator id, with its count, its reasons and the goals that list it', () => {
  const registry = real();
  const result = {
    [DATA_IDS.lessonEffect]: { conclusive: 1, lessons: [{ conclusive: false, why: [WHY.noDate] }, { conclusive: false, why: [WHY.fewCases, WHY.noDate] }, { conclusive: true, why: [] }] },
    [HITL_IDS.residue]: { events: { trend: { conclusive: false } }, messages: null },
    [DATA_IDS.rounds]: { conclusive: true, mean: 2 },
    [DATA_IDS.messages]: null,
    [DEBT_ID]: debtOf([{ conclusive: false }]),
  };
  assert.deepEqual(inconclusiveDebt(result, registry, PASS_MODE.data), [
    { kind: DEBT_KIND.inconclusive, ref: HITL_IDS.residue, goals: ['O2'], mode: PASS_MODE.data, detail: { count: 1, why: [] } },
    { kind: DEBT_KIND.inconclusive, ref: DATA_IDS.lessonEffect, goals: ['O3'], mode: PASS_MODE.data, detail: { count: 2, why: [WHY.fewCases, WHY.noDate].sort() } },
  ]);
  assert.deepEqual(inconclusiveDebt({ [DATA_IDS.rounds]: { conclusive: 3 } }, registry, PASS_MODE.data), []);
});

test('the passes: the last time of each mode; no file is no pass; a line that is not a pass stops the read; recording creates the folder', (t) => {
  const casa = casaDeAudit(t);
  assert.deepEqual(readPasses(casa.file), {});
  recordPass(casa.file, PASS_MODE.hitl, NOW);
  assert.deepEqual(JSON.parse(readFileSync(casa.file, 'utf8')), { t: new Date(NOW).toISOString(), mode: PASS_MODE.hitl });
  writeFileSync(casa.file, line(PASS_MODE.local, NOW) + line(PASS_MODE.data, NOW - MS_DAY) + line(PASS_MODE.local, NOW - 2 * MS_DAY));
  assert.deepEqual(readPasses(casa.file), { [PASS_MODE.local]: NOW, [PASS_MODE.data]: NOW - MS_DAY });
  writeFileSync(casa.file, `${line(PASS_MODE.local, NOW)}not json\n`);
  assert.throws(() => readPasses(casa.file), /line 2 is not JSON/);
  writeFileSync(casa.file, line('weekly', NOW));
  assert.throws(() => readPasses(casa.file), /line 1: a pass needs a time \(t\) and a mode/);
  writeFileSync(casa.file, `${JSON.stringify({ t: 'yesterday', mode: PASS_MODE.local })}\n`);
  assert.throws(() => readPasses(casa.file), /line 1: a pass needs a time \(t\) and a mode/);
  writeFileSync(casa.file, `${JSON.stringify({ mode: PASS_MODE.local })}\n`);
  assert.throws(() => readPasses(casa.file), /line 1: a pass needs a time \(t\) and a mode/);
});

test('the passes go in the folder of the other logs of the Factory, under the home it is given', () => {
  const home = () => path.join(RAIZ, 'casa');
  assert.equal(path.dirname(passesPath(home)), path.dirname(rutaDeRegistro(home)));
  assert.equal(path.dirname(path.dirname(passesPath(home))), home());
});

test('days are whole days since the last pass of the item\'s own mode, and null when that mode never passed', () => {
  const items = [{ mode: PASS_MODE.local }, { mode: PASS_MODE.data }, { mode: PASS_MODE.hitl }];
  const passes = { [PASS_MODE.local]: NOW - 3 * MS_DAY - 1, [PASS_MODE.data]: NOW - MS_DAY + 1 };
  assert.deepEqual(withDays(items, passes, NOW).map((i) => i.days), [3, 0, null]);
  assert.deepEqual(withDays([{ mode: PASS_MODE.local }], { [PASS_MODE.local]: NOW - 3 * MS_DAY }, NOW).map((i) => i.days), [3]);
});

test('stampPass dates the debt by the passes before this one, then records this pass; a failed read records nothing', (t) => {
  const casa = casaDeAudit(t);
  writeFileIn(casa, line(PASS_MODE.local, NOW - 10 * MS_DAY));
  const registry = holeGoals();
  const out = stampPass({ x: 1 }, PASS_MODE.local, { registry, root: RAIZ, file: casa.file, now: NOW });
  assert.deepEqual(out, { x: 1, [DEBT_ID]: { count: 1, items: [{ kind: DEBT_KIND.hole, ref: 'G1', goals: ['G1'], mode: PASS_MODE.local, detail: { reason: HOLE_REASONS[0] }, days: 10 }] } });
  assert.equal(readPasses(casa.file)[PASS_MODE.local], NOW);
  writeFileSync(casa.file, 'broken\n');
  assert.throws(() => stampPass({ x: 1 }, PASS_MODE.local, { registry, root: RAIZ, file: casa.file, now: NOW }), /is not JSON/);
  assert.equal(readFileSync(casa.file, 'utf8'), 'broken\n');
});

test('the text of the debt: a line per item with its goals, its detail and its days, or «never passed»', () => {
  const debt = debtOf([
    { kind: DEBT_KIND.hole, ref: 'O1', goals: ['O1'], mode: PASS_MODE.local, detail: { reason: 'x' }, days: 4 },
    { kind: DEBT_KIND.manualReader, ref: 'audit', goals: ['O2', 'O3'], mode: PASS_MODE.local, detail: null, days: null },
    { kind: DEBT_KIND.inconclusive, ref: 'rounds', goals: [], mode: PASS_MODE.data, detail: null },
  ]);
  assert.deepEqual(humanDebt(debt), [
    `${DEBT_ID}: 3`,
    `  hole: O1 (O1) {"reason":"x"} - 4 days since the last local pass`,
    `  manual-reader: audit (O2, O3) - ${NEVER}`,
    '  inconclusive: rounds ()',
  ]);
  assert.deepEqual(humanDebt(debtOf([])), [`${DEBT_ID}: 0`]);
});

test('the local audit lists the static debt in INDICATORS (no days: nothing was passed), and the text output ends with it', (t) => {
  const root = fixture(t, { [GOALS_FILE]: JSON.stringify(holeGoals()) });
  const item = { kind: DEBT_KIND.hole, ref: 'G1', goals: ['G1'], mode: PASS_MODE.local, detail: { reason: HOLE_REASONS[0] } };
  assert.deepEqual(audit(root, { logPath: path.join(root, NO_FILE) })[INDICATORS.goalsDebt], { count: 1, items: [item] });
  const text = cliAudit([root]).stdout.trimEnd().split('\n');
  assert.deepEqual(text.slice(-2), [`${DEBT_ID}: 1`, `  hole: G1 (G1) {"reason":"${HOLE_REASONS[0]}"}`]);
});

test('cliAudit with passes dates the debt in JSON and in text, and records the local pass', (t) => {
  const root = fixture(t, { [GOALS_FILE]: JSON.stringify(holeGoals()) });
  const casa = casaDeAudit(t);
  writeFileIn(casa, line(PASS_MODE.local, NOW - 3 * MS_DAY));
  const j = cliAudit(['--json', root], { passes: { file: casa.file, now: NOW } });
  assert.equal(j.code, EXIT.OK, j.stderr);
  assert.deepEqual(JSON.parse(j.stdout)[DEBT_ID].items.map((i) => [i.ref, i.days]), [['G1', 3]]);
  assert.ok(j.stderr.split('\n').includes(`  hole: G1 (G1) {"reason":"${HOLE_REASONS[0]}"} - 3 days since the last local pass`));
  assert.equal(readPasses(casa.file)[PASS_MODE.local], NOW);
  const none = casaDeAudit(t);
  const first = cliAudit([root], { passes: { file: none.file, now: NOW } });
  assert.ok(first.stdout.includes(` - ${NEVER}`));
  assert.equal(readFileSync(none.file, 'utf8'), line(PASS_MODE.local, NOW));
  assert.equal(existsSync(passesPath(() => path.join(root, NO_FILE))), false);
});

test('--data lists the lessons whose effect cannot conclude, and --hitl the indicators with too few cases; each records its own pass', (t) => {
  const casa = casaDeAudit(t);
  writeFileIn(casa, line(PASS_MODE.local, NOW - MS_DAY) + line(PASS_MODE.data, NOW - 2 * MS_DAY));
  const passes = { file: casa.file, now: NOW };
  const data = JSON.parse(cliAudit(['--json', '--data', '--records', RECORDS], { passes }).stdout);
  const effect = data[DEBT_ID].items.find((i) => i.ref === DATA_IDS.lessonEffect);
  assert.deepEqual([effect.kind, effect.goals, effect.mode, effect.days], [DEBT_KIND.inconclusive, ['O3'], PASS_MODE.data, 2]);
  assert.equal(effect.detail.count, data[DATA_IDS.lessonEffect].lessons.filter((l) => !l.conclusive).length);
  assert.ok(effect.detail.count > 0);
  assert.equal(readPasses(casa.file)[PASS_MODE.data], NOW);
  const hitl = JSON.parse(cliAudit(['--json', '--hitl', '--records', RECORDS, '--log', path.join(casa.casa, NO_FILE), '--messages', path.join(casa.casa, NO_FILE)], { passes }).stdout);
  const byRef = Object.fromEntries(hitl[DEBT_ID].items.filter((i) => i.kind === DEBT_KIND.inconclusive).map((i) => [i.ref, i]));
  assert.deepEqual(byRef[HITL_IDS.residue].detail, { count: FALTAS.length + 2, why: [WHY.fewCases] });
  assert.deepEqual([byRef[HITL_IDS.balance].detail.count, byRef[HITL_IDS.balance].goals, byRef[HITL_IDS.balance].mode, byRef[HITL_IDS.balance].days], [2, ['O2'], PASS_MODE.hitl, null]);
  assert.equal(readPasses(casa.file)[PASS_MODE.hitl], NOW);
  assert.equal(Object.hasOwn(hitl, INDICATORS.longFiles), false);
});

test('the real entry point records the pass in the home it runs in, and the days come from that file', (t) => {
  const root = fixture(t, { [GOALS_FILE]: JSON.stringify(holeGoals()) });
  const casa = casaDeAudit(t);
  writeFileIn(casa, line(PASS_MODE.local, Date.now() - 5 * MS_DAY - MS_DAY / 2));
  const before = Date.now();
  const r = spawnSync(process.execPath, [SCRIPT, '--json', root], { encoding: 'utf8', cwd: RAIZ, env: casa.env });
  const after = Date.now();
  assert.equal(r.status, EXIT.OK, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout)[DEBT_ID].items.map((i) => [i.kind, i.days]), [[DEBT_KIND.hole, 5]]);
  const t0 = readPasses(casa.file)[PASS_MODE.local];
  assert.ok(t0 >= before && t0 <= after, `${t0} is not within the run`);
  assert.equal(readFileSync(casa.file, 'utf8').trimEnd().split('\n').length, 2);
});
