// audit --data (chunk 15): each data indicator is computed from the PRs and check-runs that scripts/collect-records.mjs
// downloads. test/fixtures/audit/records.json is a small known history; custom pulls are built here for the edges
// (exactly at a window, one millisecond past it). Vocabulary is imported from scripts/lib, never retyped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDICATORS, audit, auditData, cliAudit, mainAudit } from '../scripts/audit.mjs';
import { casaDeAudit } from './apoyo/audit-casa.mjs';
import { HITL_INDICATORS } from '../scripts/lib/audit-hitl.mjs';
import { BOUND, CAVEAT, DATA_INDICATORS, ESCAPE_DAYS, FIX_PREFIX, REWORK_HOURS } from '../scripts/lib/audit-data.mjs';
import { EXIT } from '../scripts/lib/exit.mjs';
import { LESSONS_DIR, NO_QUESTION } from '../scripts/lib/lessons.mjs';
import { REVIEWER_NO_FILE } from '../scripts/lib/reviewer-no.mjs';
import { registrarMensaje, rutaDeMensajes } from '../scripts/lib/message-log.mjs';
import { ANSWER } from '../scripts/lib/record.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'audit.mjs');
const RECORDS = path.join(RAIZ, 'test', 'fixtures', 'audit', 'records.json');
const data = () => JSON.parse(readFileSync(RECORDS, 'utf8'));
const HOUR = 3600000;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-03-01T00:00:00Z');
const NOW = T0 + 100 * DAY;
const iso = (ms) => new Date(ms).toISOString();
const REPO_N1 = 'o/n1';
const SESSION = 'sesion-uno';

// A PR for the edge tests: created/merged as offsets in ms from T0.
const pull = (number, ref, created, merged, files, extra = {}) => ({
  number, state: merged === null ? 'open' : 'closed', created_at: iso(T0 + created), merged_at: merged === null ? null : iso(T0 + merged), head_ref: ref, files, commits: [], ...extra,
});
const edge = (pulls) => auditData({ pulls, checkRuns: [] }, { now: NOW });
const run = () => auditData(data(), { root: RAIZ, now: NOW, messagesPath: path.join(tmpdir(), 'no-such-messages.jsonl') });

test('the data indicators are registered in INDICATORS and auditData returns exactly one value per id', () => {
  const ids = Object.values(INDICATORS);
  for (const id of DATA_INDICATORS) assert.ok(ids.includes(id), id);
  assert.deepEqual(Object.keys(run()).sort(), [...DATA_INDICATORS].sort());
  assert.deepEqual(Object.keys(audit(RAIZ)).sort(), ids.filter((id) => !DATA_INDICATORS.includes(id) && !HITL_INDICATORS.includes(id)).sort());
});

test('rounds: one per record, per PR, mean; a lower bound', () => {
  const r = run()[INDICATORS.rounds];
  assert.deepEqual([r.records, r.prs, r.mean], [6, 5, 1.2]);
  assert.equal(r.byPr['o/r#1'], 2);
  assert.equal(r.bound, BOUND.lower);
  assert.equal(r.caveat, CAVEAT.roundsMissing);
});

test('no per question: the counters of each question, from the records', () => {
  const q = run()[INDICATORS.noPerQuestion];
  assert.equal(q.C5[ANSWER.no], 2);
  assert.equal(q.C1[ANSWER.no], 0);
  assert.equal(q.C1[ANSWER.notApplicable], 1);
});

test('minutes: created to merged, only merged PRs', () => {
  assert.deepEqual(run()[INDICATORS.minutes], { merged: 5, total: 1620, mean: 324 });
});

test('overrides: the check-runs of Pablo\'s approval are counted', () => {
  assert.equal(run()[INDICATORS.overrides].count, 1);
});

test('messages: an upper bound from the log; not applicable (null) for another repo', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fabrica-msg-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ruta = rutaDeMensajes(() => dir);
  for (let i = 0; i < 10; i++) registrarMensaje({ sesion: SESSION, ruta, reloj: () => T0 + i });
  const m = auditData(data(), { root: RAIZ, now: NOW, messagesPath: ruta })[INDICATORS.messages];
  assert.deepEqual([m.total, m.sessions, m.perMergedPr, m.bound, m.caveat], [10, 1, 2, BOUND.upper, CAVEAT.messagesNotPerPr]);
  assert.equal(auditData(data(), { now: NOW })[INDICATORS.messages], null);
});

