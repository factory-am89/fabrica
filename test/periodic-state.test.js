// What the startup step keeps in ~/.fabrica (scripts/lib/periodic-state.mjs) and that `audit --data` leaves the judge debt the step reads,
// while `audit --no-pass`, a local run, a --hitl run and a run without judge data leave nothing. Every test uses a throwaway home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cliAudit } from '../scripts/audit.mjs';
import { JUDGE_FILE, SNAPSHOT_FILE, judgeDatumPath, readJudgeDatum, readSnapshot, recordJudgeDatum, snapshotPath, writeSnapshot } from '../scripts/lib/periodic-state.mjs';
import { NO_PASS_FLAG } from '../scripts/lib/audit-cli.mjs';
import { passesPath } from '../scripts/lib/goals-debt.mjs';
import { DATA_IDS, MS_DAY } from '../scripts/lib/audit-data.mjs';
import { casaDeAudit } from './apoyo/audit-casa.mjs';
import { NOW, RAIZ, correr, judge, juez, medida, paso } from './apoyo/periodico.mjs';

const RECORDS = path.join(RAIZ, 'test', 'fixtures', 'audit', 'records.json');

test('the two files live beside the passes file; only a computed judge debt is kept', (t) => {
  const casa = casaDeAudit(t);
  assert.equal(judgeDatumPath(casa.file), path.join(path.dirname(passesPath(() => casa.casa)), JUDGE_FILE));
  assert.equal(snapshotPath(casa.file), path.join(path.dirname(casa.file), SNAPSHOT_FILE));
  assert.equal(recordJudgeDatum(judgeDatumPath(casa.file), { computed: false }, NOW), false);
  assert.equal(recordJudgeDatum(judgeDatumPath(casa.file), undefined, NOW), false);
  assert.equal(readJudgeDatum(judgeDatumPath(casa.file)), null);
  assert.equal(recordJudgeDatum(judgeDatumPath(casa.file), judge(), NOW), true);
  assert.deepEqual(readJudgeDatum(judgeDatumPath(casa.file)), { t: new Date(NOW).toISOString(), judge: judge() });
  assert.equal(readSnapshot(snapshotPath(casa.file)), null);
});

test('a file that is there and wrong throws with its reason, for each shape', (t) => {
  const casa = casaDeAudit(t);
  const j = judgeDatumPath(casa.file);
  const s = snapshotPath(casa.file);
  const t0 = new Date(NOW).toISOString();
  recordJudgeDatum(j, judge(), NOW);
  const bad = (file, read, value, reason) => {
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
    assert.throws(() => read(file), reason);
  };
  bad(j, readJudgeDatum, 'no json', /is not JSON/);
  bad(j, readJudgeDatum, { judge: judge() }, /it needs a time \(t\)/);
  bad(j, readJudgeDatum, { t: 'ayer', judge: judge() }, /it needs a time \(t\)/);
  bad(j, readJudgeDatum, { t: t0, judge: judge({ computed: false }) }, /judge\.computed must be true/);
  bad(j, readJudgeDatum, { t: t0, judge: judge({ count: '2' }) }, /judge needs a count and a list of shas/);
  bad(j, readJudgeDatum, { t: t0, judge: judge({ shas: 'x' }) }, /judge needs a count and a list of shas/);
  bad(s, readSnapshot, { t: t0 }, /lines must be an object of texts/);
  bad(s, readSnapshot, { t: t0, lines: null }, /lines must be an object of texts/);
  bad(s, readSnapshot, { t: t0, lines: [] }, /lines must be an object of texts/);
  bad(s, readSnapshot, { t: t0, lines: { a: 1 } }, /lines must be an object of texts/);
  writeSnapshot(s, NOW, { a: '1' });
  assert.deepEqual(readSnapshot(s), { t: t0, lines: { a: '1' } });
});

test('audit --data leaves the judge debt the step reads; a local run, a --hitl run, a run without judge data and a --no-pass run leave none', (t) => {
  const casa = casaDeAudit(t);
  const passes = { file: casa.file, now: NOW };
  assert.equal(cliAudit(['--json'], { passes }).code, 0);
  const nada = path.join(casa.casa, 'no-existe');
  assert.equal(cliAudit(['--json', '--hitl', '--records', RECORDS, '--log', nada, '--messages', nada], { passes }).code, 0);
  assert.equal(existsSync(judgeDatumPath(casa.file)), false);
  const sinJuez = path.join(casa.casa, 'sin-juez.json');
  const records = JSON.parse(readFileSync(RECORDS, 'utf8'));
  delete records.judge;
  writeFileSync(sinJuez, JSON.stringify(records));
  assert.equal(cliAudit(['--json', '--data', '--records', sinJuez], { passes }).code, 0);
  assert.equal(existsSync(judgeDatumPath(casa.file)), false, 'a run that could not compute the debt leaves no datum');
  const sinPasada = path.join(casa.casa, 'sin-pasada');
  const quieto = { file: path.join(sinPasada, path.basename(casa.file)), now: NOW };
  assert.equal(cliAudit(['--json', NO_PASS_FLAG, '--data', '--records', RECORDS], { passes: quieto }).code, 0);
  assert.equal(existsSync(sinPasada), false, `${NO_PASS_FLAG} records neither a pass nor the judge datum`);
  const r = cliAudit(['--json', '--data', '--records', RECORDS], { passes });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(readJudgeDatum(judgeDatumPath(casa.file)), { t: new Date(NOW).toISOString(), judge: JSON.parse(r.stdout)[DATA_IDS.judgeDebt] });
  assert.match(juez(correr(paso(casa, medida('a: 1'))))[0], /^periodico: deuda del juez: 2 cambios del juez sin pasada del corpus, el primero 2026-02-02T10:00:00.000Z /);
  assert.equal(cliAudit(['--json', '--data', '--records', RECORDS], { passes: { file: casa.file, now: NOW + MS_DAY } }).code, 0);
  assert.equal(readJudgeDatum(judgeDatumPath(casa.file)).t, new Date(NOW + MS_DAY).toISOString(), 'the newest run replaces the datum');
});
