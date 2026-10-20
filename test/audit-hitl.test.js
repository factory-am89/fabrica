// audit --hitl (chunk 18): the residue by week and by falta, its trend, the delegable kinds and the escapes beside them.
// Logs are written here through the real writers with a fixed clock; PRs are built here for the edges. Vocabulary is imported, never retyped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { INDICATORS } from '../scripts/audit.mjs';
import { BOUND, FIX_PREFIX, MS_DAY } from '../scripts/lib/audit-data.mjs';
import { CAVEAT, DELEGABLE, DELEGATE_ANSWER, DELEGATE_QUESTION, DIRECTION, HITL_IDS, HITL_INDICATORS, TOP_CLASSES, TREND_WEEKS, hitlIndicators, humanHitl, readHitlInputs } from '../scripts/lib/audit-hitl.mjs';
import { CAMINOS, CLASES, FALTAS, ORIGENES, SIN_HORA, registrarIntervencion, rutaDeRegistroIntervenciones } from '../scripts/lib/intervention-log.mjs';
import { WHY } from '../scripts/lib/lesson-effect.mjs';
import { MIN_CASES_PER_CELL } from '../scripts/golden.mjs';
import { registrarMensaje, rutaDeMensajes } from '../scripts/lib/message-log.mjs';

const WEEK = 7 * MS_DAY;
const W0 = Date.parse('2026-03-02T00:00:00Z'); // a Monday: the latest week of most tests
const week = (k) => W0 - k * WEEK; // k weeks before W0
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const SESSION = 'sesion-uno';
const [BANG] = ORIGENES;
const [CLASE, OTHER_CLASE] = CLASES;
const [CONOCIMIENTO, VERIFICACION, ACCESO, MEMORIA] = DELEGABLE;
const NOBODY = { pulls: [], checkRuns: [] };
const NO_ESCAPED = 0;

// A temp folder with the two logs; `events` = {at: ms|null, falta, clase?}, `messages` = [ms], `raw` = lines written as they are.
function logs(t, { events = [], messages = [], raw = [], rawMessages = [] } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fabrica-hitl-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const logPath = path.join(dir, path.basename(rutaDeRegistroIntervenciones()));
  const messagesPath = path.join(dir, path.basename(rutaDeMensajes()));
  for (const e of events) registrarIntervencion({ clase: e.clase ?? CLASE, origen: e.at === null ? SIN_HORA : BANG, falta: e.falta, ruta: logPath, reloj: () => e.at });
  for (const m of messages) registrarMensaje({ sesion: SESSION, ruta: messagesPath, reloj: () => m });
  for (const l of raw) appendFileSync(logPath, `${l}\n`);
  for (const l of rawMessages) appendFileSync(messagesPath, `${l}\n`);
  return { logPath, messagesPath };
}
const measure = (t, spec, { data = NOBODY, lessonsEscaped = NO_ESCAPED } = {}) => hitlIndicators(data, { lessonsEscaped, inputs: readHitlInputs(logs(t, spec)) });
const times = (n, at, falta, clase) => Array.from({ length: n }, () => ({ at, falta, clase }));
const zeros = () => Object.fromEntries(FALTAS.map((f) => [f, 0]));
const row = (w, byFalta, extra = {}) => ({ week: day(w), total: Object.values(byFalta).reduce((a, n) => a + n, 0), noFalta: 0, byFalta: { ...zeros(), ...byFalta }, messages: 0, escapes: 0, ...extra });
const residue = (r) => r[HITL_IDS.residue];