test('rework: a PR opened up to REWORK_HOURS after another was merged, on one of its files', () => {
  const base = [pull(1, 'feat/x', 0, HOUR, ['f.js'])];
  const at = (offset, files = ['f.js']) => edge([...base, pull(2, 'feat/y', HOUR + offset, null, files)])[INDICATORS.rework];
  assert.deepEqual(at(REWORK_HOURS * HOUR).prs, [2]);
  assert.equal(at(REWORK_HOURS * HOUR + 1).count, 0);
  assert.equal(at(0, ['other.js']).count, 0);
  assert.equal(edge([...base, pull(2, 'feat/y', HOUR - 1, null, ['f.js'])])[INDICATORS.rework].count, 0);
  assert.equal(run()[INDICATORS.rework].caveat, CAVEAT.reworkMixesCauses);
});

test('clashes: open at the same time and sharing a file; an open PR lasts until now; a closed one without merge is counted apart', () => {
  const two = (b) => edge([pull(1, 'feat/x', 0, 2 * HOUR, ['f.js']), b])[INDICATORS.clashes];
  assert.deepEqual(two(pull(2, 'feat/y', HOUR, 3 * HOUR, ['f.js'])).pairs.map((p) => p.prs), [[1, 2]]);
  assert.equal(two(pull(2, 'feat/y', HOUR, 3 * HOUR, ['g.js'])).count, 0);
  assert.equal(two(pull(2, 'feat/y', 2 * HOUR, 3 * HOUR, ['f.js'])).count, 0);
  assert.equal(two(pull(2, 'feat/y', HOUR, null, ['f.js'])).count, 1);
  const closed = two(pull(2, 'feat/y', HOUR, null, ['f.js'], { state: 'closed' }));
  assert.deepEqual([closed.count, closed.withoutEnd], [0, 1]);
  assert.deepEqual(run()[INDICATORS.clashes].pairs.map((p) => p.prs), [[1, 2]]);
});

test('escapes: a merged fix/ PR on files of a PR merged ESCAPE_DAYS before, plus escaped lessons, over merged PRs; a lower bound', () => {
  const base = pull(1, 'feat/x', 0, HOUR, ['f.js']);
  const fix = (offset, ref = `${FIX_PREFIX}y`, merged = true, files = ['f.js']) => edge([base, pull(2, ref, HOUR + offset, merged ? HOUR + offset + 1 : null, files)])[INDICATORS.escapes];
  assert.deepEqual(fix(ESCAPE_DAYS * DAY).fixPrs, [2]);
  assert.equal(fix(ESCAPE_DAYS * DAY + 1).count, 0);
  assert.equal(fix(0, 'feat/y').count, 0);
  assert.equal(fix(0, undefined, false).count, 0);
  assert.equal(fix(0, undefined, true, ['g.js']).count, 0);
  const e = run()[INDICATORS.escapes];
  assert.deepEqual([e.fixPrs, e.mergedPrs, e.bound, e.caveat], [[3], 5, BOUND.lower, CAVEAT.escapesUnseen]);
  assert.equal(e.count, e.fixPrs.length + e.lessonsEscaped);
  assert.equal(e.rate, e.count / e.mergedPrs);
  assert.equal(auditData(data(), { now: NOW })[INDICATORS.escapes].lessonsEscaped, null);
});

test('escapes: the lessons with escaped true are added, those with false are not', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'fabrica-lessons-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, LESSONS_DIR));
  for (const [name, escaped] of [['a', true], ['b', false], ['c', true]]) writeFileSync(path.join(root, LESSONS_DIR, `${name}.json`), JSON.stringify({ escaped, question: NO_QUESTION, sources: [] }));
  writeFileSync(path.join(root, REVIEWER_NO_FILE), JSON.stringify({ rows: [] }));
  const e = auditData({ pulls: [pull(1, 'feat/x', 0, HOUR, ['f.js'])], checkRuns: [] }, { root, now: NOW, messagesPath: path.join(root, 'none.jsonl') })[INDICATORS.escapes];
  assert.deepEqual([e.lessonsEscaped, e.fixPrs, e.count, e.rate], [2, [], 2, 2]);
});

