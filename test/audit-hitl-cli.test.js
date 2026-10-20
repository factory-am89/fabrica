// audit --hitl on the command line: its flags, its text and JSON output, and the real entry point. The figures are in test/audit-hitl.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDICATORS, auditData, auditHitl, cliAudit } from '../scripts/audit.mjs';
import { HITL_IDS, HITL_INDICATORS } from '../scripts/lib/audit-hitl.mjs';
import { EXIT } from '../scripts/lib/exit.mjs';
import { CLASES, FALTAS, ORIGENES, registrarIntervencion } from '../scripts/lib/intervention-log.mjs';
import { registrarMensaje } from '../scripts/lib/message-log.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'audit.mjs');
const RECORDS = path.join(RAIZ, 'test', 'fixtures', 'audit', 'records.json');
const MONDAY = Date.parse('2026-03-02T00:00:00Z');
const [CLASE] = CLASES;
const [BANG] = ORIGENES;
const [FALTA] = FALTAS;
const SESSION = 'sesion-uno';

// A temp folder with one event and one message, both in the week of MONDAY.
function logs(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fabrica-hitl-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const logPath = path.join(dir, 'a.jsonl');
  const messagesPath = path.join(dir, 'b.jsonl');
  registrarIntervencion({ clase: CLASE, origen: BANG, falta: FALTA, ruta: logPath, reloj: () => MONDAY });
  registrarMensaje({ sesion: SESSION, ruta: messagesPath, reloj: () => MONDAY });
  return { logPath, messagesPath };
}
const weekRow = (week, over) => ({ week, total: 0, noFalta: 0, byFalta: Object.fromEntries(FALTAS.map((f) => [f, 0])), messages: 0, escapes: 0, ...over });

test('the command: --hitl with a records file prints the hitl indicators, from the given logs, with the escaped lessons of the root', (t) => {
  const { logPath, messagesPath } = logs(t);
  const argv = ['--hitl', '--records', RECORDS, '--log', logPath, '--messages', messagesPath];
  const j = cliAudit(['--json', ...argv]);
  assert.equal(j.code, EXIT.OK, j.stderr);
  const out = JSON.parse(j.stdout);
  assert.equal(out.ok, true);
  for (const id of HITL_INDICATORS) assert.ok(Object.hasOwn(out, id), id);
  assert.equal(Object.hasOwn(out, INDICATORS.longFiles), false);
  // the fixture's one escape (PR 3, a fix merged on Friday 2026-01-02) sits in the week of Monday 2025-12-29
  assert.deepEqual(out[HITL_IDS.residue].weeks, [weekRow('2025-12-29', { escapes: 1 }), weekRow('2026-03-02', { total: 1, byFalta: { ...weekRow('', {}).byFalta, [FALTA]: 1 }, messages: 1 })]);
  const expected = auditData(JSON.parse(readFileSync(RECORDS, 'utf8')), { root: RAIZ, messagesPath })[INDICATORS.escapes];
  assert.equal(out[HITL_IDS.balance].escapes.lessonsEscaped, expected.lessonsEscaped);
  assert.deepEqual(out[HITL_IDS.balance].escapes.fixPrs, expected.fixPrs);
  const text = cliAudit(argv);
  assert.equal(text.code, EXIT.OK);
  assert.deepEqual(text.stdout.split('\n').map((l) => l.split(':')[0]).filter(Boolean), HITL_INDICATORS);
  assert.deepEqual(JSON.parse(JSON.stringify(auditHitl(JSON.parse(readFileSync(RECORDS, 'utf8')), { root: RAIZ, logPath, messagesPath }))), JSON.parse(JSON.stringify(Object.fromEntries(HITL_INDICATORS.map((id) => [id, out[id]])))));
});

test('the command: --hitl needs --records and no --repo; it is not --data; --log and --messages go with --hitl and each needs a value', () => {
  for (const argv of [['--hitl'], ['--hitl', '--records', RECORDS, '--repo', 'o/r'], ['--hitl', '--repo', 'o/r'], ['--hitl', '--data', '--records', RECORDS], ['--data', '--records', RECORDS, '--log', 'x'], ['--data', '--records', RECORDS, '--messages', 'x'], ['--hitl', '--records', RECORDS, '--log'], ['--hitl', '--records', RECORDS, '--messages']]) {
    assert.equal(cliAudit(argv).code, EXIT.USAGE, argv.join(' '));
  }
});

test('the real entry point: --hitl --records prints one JSON object with every hitl indicator', (t) => {
  const { logPath, messagesPath } = logs(t);
  const r = spawnSync(process.execPath, [SCRIPT, '--hitl', '--records', RECORDS, '--log', logPath, '--messages', messagesPath, '--json'], { encoding: 'utf8', cwd: RAIZ });
  assert.equal(r.status, EXIT.OK, r.stderr);
  const out = JSON.parse(r.stdout);
  for (const id of HITL_INDICATORS) assert.ok(Object.hasOwn(out, id), `missing ${id}`);
});
