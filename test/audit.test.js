// scripts/audit.mjs: every indicator of INDICATORS is measured from a throwaway root built here, and each test
// goes red when its indicator is broken. Vocabulary comes from the scripts/lib modules, never retyped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDICATORS, LONG_FILE_LINES, MIN_DUP_LENGTH, audit, auditData, cliAudit, humanLocal } from '../scripts/audit.mjs';
import { casaDeAudit } from './apoyo/audit-casa.mjs';
import { fixture, manyLines } from './apoyo/audit-raiz.mjs';
import { exportedStrings } from '../scripts/lib/quoted-strings.mjs';
import { DATA_IDS, DATA_INDICATORS, MS_DAY } from '../scripts/lib/audit-data.mjs';
import { JUDGE_NOT_COMPUTED, JUDGE_WHY } from '../scripts/lib/judge-debt.mjs';
import { HITL_INDICATORS } from '../scripts/lib/audit-hitl.mjs';
import { EXIT } from '../scripts/lib/exit.mjs';
import { ENTITY, KEYS, fieldId } from '../scripts/lib/fields.mjs';
import { CODES, NEEDS_RECORDS, NOT_COMPUTED } from '../scripts/lib/hygiene.mjs';
import { MIN_VALUES } from '../scripts/lib/free-values.mjs';
import { CLASES, FALTAS, ORIGENES, ORIGEN_AGENTE, registrarIntervencion, rutaDeRegistroIntervenciones } from '../scripts/lib/intervention-log.mjs';
import { LESSONS_DIR, LESSON_NOTE, NO_QUESTION, REASON_SINGLE, SIGNAL_MACHINE, SIGNAL_NONE } from '../scripts/lib/lessons.mjs';
import { CHECKED_BY } from '../scripts/lib/questions.mjs';
import { marcar } from '../scripts/hitl.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'audit.mjs');
const NON_LOCAL = [...DATA_INDICATORS, ...HITL_INDICATORS]; // measured by audit --data and audit --hitl, not by the local audit
const NO_LOG = 'no-such-log.jsonl';

// What hygiene and no-per-kind need of any lesson (a lesson without them stops the audit).
const READABLE = { signal: SIGNAL_NONE, question: NO_QUESTION, mechanism: 'scripts/con.mjs', sources: ['#9'] };
const run = (root) => audit(root, { logPath: path.join(root, NO_LOG) });

test('INDICATORS is the closed list: the local audit returns exactly one value per non-data id', (t) => {
  const ids = Object.values(INDICATORS).filter((id) => !NON_LOCAL.includes(id));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(Object.keys(run(fixture(t))).sort(), [...ids].sort());
});

test('questions are counted by who checks them', (t) => {
  const q = run(fixture(t))[INDICATORS.questions];
  assert.equal(q.total, 3);
  assert.deepEqual(q.byCheckedBy, { [CHECKED_BY.machine]: 1, [CHECKED_BY.reviewer]: 2 });
});

test('lessons are counted by signal and by reason', (t) => {
  const r = run(fixture(t));
  assert.deepEqual(r[INDICATORS.lessonsSignal], { total: 3, bySignal: { [SIGNAL_MACHINE]: 2, [SIGNAL_NONE]: 1 } });
  assert.deepEqual(r[INDICATORS.lessonsReason], { [REASON_SINGLE]: 2 });
});

test('rules without reader reads the budget of the ratchet, it does not recompute the bullets', (t) => {
  const r = run(fixture(t))[INDICATORS.rulesWithoutReader];
  assert.equal(r.total, 7);
  assert.deepEqual(r.bySkill, { uno: 3, dos: 4 });
});

test('hitl: self-declared marks come from the log through marcar; table rows from intervenciones.md', (t) => {
  const root = fixture(t);
  const log = path.join(root, 'log', path.basename(rutaDeRegistroIntervenciones()));
  mkdirSync(path.dirname(log));
  marcar(CLASES[0], FALTAS[0], undefined, { ruta: log });
  registrarIntervencion({ clase: CLASES[0], origen: ORIGENES.find((o) => o !== ORIGEN_AGENTE), falta: FALTAS[0], ruta: log });
  const h = audit(root, { logPath: log })[INDICATORS.hitlSelfDeclared];
  assert.deepEqual(h, { selfDeclared: 1, total: 2, corrupt: [], tableRows: 2 });
  assert.equal(run(root)[INDICATORS.hitlSelfDeclared].selfDeclared, 0);
});