test('project cost: a PR opened exactly when the first one merges is still counted; one opened after is not', () => {
  const cost = (offset) => auditData({ pulls: [pull(1, 'feat/x', 0, HOUR, ['f.js']), pull(2, 'feat/y', HOUR + offset, null, ['g.js'])], checkRuns: [] }, { now: NOW })[INDICATORS.projectCost].prs;
  assert.deepEqual([cost(0), cost(1)], [2, 1]);
});

test('project cost: PRs opened up to the first merge, their rounds and overrides', () => {
  const c = run()[INDICATORS.projectCost];
  assert.deepEqual([c.reachedFirstMerge, c.firstMergedPr, c.prs, c.rounds, c.overrides], [true, 1, 2, 3, 0]);
  const none = auditData({ pulls: data().pulls.filter((p) => p.merged_at === null), checkRuns: [] }, { now: NOW })[INDICATORS.projectCost];
  assert.deepEqual([none.reachedFirstMerge, none.firstMergedPr, none.prs], [false, null, 2]);
});

test('an unreadable check-run, a check-run without head_sha or a malformed PR stops the figures (no partial number)', () => {
  const d = data();
  assert.throws(() => auditData({ ...d, checkRuns: [...d.checkRuns, { output: { text: 'sin registro' } }] }), /readable record/);
  assert.throws(() => auditData({ ...d, checkRuns: d.checkRuns.map((c) => ({ output: c.output })) }), /head_sha/);
  assert.throws(() => auditData({ ...d, pulls: [{ number: 1 }] }), /malformed/);
  assert.throws(() => auditData({ ...d, pulls: [{ ...d.pulls[0], created_at: 'ayer' }] }), /not a date/);
});

test('the command: --data needs exactly one source and the flags go with --data; with a file it prints the data indicators', () => {
  for (const argv of [['--data'], ['--records', RECORDS], ['--data', '--records', RECORDS, '--repo', 'o/r'], ['--data', '--records']]) {
    assert.equal(cliAudit(argv).code, EXIT.USAGE, argv.join(' '));
  }
  const j = cliAudit(['--json', '--data', '--records', RECORDS]);
  assert.equal(j.code, EXIT.OK);
  const out = JSON.parse(j.stdout);
  for (const id of DATA_INDICATORS) assert.ok(Object.hasOwn(out, id), id);
  assert.equal(Object.hasOwn(out, INDICATORS.longFiles), false);
});

test('the command with --repo uses what was downloaded, with no local lessons or messages; a failed download is its own exit class', async () => {
  const ok = await mainAudit(['--json', '--data', '--repo', REPO_N1], async (repo) => (repo === REPO_N1 ? data() : assert.fail('wrong repo')));
  const j = JSON.parse(ok.stdout);
  assert.equal(j[INDICATORS.messages], null);
  assert.equal(j[INDICATORS.escapes].lessonsEscaped, null);
  const down = await mainAudit(['--json', '--data', '--repo', REPO_N1], async () => { throw new Error('token cannot read it'); });
  assert.equal(down.code, EXIT.GH_FAILED);
  assert.equal(JSON.parse(down.stdout).ok, false);
  assert.equal((await mainAudit(['--data'], async () => assert.fail('no repo, no download'))).code, EXIT.USAGE);
});

test('the real entry point: --data --records prints one JSON object with every data indicator', (t) => {
  const r = spawnSync(process.execPath, [SCRIPT, '--data', '--records', RECORDS, '--json'], { encoding: 'utf8', cwd: RAIZ, env: casaDeAudit(t).env });
  assert.equal(r.status, EXIT.OK, r.stderr);
  const out = JSON.parse(r.stdout);
  for (const id of DATA_INDICATORS) assert.ok(Object.hasOwn(out, id), `missing ${id}`);
});