test('the weeks start on Monday 00:00 UTC: Sunday 23:59:59 is the week before; each event is placed by falta, and an event with no time or no falta is said, not lost', (t) => {
  const r = residue(measure(t, {
    events: [
      { at: W0 - 1000, falta: CONOCIMIENTO },
      { at: W0, falta: CONOCIMIENTO },
      { at: W0 + WEEK - 1000, falta: VERIFICACION },
      { at: W0 + WEEK, falta: ACCESO },
      { at: null, falta: CONOCIMIENTO },
    ],
    messages: [W0 + 5, W0 + 6, W0 + WEEK + 5],
    raw: [JSON.stringify({ t: new Date(W0 + WEEK + 1000).toISOString(), clase: OTHER_CLASE, origen: BANG })],
  }));
  assert.deepEqual(r.weeks, [
    row(week(1), { [CONOCIMIENTO]: 1 }),
    row(W0, { [CONOCIMIENTO]: 1, [VERIFICACION]: 1 }, { messages: 2 }),
    row(W0 + WEEK, { [ACCESO]: 1 }, { total: 2, noFalta: 1, messages: 1 }),
  ]);
  assert.deepEqual([r.events.total, r.events.placed, r.events.withoutTime, r.events.legacyWithoutFalta, r.events.corrupt], [6, 5, 1, 1, []]);
  assert.deepEqual([r.byFalta[CONOCIMIENTO].total, r.byFalta[CONOCIMIENTO].placed, r.byFalta[ACCESO].total], [3, 2, 1]);
  assert.deepEqual(r.messages, { total: 3, corrupt: [], trend: r.messages.trend });
  assert.deepEqual(Object.keys(r).sort(), Object.keys({ byFalta: 0, caveats: 0, events: 0, messages: 0, weeks: 0 }).sort());
  assert.deepEqual(Object.keys(r.byFalta), FALTAS);
});

test('trend: the last TREND_WEEKS weeks against the TREND_WEEKS before, counted back from the latest week; the edges of each window are exact', (t) => {
  const r = residue(measure(t, {
    events: [
      ...times(4, W0, CONOCIMIENTO), ...times(1, week(TREND_WEEKS - 1), CONOCIMIENTO), // recent: 5 (the oldest week of the window counts)
      ...times(6, week(TREND_WEEKS), CONOCIMIENTO), ...times(1, week(TREND_WEEKS * 2 - 1), CONOCIMIENTO), // previous: 7 (both edges count)
      ...times(1, week(TREND_WEEKS * 2), CONOCIMIENTO), // one week too old: no side
      ...times(MIN_CASES_PER_CELL - 1, W0, ACCESO), ...times(9, week(TREND_WEEKS), ACCESO),
      ...times(MIN_CASES_PER_CELL, W0, VERIFICACION), ...times(MIN_CASES_PER_CELL - 1, week(TREND_WEEKS), VERIFICACION),
      ...times(6, W0, MEMORIA), ...times(5, week(TREND_WEEKS), MEMORIA),
      ...times(5, W0, FALTAS[0]), ...times(5, week(TREND_WEEKS), FALTAS[0]),
    ],
  }));
  const side = (recent, previous) => ({ weeks: TREND_WEEKS, minCases: MIN_CASES_PER_CELL, recent, previous });
  assert.deepEqual(r.byFalta[CONOCIMIENTO].trend, { ...side(5, 7), change: -2, direction: DIRECTION.down, conclusive: true, why: [] });
  assert.deepEqual(r.byFalta[MEMORIA].trend, { ...side(6, 5), change: 1, direction: DIRECTION.up, conclusive: true, why: [] });
  assert.deepEqual(r.byFalta[FALTAS[0]].trend, { ...side(5, 5), change: 0, direction: DIRECTION.flat, conclusive: true, why: [] });
  assert.deepEqual(r.byFalta[ACCESO].trend, { ...side(4, 9), change: null, direction: null, conclusive: false, why: [WHY.fewCases] });
  assert.deepEqual(r.byFalta[VERIFICACION].trend, { ...side(5, 4), change: null, direction: null, conclusive: false, why: [WHY.fewCases] });
  assert.deepEqual([r.events.trend.recent, r.events.trend.previous], [4 + 1 + 4 + 5 + 6 + 5, 6 + 1 + 9 + 4 + 5 + 5]);
});

test('the latest week is the latest of events, messages and escapes together: a later message or escape moves the windows', (t) => {
  const old = { events: times(1, week(TREND_WEEKS - 1), CONOCIMIENTO) };
  const trend = (r) => [r.byFalta[CONOCIMIENTO].trend.recent, r.byFalta[CONOCIMIENTO].trend.previous];
  assert.deepEqual(trend(residue(measure(t, old))), [1, 0]);
  assert.deepEqual(trend(residue(measure(t, { ...old, messages: [W0 + WEEK] }))), [0, 1]);
  const fix = [pair(1, W0 + WEEK)].flat();
  assert.deepEqual(trend(residue(measure(t, old, { data: { pulls: fix, checkRuns: [] } }))), [0, 1]);
});

