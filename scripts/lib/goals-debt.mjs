// What `audit` owes about the goals (chunk 22 of plans/trabajar-solos.md): the goals with a hole, the indicators that cannot conclude and
// the readers that only fire when somebody opens them, each with the days since the pass that could see it last ran. Signals, not gates.
// Nothing here is stored but the time of each pass (one line per pass in ~/.fabrica/audit-passes.jsonl): the trigger of a reader is computed
// by `triggerOf` and «no concluyente» is read from the cases of the indicator, so neither can go stale (principle 4).
// «Nobody opens it» is said as a number: a debt never claims that something runs.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { MS_DAY } from './audit-data.mjs';
import { rutaDeRegistroGh } from './gh-log.mjs';
import { HOLE, KEY, LIST } from './goals-shape.mjs';
import { anexarLinea } from './op-log.mjs';
import { TRIGGER, triggerOf } from './triggers.mjs';

export const DEBT_ID = 'goals-debt';
// The three ways to run `audit`; each pass is recorded under its own.
export const PASS_MODE = Object.freeze({ local: 'local', data: 'data', hitl: 'hitl' });
export const DEBT_KIND = Object.freeze({ hole: 'hole', manualReader: 'manual-reader', inconclusive: 'inconclusive' });
export const PASSES_FILE = 'audit-passes.jsonl';
export const NEVER = 'never passed';

// Beside the other logs of the Factory (the folder of the gh calls log).
export const passesPath = (casa = homedir) => join(dirname(rutaDeRegistroGh(casa)), PASSES_FILE);

const row = (kind, ref, goals, mode, detail) => ({ kind, ref, goals, mode, detail });

// The debt that needs only goals.json and the wiring: a goal with a hole and a reader that fires only by hand (both seen by the local pass).
export function staticDebt(registry, root) {
  const items = [];
  for (const g of registry[LIST.goals]) {
    if (g[KEY.indicators].includes(HOLE)) items.push(row(DEBT_KIND.hole, g[KEY.id], [g[KEY.id]], PASS_MODE.local, { reason: g[KEY.holeReason] }));
    for (const reader of g[KEY.readers]) {
      if (triggerOf(reader, root) === TRIGGER.MANUAL) items.push(row(DEBT_KIND.manualReader, reader, [g[KEY.id]], PASS_MODE.local, null));
    }
  }
  return items;
}

// Every node of `value` that says `conclusive: false`, with its reasons (`why`).
function inconclusiveNodes(value, out = []) {
  if (value === null || typeof value !== 'object') return out;
  if (value.conclusive === false) out.push(value);
  for (const v of Object.values(value)) inconclusiveNodes(v, out);
  return out;
}

// The indicators of `result` (one value per id) that hold at least one case that cannot conclude; `mode` is the pass that measured them.
export function inconclusiveDebt(result, registry, mode) {
  const items = [];
  for (const [id, value] of Object.entries(result).filter(([k]) => k !== DEBT_ID).sort(([a], [b]) => a.localeCompare(b))) {
    const nodes = inconclusiveNodes(value);
    if (nodes.length === 0) continue;
    const goals = registry[LIST.goals].filter((g) => g[KEY.indicators].includes(id)).map((g) => g[KEY.id]);
    const why = [...new Set(nodes.flatMap((n) => n.why ?? []))].sort();
    items.push(row(DEBT_KIND.inconclusive, id, goals, mode, { count: nodes.length, why }));
  }
  return items;
}

// { local: ms, data: ms, hitl: ms } of the last pass of each mode (a mode never passed is missing). No file is no pass; a broken line throws.
export function readPasses(file) {
  if (!existsSync(file)) return {};
  const last = {};
  readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').forEach((line, i) => {
    let entry;
    try { entry = JSON.parse(line); } catch (e) { throw new Error(`${file} line ${i + 1} is not JSON`, { cause: e }); }
    const t = Date.parse(entry?.t);
    if (!Object.values(PASS_MODE).includes(entry?.mode) || Number.isNaN(t)) throw new Error(`${file} line ${i + 1}: a pass needs a time (t) and a mode`);
    last[entry.mode] = Math.max(last[entry.mode] ?? t, t);
  });
  return last;
}

export const recordPass = (file, mode, now) => anexarLinea(file, { t: new Date(now).toISOString(), mode });

// Each item with the whole days since the last pass of its mode (null: that mode never passed).
export const withDays = (items, passes, now) => items.map((it) => ({ ...it, days: passes[it.mode] === undefined ? null : Math.floor((now - passes[it.mode]) / MS_DAY) }));

export const debtOf = (items) => ({ count: items.length, items });

// `result` of a pass of `mode` -> the same result with the debt (dated by the passes before this one), and this pass recorded after.
export function stampPass(result, mode, { registry, root, file, now }) {
  const items = withDays([...staticDebt(registry, root), ...inconclusiveDebt(result, registry, mode)], readPasses(file), now);
  recordPass(file, mode, now);
  return { ...result, [DEBT_ID]: debtOf(items) };
}

const daysText = (it) => (it.days === undefined ? '' : it.days === null ? ` - ${NEVER}` : ` - ${it.days} days since the last ${it.mode} pass`);
// The lines of the text output.
export function humanDebt(debt) {
  const lines = debt.items.map((it) => `  ${it.kind}: ${it.ref} (${it.goals.join(', ')})${it.detail === null ? '' : ` ${JSON.stringify(it.detail)}`}${daysText(it)}`);
  return [`${DEBT_ID}: ${debt.count}`, ...lines];
}