test('hitl: an unreadable line of the log is shown, not lost', (t) => {
  const root = fixture(t);
  const log = path.join(root, NO_LOG);
  writeFileSync(log, 'not json\n');
  const h = audit(root, { logPath: log })[INDICATORS.hitlSelfDeclared];
  assert.deepEqual([h.total, h.corrupt], [1, [1]]);
});

test('scripts without --json lists the root scripts that do not cite it', (t) => {
  const s = run(fixture(t))[INDICATORS.scriptsWithoutJson];
  assert.deepEqual(s, { total: 2, count: 1, files: ['scripts/sin.mjs'] });
});

test('long files: over the limit is listed, exactly at the limit is not', (t) => {
  const root = fixture(t, { 'scripts/largo.mjs': manyLines(LONG_FILE_LINES + 1), 'test/justo.test.js': manyLines(LONG_FILE_LINES) });
  const l = run(root)[INDICATORS.longFiles];
  assert.deepEqual(l.files, [{ file: 'scripts/largo.mjs', lines: LONG_FILE_LINES + 1 }]);
  assert.equal(l.count, 1);
});

test('magic numbers: a number in a comparison counts, 0 and 1 do not', (t) => {
  const root = fixture(t, { 'scripts/num.mjs': 'export const f = (x) => (x > 4242 ? 1 : 0);\n' });
  const m = run(root)[INDICATORS.magicNumbers];
  assert.deepEqual(m.files, [{ file: 'scripts/num.mjs', count: 1 }]);
  assert.equal(m.count, 1);
});

test('magic numbers: only the rule counts (an unused eslint-disable is not a number) and an unreadable file fails loudly', (t) => {
  const ok = fixture(t, { 'scripts/num.mjs': '// eslint-disable-next-line no-undef\nexport const f = (x) => (x > 4242 ? 1 : 0);\n' });
  assert.equal(run(ok)[INDICATORS.magicNumbers].count, 1);
  const bad = fixture(t, { 'scripts/roto.mjs': 'export const x = (;\n' });
  assert.throws(() => run(bad), /could not read.*roto\.mjs/);
});

test('base holes lists the entities whose base is a hole', (t) => {
  assert.deepEqual(run(fixture(t))[INDICATORS.baseHoles].holes, ['e1']);
});

test('test duplication: a long exported string found in a test is listed with both files', (t) => {
  const d = run(fixture(t))[INDICATORS.testDuplication];
  assert.equal(d.minLength, MIN_DUP_LENGTH);
  assert.deepEqual(d.values, [{ value: 'vocabulary-word', tests: ['test/uses.test.js'], lib: ['scripts/lib/vocab.mjs'] }]);
});

test('test duplication: a string shorter than the minimum, or not in an export const, is not listed', (t) => {
  const short = 'x'.repeat(MIN_DUP_LENGTH - 1);
  const root = fixture(t, { 'scripts/lib/vocab.mjs': `export const W = ['${short}'];\n`, 'test/uses.test.js': `const a = '${short}'; const b = 'not-exported-anywhere';\n` });
  assert.equal(run(root)[INDICATORS.testDuplication].count, 0);
  assert.deepEqual(exportedStrings("const P = 'private-word-here';\nexport const E = 'exported-word';\n// export const C = 'comment-word';\n"), ['exported-word']);
});

test('free values: the text fields of the registry come with their repeated values and a proposal of enum', (t) => {
  const notes = Object.fromEntries(Array.from({ length: MIN_VALUES }, (_, i) => [`${LESSONS_DIR}/n${i}.json`, JSON.stringify({ ...READABLE, [LESSON_NOTE]: 'same' })]));
  const f = run(fixture(t, notes))[INDICATORS.freeValues];
  assert.equal(f.count, 1);
  assert.deepEqual(f.fields.map((x) => [x.field, x.total, x.repeated, x.proposal]), [[fieldId({ [KEYS.owner]: ENTITY.lesson, [KEYS.name]: LESSON_NOTE }), MIN_VALUES, [{ value: 'same', count: MIN_VALUES }], ['same']]]);
});

test('free values: the text output has the indicator line and each proposal', (t) => {
  const notes = Object.fromEntries(Array.from({ length: MIN_VALUES }, (_, i) => [`${LESSONS_DIR}/n${i}.json`, JSON.stringify({ ...READABLE, [LESSON_NOTE]: 'same' })]));
  const lines = humanLocal(run(fixture(t, notes))).split('\n');
  assert.ok(lines.includes(`${INDICATORS.freeValues}: 1 of 1 text fields with a proposal of enum`));
  assert.ok(lines.some((l) => l.endsWith('["same"]')));
});

