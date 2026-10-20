// The three indicators of `audit --hitl` (chunk 18 of plans/trabajar-solos.md): what Pablo still has to do by hand, by week and by `falta`
// (what the system lacked), its trend, the delegable kinds with the classes that weigh most, and the escapes beside them.
// Signals, not gates: no figure here fails anything and none is an objective. Pablo's attention is only approximated by his messages
// (no time is measured) and a message has no `falta`, so messages are counted per week and never per falta: the caveats say it.
import { MIN_CASES_PER_CELL } from '../golden.mjs';
import { MS_DAY, escapes, readPulls } from './audit-data.mjs';
import { CAMINOS, FALTAS, contarIntervenciones } from './intervention-log.mjs';
import { WHY } from './lesson-effect.mjs';
import { contarMensajes } from './message-log.mjs';

export const HITL_IDS = Object.freeze({ residue: 'hitl-residue', delegation: 'hitl-delegation', balance: 'hitl-balance' });
export const HITL_INDICATORS = Object.freeze(Object.values(HITL_IDS));
export const CAVEAT = Object.freeze({
  attention: 'messages-approximate-pablos-attention-no-time-is-measured',
  messagesNotPerFalta: 'a-message-has-no-falta-so-messages-are-counted-per-week-only',
  selfDeclared: 'falta-is-self-declared-nobody-checks-it',
  escapesUndated: 'escaped-lessons-have-no-date-so-the-weeks-and-the-trend-count-only-fix-prs',
});
export const DIRECTION = Object.freeze({ up: 'up', down: 'down', flat: 'flat' });
// The kinds of falta that a mechanism could remove (intencion and autoridad are the legitimate residue). Each one needs its way out in CAMINOS.
export const DELEGABLE = Object.freeze(['conocimiento', 'verificacion', 'acceso', 'memoria']);
export const DELEGATE_QUESTION = '¿se puede delegar ya?';
export const DELEGATE_ANSWER = 'the agent that runs the audit answers with a PR, or with «no, porque» written in the Decisions of its PR';
export const TREND_WEEKS = 4;
export const TOP_CLASSES = 3;
const DAYS_PER_WEEK = 7;
const WEEK_MS = DAYS_PER_WEEK * MS_DAY;
const DATE_CHARS = 10;

