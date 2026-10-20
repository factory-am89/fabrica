// The step «periodico» of the startup (scripts/lib/periodic.mjs) and what it remembers (scripts/lib/periodic-state.mjs): the lines it says, the
// limit of MANUAL_STALE_DAYS, what it keeps in ~/.fabrica, that a part that fails is said and the others still run, and that `audit --data`
// leaves the judge debt the step reads. The run through the real entry (scripts/al-arrancar.mjs --solo) is in test/al-arrancar.test.js.
// Every test uses a throwaway home (casaDeAudit): none writes in the real ~/.fabrica, touches the main folder or uses the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDICATORS, cliAudit } from '../scripts/audit.mjs';
import { arrancar } from '../scripts/al-arrancar.mjs';
import { MANUAL_STALE_DAYS, STEP_NAME, changesOf, githubModes, indicatorLines, pasoPeriodico, staleManualReaders } from '../scripts/lib/periodic.mjs';
import { JUDGE_FILE, SNAPSHOT_FILE, judgeDatumPath, readJudgeDatum, readSnapshot, recordJudgeDatum, snapshotPath, writeSnapshot } from '../scripts/lib/periodic-state.mjs';
import { DEBT_KIND, PASS_MODE, passesPath, recordPass } from '../scripts/lib/goals-debt.mjs';
import { DATA_IDS, MS_DAY } from '../scripts/lib/audit-data.mjs';
import { casaDeAudit } from './apoyo/audit-casa.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECORDS = path.join(RAIZ, 'test', 'fixtures', 'audit', 'records.json');
const NOW = Date.parse('2026-10-20T10:00:00Z');
const manual = (ref, mode = PASS_MODE.local) => ({ kind: DEBT_KIND.manualReader, ref, goals: ['O1'], mode, detail: null });

// A fake local audit: its debt items and its text; the step reads the hygiene total and the first line of every indicator.
const medida = (text, items = [], total = 3) => ({ [INDICATORS.hygiene]: { total }, [INDICATORS.goalsDebt]: { items }, text });
const paso = (casa, result, extra = {}) => pasoPeriodico({ raiz: RAIZ, reloj: () => NOW, casa: () => casa.casa, medir: () => result, humano: (r) => r.text, ...extra });
const fallo = (p) => {
  const lineas = [];
  let error = null;
  try { p.ejecutar((l) => lineas.push(l)); } catch (e) { error = e.message; }
  return { lineas, error };
};
const correr = (p) => {
  const r = fallo(p);
  assert.equal(r.error, null);
  return r.lineas;
};

test('indicatorLines: one entry per indicator with the text after its first «: », and the indented detail lines are not entries', () => {
  assert.deepEqual(indicatorLines('a: 1 {"x":"y: z"}\n  detalle: no\nb-c: dos: tres\n\nsin dos puntos'), { a: '1 {"x":"y: z"}', 'b-c': 'dos: tres' });
});

test('changesOf: a changed text, a new indicator and one no longer measured, sorted by id; the same text is not a change', () => {
  assert.deepEqual(changesOf({ a: '1', b: '2', c: '3' }, { a: '1', b: '9', d: '4' }), [
    { id: 'b', before: '2', now: '9' },
    { id: 'c', before: '3', now: null },
    { id: 'd', before: null, now: '4' },
  ]);
  assert.deepEqual(changesOf({ a: '1' }, { a: '1' }), []);
});

test('staleManualReaders: more than MANUAL_STALE_DAYS (exactly that is not stale), never passed is stale, each reader once, only manual readers, by the mode of the item', () => {
  const limit = MANUAL_STALE_DAYS * MS_DAY;
  const passes = { [PASS_MODE.local]: NOW - limit, [PASS_MODE.data]: NOW - limit - 1 };
  assert.deepEqual(staleManualReaders([manual('exacto')], passes, NOW), []);
  assert.deepEqual(staleManualReaders([manual('pasado', PASS_MODE.data)], passes, NOW), [{ ref: 'pasado', mode: PASS_MODE.data, last: NOW - limit - 1 }]);
  assert.deepEqual(staleManualReaders([manual('nunca', PASS_MODE.hitl)], passes, NOW), [{ ref: 'nunca', mode: PASS_MODE.hitl, last: null }]);
  const items = [manual('viejo', PASS_MODE.data), manual('viejo', PASS_MODE.data), { ...manual('hueco'), kind: DEBT_KIND.hole }, { ...manual('falta'), kind: DEBT_KIND.inconclusive }];
  assert.deepEqual(staleManualReaders(items, passes, NOW).map((s) => s.ref), ['viejo']);
});