test('no logs at all: no weeks, every trend with no cases and no conclusion (said, not hidden)', (t) => {
  const r = residue(measure(t));
  assert.deepEqual(r.weeks, []);
  assert.deepEqual(r.events, { total: 0, placed: 0, withoutTime: 0, legacyWithoutFalta: 0, trend: r.events.trend, corrupt: [] });
  for (const f of FALTAS) assert.deepEqual([r.byFalta[f].total, r.byFalta[f].placed, r.byFalta[f].trend.conclusive, r.byFalta[f].trend.why], [0, 0, false, [WHY.fewCases]]);
  assert.deepEqual([r.events.trend.recent, r.events.trend.previous, r.messages.trend.conclusive], [0, 0, false]);
});

test('an unreadable line of either log is shown with its line number and counted in the total, never skipped', (t) => {
  const r = residue(measure(t, { events: [{ at: W0, falta: ACCESO }], raw: ['not json'], messages: [W0], rawMessages: ['also not json', '{}'] }));
  assert.deepEqual([r.events.total, r.events.placed, r.events.corrupt], [2, 1, [2]]);
  assert.deepEqual([r.messages.total, r.messages.corrupt], [3, [2, 3]]);
});

test('the caveats say that messages approximate attention, have no falta, and that falta is self-declared', (t) => {
  const r = measure(t);
  assert.deepEqual(residue(r).caveats, [CAVEAT.attention, CAVEAT.messagesNotPerFalta, CAVEAT.selfDeclared]);
  assert.deepEqual(r[HITL_IDS.balance].caveats, [CAVEAT.escapesUndated]);
});

test('delegation: each delegable falta with its way out, the classes that weigh most (by count, then name) and the open question', (t) => {
  const [BIG, TIE_A, TIE_B, SMALL] = [CLASES[0], CLASES[1], CLASES[2], CLASES[3]].sort((a, b) => a.localeCompare(b));
  const d = measure(t, {
    events: [
      ...times(3, W0, CONOCIMIENTO, BIG), ...times(2, W0, CONOCIMIENTO, TIE_B), ...times(2, W0, CONOCIMIENTO, TIE_A), ...times(1, W0, CONOCIMIENTO, SMALL),
      ...times(1, W0, ACCESO, BIG),
    ],
  })[HITL_IDS.delegation];
  assert.equal(d.question, DELEGATE_QUESTION);
  assert.equal(d.answeredBy, DELEGATE_ANSWER);
  assert.deepEqual(d.types.map((x) => x.falta), DELEGABLE);
  assert.deepEqual(d.types.map((x) => x.camino), DELEGABLE.map((f) => CAMINOS[f]));
  assert.deepEqual(d.types.map((x) => x.total), [8, 0, 1, 0]);
  assert.deepEqual(d.types.map((x) => x.answer), [null, null, null, null]);
  assert.equal(TOP_CLASSES, 3);
  assert.deepEqual(d.types[0].classes, [{ clase: BIG, count: 3 }, { clase: TIE_A, count: 2 }, { clase: TIE_B, count: 2 }]);
  assert.deepEqual(d.types[1].classes, []);
  assert.deepEqual(d.types[2].classes, [{ clase: BIG, count: 1 }]);
  assert.deepEqual(Object.keys(d.types[0]), ['falta', 'camino', 'total', 'classes', 'answer']);
});

test('delegable is exactly the faltas whose way out is not a legitimate residue', () => {
  const legitimate = Object.keys(CAMINOS).filter((f) => CAMINOS[f].startsWith('residuo'));
  assert.deepEqual([...DELEGABLE].sort(), Object.keys(CAMINOS).filter((f) => !legitimate.includes(f)).sort());
  for (const f of DELEGABLE) assert.ok(FALTAS.includes(f), f);
});

