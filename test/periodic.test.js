// The step «periodico» of the startup (scripts/lib/periodic.mjs): the lines it says, the limit of MANUAL_STALE_DAYS, what it keeps, the real
// measure (a process of `audit` that records nothing), and that a part that fails is said while the others still run. What it keeps in
// ~/.fabrica is in test/periodic-state.test.js; the real entry (al-arrancar.mjs --solo) is in test/al-arrancar.test.js. Throwaway homes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { arrancar } from '../scripts/al-arrancar.mjs';
import { MANUAL_STALE_DAYS, changesOf, githubModes, indicatorLines, measureLocal, staleManualReaders } from '../scripts/lib/periodic.mjs';
import { SNAPSHOT_FILE, STEP_NAME, judgeDatumPath, readSnapshot, recordJudgeDatum, snapshotPath } from '../scripts/lib/periodic-state.mjs';
import { DEBT_KIND, PASS_MODE, recordPass } from '../scripts/lib/goals-debt.mjs';
import { MS_DAY } from '../scripts/lib/audit-data.mjs';
import { casaDeAudit } from './apoyo/audit-casa.mjs';
import { JUEZ, NOW, RAIZ, correr, fallo, judge, juez, manual, medida, paso } from './apoyo/periodico.mjs';

test('indicatorLines: one entry per indicator with the text after its first «: », and the indented detail lines are not entries', () => {
  assert.deepEqual(indicatorLines('a: 1 {"x":"y: z"}\n  detalle: no\nb-c: dos: tres\r\n\nsin dos puntos'), { a: '1 {"x":"y: z"}', 'b-c': 'dos: tres' });
});

test('changesOf: a changed text, a new indicator and one no longer measured, sorted by id; the same text is not a change', () => {
  assert.deepEqual(changesOf({ c: '3', a: '1', b: '2' }, { d: '4', b: '9', a: '1' }), [
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
  const items = [manual('viejo', PASS_MODE.data), manual('viejo', PASS_MODE.data), { ...manual('hueco', PASS_MODE.data), kind: DEBT_KIND.hole }, { ...manual('falta', PASS_MODE.data), kind: DEBT_KIND.inconclusive }];
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
  assert.ok(correr(paso(casa, medida('uno: 1\ndos: 5'))).includes('periodico: cambió tres: 7 -> (ya no se mide)'));
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

test('the step: the judge debt is the last datum of audit --data (no network), said with its age; none left, none owed and no good pass are each said', (t) => {
  const casa = casaDeAudit(t);
  assert.deepEqual(juez(correr(paso(casa, medida('a: 1')))), [`${JUEZ}: \`audit --${PASS_MODE.data}\` nunca dejó dato; no se sabe cuántos cambios del juez esperan pasada del corpus`]);
  const dato = (j, ago) => recordJudgeDatum(judgeDatumPath(casa.file), j, NOW - ago);
  dato(judge(), 2 * MS_DAY);
  assert.deepEqual(juez(correr(paso(casa, medida('a: 1')))), [`${JUEZ}: 2 cambios del juez sin pasada del corpus, el primero 2026-10-01T00:00:00.000Z (última pasada buena en abc123; dato de \`audit --${PASS_MODE.data}\` de hace 2.0 días); la pasada la lanza Pablo`]);
  dato(judge({ count: 0, shas: [], firstAt: null }), MS_DAY / 2);
  assert.deepEqual(juez(correr(paso(casa, medida('a: 1')))), [`${JUEZ}: 0 cambios del juez sin pasada del corpus (última pasada buena en abc123; dato de \`audit --${PASS_MODE.data}\` de hace 0.5 días)`]);
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
  assert.match(fallo(paso(casa, medida('a: 1'))).error, /lectores manuales: .*is not JSON; deuda de GitHub: .*is not JSON/);
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

test('measureLocal: the real audit as a process (text, hygiene count, static debt), and it records no pass in the home it runs in', (t) => {
  const casa = casaDeAudit(t);
  const m = measureLocal(RAIZ, casa.env);
  assert.ok(Number.isInteger(m.hygiene) && Array.isArray(m.items));
  const lines = indicatorLines(m.text);
  assert.ok(Object.keys(lines).length > 1 && lines.hygiene !== undefined, m.text);
  assert.equal(existsSync(path.dirname(casa.file)), false, 'no ~/.fabrica was created');
});

test('measureLocal: a folder where audit does not run throws with the exit code and the reason', (t) => {
  const vacia = mkdtempSync(path.join(tmpdir(), 'periodico-vacia-'));
  t.after(() => rmSync(vacia, { recursive: true, force: true }));
  assert.throws(() => measureLocal(vacia, casaDeAudit(t).env), /^Error: audit local exited 1: .*audit\.mjs/s);
});

test('the import cycle (goals-debt -> triggers -> al-arrancar -> periodic -> ...) loads whichever file a process starts from', () => {
  const entradas = ['scripts/lib/periodic.mjs', 'scripts/lib/periodic-state.mjs', 'scripts/lib/goals-debt.mjs', 'scripts/lib/triggers.mjs', 'scripts/lib/audit-cli.mjs', 'scripts/al-arrancar.mjs', 'scripts/audit.mjs', 'test/apoyo/audit-casa.mjs'];
  for (const rel of entradas) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(path.join(RAIZ, rel)).href)})`], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${rel}: ${r.stderr}`);
  }
});