test('the step: the first run measures and keeps the lines, the second says nothing changed, the third names each change', (t) => {
  const casa = casaDeAudit(t);
  const first = correr(paso(casa, medida('uno: 1\n  detalle: x\ndos: 2')));
  assert.deepEqual(first.slice(0, 2), ['periodico: 2 indicadores locales medidos (sin red); higiene: 3 candidatos', 'periodico: primera medida en este PC; no hay medida anterior con la que comparar']);
  assert.deepEqual(readSnapshot(snapshotPath(casa.file)), { t: new Date(NOW).toISOString(), lines: { uno: '1', dos: '2' } });
  const second = correr(paso(casa, medida('uno: 1\ndos: 2'), { reloj: () => NOW + MS_DAY }));
  assert.deepEqual(second.slice(0, 2), ['periodico: 2 indicadores locales medidos (sin red); higiene: 3 candidatos', `periodico: nada cambió desde la medida anterior (${new Date(NOW).toISOString()})`]);
  const third = correr(paso(casa, medida('uno: 1\ndos: 5\ntres: 7', [], 4)));
  assert.deepEqual(third.slice(0, 3), ['periodico: 3 indicadores locales medidos (sin red); higiene: 4 candidatos', 'periodico: cambió dos: 2 -> 5', 'periodico: cambió tres: (no existía) -> 7']);
  assert.equal(third.some((l) => l.includes('cambió uno')), false);
  const fourth = correr(paso(casa, medida('uno: 1\ndos: 5')));
  assert.ok(fourth.includes('periodico: cambió tres: 7 -> (ya no se mide)'));
});

test('the step: a manual reader without a pass, or with one older than the limit, is listed with its days; a recent one is not', (t) => {
  const casa = casaDeAudit(t);
  recordPass(casa.file, PASS_MODE.data, NOW - MANUAL_STALE_DAYS * MS_DAY - MS_DAY / 2);
  recordPass(casa.file, PASS_MODE.local, NOW - MS_DAY);
  const items = [manual('reciente'), manual('viejo', PASS_MODE.data), manual('nunca', PASS_MODE.hitl)];
  const lineas = correr(paso(casa, medida('a: 1', items)));
  assert.ok(lineas.includes(`periodico: lector manual «viejo» lleva 7.5 días sin correr (más de ${MANUAL_STALE_DAYS}; pasada ${PASS_MODE.data} de audit)`));
  assert.ok(lineas.includes(`periodico: lector manual «nunca» nunca corrió (ninguna pasada ${PASS_MODE.hitl} de audit apuntada)`));
  assert.equal(lineas.some((l) => l.includes('reciente')), false);
});

test('the step: the GitHub part is listed as debt (never run at startup) with the days since its last pass, or none', (t) => {
  const casa = casaDeAudit(t);
  assert.deepEqual(githubModes(), [PASS_MODE.data, PASS_MODE.hitl]);
  const debt = (lineas) => lineas.filter((l) => l.includes('no corre al arrancar'));
  assert.deepEqual(debt(correr(paso(casa, medida('a: 1')))), githubModes().map((m) => `periodico: deuda: \`audit --${m}\` no corre al arrancar (pide token y red); ninguna pasada apuntada`));
  recordPass(casa.file, PASS_MODE.data, NOW - 3.5 * MS_DAY);
  recordPass(casa.file, PASS_MODE.hitl, NOW - 2 * MS_DAY);
  recordPass(casa.file, PASS_MODE.local, NOW - 9 * MS_DAY);
  assert.deepEqual(debt(correr(paso(casa, medida('a: 1')))), [
    `periodico: deuda: \`audit --${PASS_MODE.data}\` no corre al arrancar (pide token y red); última pasada hace 3.5 días`,
    `periodico: deuda: \`audit --${PASS_MODE.hitl}\` no corre al arrancar (pide token y red); última pasada hace 2.0 días`,
  ]);
});

const judge = (extra = {}) => ({ computed: true, lastPassedSha: 'abc123', count: 2, shas: ['s1', 's2'], firstAt: '2026-10-01T00:00:00.000Z', ...extra });
const JUEZ = 'periodico: deuda del juez';
const juez = (lineas) => lineas.filter((l) => l.startsWith(JUEZ));