// Monday 00:00 UTC of the week of `ms`.
function weekOf(ms) {
  const day = ms - (ms % MS_DAY);
  return day - ((new Date(day).getUTCDay() + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK) * MS_DAY;
}

// The two logs, read through their own counters (their corrupt lines are reported, not skipped): { events, messageTimes, ... }.
export function readHitlInputs({ logPath, messagesPath } = {}) {
  const events = [];
  const messageTimes = [];
  const log = contarIntervenciones({ ruta: logPath, alLeer: (e) => events.push(e) });
  const messages = contarMensajes({ ruta: messagesPath, alLeer: (m) => messageTimes.push(Date.parse(m.t)) });
  return { events, messageTimes, logTotal: log.total, logCorrupt: log.corruptas, messagesTotal: messages.total, messagesCorrupt: messages.corruptas };
}

const newRow = () => ({ total: 0, noFalta: 0, byFalta: Object.fromEntries(FALTAS.map((f) => [f, 0])), messages: 0, escapes: 0 });

// The last TREND_WEEKS weeks (counted back from the latest week with any data) against the TREND_WEEKS before them. A side under MIN_CASES_PER_CELL: no conclusion.
function trendOf(rows, anchor, count) {
  const sum = (from, to) => [...rows].filter(([ms]) => (anchor - ms) / WEEK_MS >= from && (anchor - ms) / WEEK_MS < to).reduce((a, [, r]) => a + count(r), 0);
  const recent = sum(0, TREND_WEEKS);
  const previous = sum(TREND_WEEKS, TREND_WEEKS + TREND_WEEKS);
  const conclusive = recent >= MIN_CASES_PER_CELL && previous >= MIN_CASES_PER_CELL;
  const change = recent - previous;
  const direction = change > 0 ? DIRECTION.up : change < 0 ? DIRECTION.down : DIRECTION.flat;
  return { weeks: TREND_WEEKS, minCases: MIN_CASES_PER_CELL, recent, previous, change: conclusive ? change : null, direction: conclusive ? direction : null, conclusive, why: conclusive ? [] : [WHY.fewCases] };
}

// Classes of a falta by weight (events, then name), the first TOP_CLASSES.
function topClasses(events, falta) {
  const count = new Map();
  for (const e of events.filter((x) => x.falta === falta)) count.set(e.clase, (count.get(e.clase) ?? 0) + 1);
  return [...count].map(([clase, n]) => ({ clase, count: n })).sort((a, b) => b.count - a.count || a.clase.localeCompare(b.clase)).slice(0, TOP_CLASSES);
}

// data = {pulls, checkRuns} (for the escapes); inputs = readHitlInputs(); lessonsEscaped = count of escaped lessons.
export function hitlIndicators(data, { lessonsEscaped, inputs }) {
  const prs = readPulls(data.pulls);
  const esc = escapes(prs, lessonsEscaped);
  const rows = new Map();
  const row = (ms) => rows.set(ms, rows.get(ms) ?? newRow()).get(ms);
  let withoutTime = 0;
  let legacy = 0;
  for (const e of inputs.events) {
    if (e.falta === undefined) legacy += 1;
    if (e.t === null) { withoutTime += 1; continue; }
    const r = row(weekOf(Date.parse(e.t)));
    r.total += 1;
    if (e.falta === undefined) r.noFalta += 1;
    else r.byFalta[e.falta] += 1;
  }
  for (const t of inputs.messageTimes) row(weekOf(t)).messages += 1;
  for (const n of esc.fixPrs) row(weekOf(prs.find((p) => p.number === n).merged)).escapes += 1;
  const anchor = Math.max(...rows.keys(), -Infinity);
  const weeks = [...rows].sort(([a], [b]) => a - b).map(([ms, r]) => ({ week: new Date(ms).toISOString().slice(0, DATE_CHARS), ...r }));
  const byFalta = Object.fromEntries(FALTAS.map((f) => [f, {
    total: inputs.events.filter((e) => e.falta === f).length,
    placed: [...rows.values()].reduce((a, r) => a + r.byFalta[f], 0),
    trend: trendOf(rows, anchor, (r) => r.byFalta[f]),
  }]));
  const verificacion = byFalta.verificacion.trend;
  const escapesTrend = trendOf(rows, anchor, (r) => r.escapes);
  return {
    [HITL_IDS.residue]: {
      weeks,
      byFalta,
      events: { total: inputs.logTotal, placed: inputs.events.length - withoutTime, withoutTime, legacyWithoutFalta: legacy, trend: trendOf(rows, anchor, (r) => r.total), corrupt: inputs.logCorrupt },
      messages: { total: inputs.messagesTotal, corrupt: inputs.messagesCorrupt, trend: trendOf(rows, anchor, (r) => r.messages) },
      caveats: [CAVEAT.attention, CAVEAT.messagesNotPerFalta, CAVEAT.selfDeclared],
    },
    [HITL_IDS.delegation]: {
      question: DELEGATE_QUESTION,
      answeredBy: DELEGATE_ANSWER,
      types: DELEGABLE.map((f) => ({ falta: f, camino: CAMINOS[f], total: byFalta[f].total, classes: topClasses(inputs.events, f), answer: null })),
    },
    [HITL_IDS.balance]: {
      escapes: { count: esc.count, rate: esc.rate, mergedPrs: esc.mergedPrs, fixPrs: esc.fixPrs, lessonsEscaped: esc.lessonsEscaped, bound: esc.bound, caveat: esc.caveat },
      verificacion,
      escapesTrend,
      verificacionDownEscapesUp: verificacion.conclusive && escapesTrend.conclusive ? verificacion.direction === DIRECTION.down && escapesTrend.direction === DIRECTION.up : null,
      caveats: [CAVEAT.escapesUndated],
    },
  };
}

export const humanHitl = (r) => HITL_INDICATORS.map((id) => `${id}: ${JSON.stringify(r[id])}`).join('\n');