// A fix PR merged at `at` that touches a file a PR merged an hour earlier (inside ESCAPE_DAYS): one escape placed in the week of `at`.
function pair(n, at) {
  const mk = (number, ref, created, merged) => ({ number, state: 'closed', created_at: new Date(created).toISOString(), merged_at: new Date(merged).toISOString(), head_ref: ref, files: [`f${n}.js`], commits: [] });
  return [mk(n, 'feat/base', at - 7200000, at - 3600000), mk(n + 1000, `${FIX_PREFIX}x`, at - 1800000, at + 3600000)];
}
const escapesAt = (...counts) => ({ pulls: counts.flatMap(([n, at], i) => Array.from({ length: n }, (_, j) => pair(i * 100 + j + 1, at)).flat()), checkRuns: [] });

test('balance: the escapes figure sits beside the verificacion trend; the imbalance is true only with both conclusive, verificacion down and escapes up', (t) => {
  const verif = (recent, previous) => ({ events: [...times(recent, W0, VERIFICACION), ...times(previous, week(TREND_WEEKS), VERIFICACION)] });
  const at = (v, e, lessonsEscaped = NO_ESCAPED) => measure(t, verif(...v), { data: escapesAt([e[0], W0], [e[1], week(TREND_WEEKS)]), lessonsEscaped })[HITL_IDS.balance];
  const bad = at([5, 7], [6, 5], 2);
  assert.equal(bad.verificacionDownEscapesUp, true);
  assert.deepEqual([bad.verificacion.direction, bad.escapesTrend.direction, bad.escapesTrend.recent, bad.escapesTrend.previous], [DIRECTION.down, DIRECTION.up, 6, 5]);
  assert.deepEqual(bad.escapes, { count: 11 + 2, rate: 13 / 22, mergedPrs: 22, fixPrs: bad.escapes.fixPrs, lessonsEscaped: 2, bound: BOUND.lower, caveat: bad.escapes.caveat });
  assert.equal(bad.escapes.fixPrs.length, 11);
  assert.equal(at([5, 7], [5, 6]).verificacionDownEscapesUp, false, 'escapes also down');
  assert.equal(at([7, 5], [6, 5]).verificacionDownEscapesUp, false, 'verificacion up');
  assert.equal(at([5, 7], [6, 6]).verificacionDownEscapesUp, false, 'escapes flat');
  assert.equal(at([4, 7], [6, 5]).verificacionDownEscapesUp, null, 'verificacion inconclusive');
  assert.equal(at([5, 7], [4, 5]).verificacionDownEscapesUp, null, 'escapes inconclusive');
  assert.deepEqual(Object.keys(bad).sort(), Object.keys({ caveats: 0, escapes: 0, escapesTrend: 0, verificacion: 0, verificacionDownEscapesUp: 0 }).sort());
});

test('escapes are placed in the week their fix PR was merged, beside the marks of that week', (t) => {
  const r = residue(measure(t, { events: [{ at: W0, falta: ACCESO }] }, { data: escapesAt([2, W0]) }));
  assert.deepEqual(r.weeks, [row(W0, { [ACCESO]: 1 }, { escapes: 2 })]);
});

test('a malformed PR or a throwing log stops the figures: no partial number', (t) => {
  assert.throws(() => hitlIndicators({ pulls: [{ number: 1 }], checkRuns: [] }, { lessonsEscaped: NO_ESCAPED, inputs: readHitlInputs(logs(t)) }), /malformed/);
  assert.throws(() => readHitlInputs({ logPath: path.join(tmpdir()) }), /EISDIR|EPERM|EACCES/);
});

test('the result has exactly the hitl ids, which are registered in INDICATORS, and the text output has one line per id', (t) => {
  const r = measure(t, { events: [{ at: W0, falta: ACCESO }] });
  assert.deepEqual(Object.keys(r), HITL_INDICATORS);
  for (const id of HITL_INDICATORS) assert.ok(Object.values(INDICATORS).includes(id), id);
  const lines = humanHitl(r).split('\n');
  assert.deepEqual(lines, HITL_INDICATORS.map((id) => `${id}: ${JSON.stringify(r[id])}`));
});