test('the step: the judge debt is the last datum of audit --data (no network), said with its age; none left, none owed and no good pass are each said', (t) => {
  const casa = casaDeAudit(t);
  assert.deepEqual(juez(correr(paso(casa, medida('a: 1')))), [`periodico: deuda del juez: \`audit --${PASS_MODE.data}\` nunca dejó dato; no se sabe cuántos cambios del juez esperan pasada del corpus`]);
  const dato = (j, ago) => recordJudgeDatum(judgeDatumPath(casa.file), j, NOW - ago);
  dato(judge(), 2 * MS_DAY);
  assert.deepEqual(juez(correr(paso(casa, medida('a: 1')))), [`periodico: deuda del juez: 2 cambios del juez sin pasada del corpus, el primero 2026-10-01T00:00:00.000Z (última pasada buena en abc123; dato de \`audit --${PASS_MODE.data}\` de hace 2.0 días); la pasada la lanza Pablo`]);
  dato(judge({ count: 0, shas: [], firstAt: null }), MS_DAY / 2);
  assert.deepEqual(juez(correr(paso(casa, medida('a: 1')))), [`periodico: deuda del juez: 0 cambios del juez sin pasada del corpus (última pasada buena en abc123; dato de \`audit --${PASS_MODE.data}\` de hace 0.5 días)`]);
  dato(judge({ lastPassedSha: null }), 0);
  assert.match(juez(correr(paso(casa, medida('a: 1'))))[0], /el primero 2026-10-01T00:00:00.000Z \(ninguna pasada buena del corpus; dato de .* de hace 0.0 días\)/);
});

test('a part that fails is said and does not stop the others: no measure, a broken snapshot, broken passes, a broken judge datum', (t) => {
  const casa = casaDeAudit(t);
  const sinMedida = fallo(paso(casa, null, { medir: () => { throw new Error('boom'); } }));
  assert.equal(sinMedida.error, 'medida local: boom');
  assert.equal(sinMedida.lineas.length, githubModes().length + 1, 'the GitHub and judge debt are still said');
  mkdirSync(path.dirname(casa.file), { recursive: true });
  writeFileSync(snapshotPath(casa.file), 'no es json');
  const roto = fallo(paso(casa, medida('a: 1', [manual('nunca')])));
  assert.match(roto.error, /^lo que cambió: .*periodic-last\.json is not JSON$/);
  assert.ok(roto.lineas.some((l) => l.includes('lector manual «nunca»')), 'the manual readers part still ran');
  assert.ok(roto.lineas.some((l) => l.startsWith(JUEZ)));
  writeFileSync(casa.file, 'x\n');
  const pasadas = fallo(paso(casa, medida('a: 1')));
  assert.match(pasadas.error, /lectores manuales: .*is not JSON; deuda de GitHub: .*is not JSON/);
  writeFileSync(judgeDatumPath(casa.file), '{}');
  assert.match(fallo(paso(casa, medida('a: 1'))).error, /deuda del juez: .*judge-debt\.json: it needs a time \(t\)$/);
  const lista = [];
  assert.equal(arrancar([paso(casa, medida('a: 1')), { nombre: 'despues', ejecutar: (e) => e('sigue') }], (l) => lista.push(l)), 1);
  assert.match(lista[0], new RegExp(`^FÁBRICA AL ARRANCAR: FALLÓ el paso «${STEP_NAME}»: `));
  assert.ok(lista.includes('sigue'));
});

test('the step never records a pass of audit: the days cannot reset by opening a session', (t) => {
  const casa = casaDeAudit(t);
  correr(paso(casa, medida('a: 1')));
  assert.equal(existsSync(casa.file), false);
  assert.deepEqual(readdirSync(path.dirname(casa.file)), [SNAPSHOT_FILE]);
});

test('periodic-state: the two files live beside the passes file; only a computed judge debt is kept', (t) => {
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

test('periodic-state: a file that is there and wrong throws with its reason, for each shape', (t) => {
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
  bad(s, readSnapshot, { t: t0, lines: [] }, /lines must be an object of texts/);
  bad(s, readSnapshot, { t: t0, lines: { a: 1 } }, /lines must be an object of texts/);
  writeSnapshot(s, NOW, { a: '1' });
  assert.deepEqual(readSnapshot(s), { t: t0, lines: { a: '1' } });
});

test('audit --data leaves the judge debt the step reads; a local run, a --hitl run and a run without judge data leave none', (t) => {
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
  const r = cliAudit(['--json', '--data', '--records', RECORDS], { passes });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(readJudgeDatum(judgeDatumPath(casa.file)), { t: new Date(NOW).toISOString(), judge: JSON.parse(r.stdout)[DATA_IDS.judgeDebt] });
  const lineas = juez(correr(paso(casa, medida('a: 1'))));
  assert.match(lineas[0], /^periodico: deuda del juez: 2 cambios del juez sin pasada del corpus, el primero 2026-02-02T10:00:00.000Z /);
  assert.equal(cliAudit(['--json', '--data', '--records', RECORDS], { passes: { file: casa.file, now: NOW + MS_DAY } }).code, 0);
  assert.equal(readJudgeDatum(judgeDatumPath(casa.file)).t, new Date(NOW + MS_DAY).toISOString(), 'the newest run replaces the datum');
});