test('hygiene: the candidates are counted by code; the codes that need records are null and said apart', (t) => {
  const h = run(fixture(t))[INDICATORS.hygiene];
  assert.deepEqual(h.byCode, { [CODES.MERGE]: 1, [CODES.PROMOTE]: 1, [CODES.RETIRE_TEXT]: null, [CODES.REWORK]: null, [CODES.OVERLAP]: 0, [CODES.DEAD_REF]: 0 });
  assert.equal(h.total, 2);
  assert.deepEqual(h.notComputed, NEEDS_RECORDS.map((code) => ({ code, reason: NOT_COMPUTED.noRecords })));
  assert.equal(Object.hasOwn(h, 'candidates'), false);
});

test('hygiene: a lesson whose mechanism is gone counts as DEAD_REF, and the text output has the indicator line', (t) => {
  const root = fixture(t, { [`${LESSONS_DIR}/d.json`]: JSON.stringify({ signal: SIGNAL_MACHINE, question: NO_QUESTION, mechanism: 'scripts/gone.mjs', sources: ['#9'] }) });
  const r = run(root);
  assert.equal(r[INDICATORS.hygiene].byCode[CODES.DEAD_REF], 1);
  assert.ok(humanLocal(r).split('\n').includes(`${INDICATORS.hygiene}: 3 ${JSON.stringify(r[INDICATORS.hygiene].byCode)}`));
});

test('signals, not gates: a root full of faults still exits OK, in text and in --json', (t) => {
  const root = fixture(t, { 'scripts/largo.mjs': manyLines(LONG_FILE_LINES * 2) });
  assert.equal(cliAudit([root]).code, EXIT.OK);
  const j = cliAudit(['--json', root]);
  assert.equal(j.code, EXIT.OK);
  assert.equal(JSON.parse(j.stdout).ok, true);
});

test('the real entry point: node scripts/audit.mjs --json prints one JSON object with every indicator', (t) => {
  const r = spawnSync(process.execPath, [SCRIPT, '--json'], { encoding: 'utf8', cwd: RAIZ, env: casaDeAudit(t).env });
  assert.equal(r.status, EXIT.OK, r.stderr);
  const out = JSON.parse(r.stdout);
  for (const id of Object.values(INDICATORS).filter((i) => !NON_LOCAL.includes(i))) assert.ok(Object.hasOwn(out, id), `missing ${id}`);
});

test('audit --data: the judge debt of the fixture is counted from the last good pass, in JSON and in text', () => {
  const records = path.join(RAIZ, 'test', 'fixtures', 'audit', 'records.json');
  const j = JSON.parse(cliAudit(['--json', '--data', '--records', records]).stdout)[DATA_IDS.judgeDebt];
  assert.deepEqual([j.computed, j.count, j.firstAt, j.lastPassedAt], [true, 2, '2026-02-02T10:00:00.000Z', '2026-01-20T08:00:00Z']);
  const at = (now) => auditData(JSON.parse(readFileSync(records, 'utf8')), { now })[DATA_IDS.judgeDebt].days;
  assert.deepEqual([at(Date.parse(j.firstAt) + MS_DAY - 1), at(Date.parse(j.firstAt) + 2 * MS_DAY)], [0, 2]);
  assert.ok(cliAudit(['--data', '--records', records]).stdout.split('\n').some((l) => l.startsWith(`${DATA_IDS.judgeDebt}: {"computed":true,"lastPassedSha":`)));
});

test('audit --data: records without the judge say «no calculado» in both outputs, never a zero, and the command still exits OK', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'audit-judge-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { judge, ...without } = JSON.parse(readFileSync(path.join(RAIZ, 'test', 'fixtures', 'audit', 'records.json'), 'utf8'));
  assert.ok(judge);
  writeFileSync(path.join(dir, 'records.json'), JSON.stringify(without));
  const args = ['--data', '--records', path.join(dir, 'records.json')];
  const json = cliAudit(['--json', ...args]);
  assert.equal(json.code, EXIT.OK);
  assert.deepEqual(JSON.parse(json.stdout)[DATA_IDS.judgeDebt], { computed: false, state: JUDGE_NOT_COMPUTED, conclusive: false, why: [JUDGE_WHY.noJudgeData] });
  const text = cliAudit(args);
  assert.equal(text.code, EXIT.OK);
  assert.ok(text.stdout.includes(`${DATA_IDS.judgeDebt}: {"computed":false,"state":"${JUDGE_NOT_COMPUTED}"`));
});
