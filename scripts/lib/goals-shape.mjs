// The shape of goals.json: its file name, the three lists, the keys of a record of each, the closed vocabularies and the checks that need
// nothing but the file (keys, types, repeated ids, the valves). What needs the repo (references, readers, standards) is in goals.mjs.
// Faults are returned, never swallowed (principle 3); a file that cannot be read throws.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BASE_HOLE, OTHER } from './entities.mjs';
import { CHECKED_BY } from './questions.mjs';

export const GOALS_FILE = 'goals.json';

export const GOAL_FAULTS = Object.freeze(
  Object.fromEntries([
    'GOAL_BAD_FILE',
    'GOAL_MISSING_KEY',
    'GOAL_UNKNOWN_KEY',
    'GOAL_DUPLICATE_ID',
    'GOAL_BAD_VALUE',
    'GOAL_BAD_CHECK',
    'GOAL_BAD_HUECO',
    'GOAL_BAD_BASE',
    'GOAL_UNKNOWN_INDICATOR',
    'GOAL_UNKNOWN_REF',
    'GOAL_UNKNOWN_PRINCIPLE',
    'GOAL_MIRROR',
    'GOAL_INVARIANT_LOOSE',
    'GOAL_QUESTION_NO_ROW',
    'GOAL_ROW_NO_QUESTION',
    'GOAL_READER_MISSING',
    'GOAL_READER_UNFIRED',
    'GOAL_CHECK_READERS',
  ].map((c) => [c, c])),
);

// The three lists of goals.json, and the keys of a record of each (the names the plan gives them).
export const LIST = Object.freeze({ goals: 'goals', invariants: 'invariants', questions: 'questions' });
export const KEY = Object.freeze({
  id: 'id', name: 'name', invariants: 'invariants', principles: 'principles', indicators: 'indicators', readers: 'readers', check: 'check',
  holeReason: 'hueco_reason', holeNote: 'hueco_note', text: 'text', goals: 'goals', questions: 'questions', base: 'base', baseNote: 'base_note',
});
// Keys of the file itself that are not a list.
const META_KEYS = ['$comment', 'version'];
const GOAL_REQUIRED = [KEY.id, KEY.name, KEY.invariants, KEY.principles, KEY.indicators, KEY.readers, KEY.check];
// The field names of each entity of entities.json that this file holds (scripts/lib/fields.mjs lists them as the source of its fields).
export const GOAL_FIELDS = Object.freeze([...GOAL_REQUIRED, KEY.holeReason, KEY.holeNote]);
export const INVARIANT_FIELDS = Object.freeze([KEY.id, KEY.text, KEY.goals, KEY.principles, KEY.questions]);
const ROW_KEYS = [KEY.id, KEY.goals, KEY.base, KEY.baseNote];

// Who checks a goal today: the word of the standard for a machine, `juez` for a question a judge answers, `nadie` for no reader at all.
export const CHECK = Object.freeze({ machine: CHECKED_BY.machine, judge: 'juez', nobody: 'nadie' });
// A goal with no indicator says `hueco` (the same word as a base hole) and a closed reason; a question that serves no goal says its `base`.
export const HOLE = BASE_HOLE;
export const HOLE_REASONS = Object.freeze(['por-construir', 'sin-medida-posible', OTHER]);
export const BASE_REASONS = Object.freeze(['seguridad', 'fallo-visible', 'tests-fiables', OTHER]);

export const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isList = (v, ok) => Array.isArray(v) && v.every(ok);
export const fault = (code, where, message) => ({ code, where, message });
export const idOf = (r) => r?.[KEY.id];

export function readGoals(root) {
  const file = path.join(root, GOALS_FILE);
  if (!existsSync(file)) throw new Error(`${GOALS_FILE} not found in ${root}`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${GOALS_FILE} in ${root} is not readable JSON`, { cause: e });
  }
}

// Missing and unknown keys of one record.
function keyFaults(rec, required, allowed, where) {
  const out = required.filter((k) => rec[k] === undefined).map((k) => fault(GOAL_FAULTS.GOAL_MISSING_KEY, where, `missing «${k}»`));
  return [...out, ...Object.keys(rec).filter((k) => !allowed.includes(k)).map((k) => fault(GOAL_FAULTS.GOAL_UNKNOWN_KEY, where, `«${k}» is not a key of this record`))];
}

const typeFault = (where, k, what) => fault(GOAL_FAULTS.GOAL_BAD_VALUE, where, `«${k}» must be ${what}`);

// A closed reason with the valve `otro` and a note (the note is required exactly with the valve).
function reasonFaults(code, where, reason, note, list, label) {
  if (!list.includes(reason)) return [fault(code, where, `${label} must be one of ${list.join(', ')}`)];
  if (reason === OTHER && !isText(note)) return [fault(code, where, `${label} «${OTHER}» needs a note`)];
  if (reason !== OTHER && note !== undefined) return [fault(code, where, `a note goes only with the valve «${OTHER}»`)];
  return [];
}

function indicatorsFaults(g, where) {
  const ids = g[KEY.indicators];
  if (!isList(ids, isText) || ids.length === 0) return [typeFault(where, KEY.indicators, 'a non-empty list of ids')];
  const isHole = ids.includes(HOLE);
  if (!isHole) {
    return g[KEY.holeReason] === undefined && g[KEY.holeNote] === undefined ? [] : [fault(GOAL_FAULTS.GOAL_BAD_HUECO, where, `a ${KEY.holeReason} goes only with «${HOLE}»`)];
  }
  if (ids.length !== 1) return [fault(GOAL_FAULTS.GOAL_BAD_HUECO, where, `«${HOLE}» stands alone in ${KEY.indicators}`)];
  return reasonFaults(GOAL_FAULTS.GOAL_BAD_HUECO, where, g[KEY.holeReason], g[KEY.holeNote], HOLE_REASONS, KEY.holeReason);
}

function goalShape(g, where) {
  const out = keyFaults(g, GOAL_REQUIRED, GOAL_FIELDS, where);
  if (out.length > 0) return out;
  if (!isText(g[KEY.name])) out.push(typeFault(where, KEY.name, 'text'));
  if (!isList(g[KEY.invariants], isText)) out.push(typeFault(where, KEY.invariants, 'a list of ids'));
  if (!isList(g[KEY.principles], Number.isInteger)) out.push(typeFault(where, KEY.principles, 'a list of numbers'));
  if (!isList(g[KEY.readers], isText)) out.push(typeFault(where, KEY.readers, 'a list of readers'));
  if (!Object.values(CHECK).includes(g[KEY.check])) out.push(fault(GOAL_FAULTS.GOAL_BAD_CHECK, where, `«${KEY.check}» must be one of ${Object.values(CHECK).join(', ')}`));
  else if (isList(g[KEY.readers], isText) && (g[KEY.check] === CHECK.nobody) !== (g[KEY.readers].length === 0)) {
    out.push(fault(GOAL_FAULTS.GOAL_CHECK_READERS, where, `«${CHECK.nobody}» goes exactly with no readers`));
  }
  return [...out, ...indicatorsFaults(g, where)];
}

function invariantShape(inv, where) {
  const out = keyFaults(inv, INVARIANT_FIELDS, INVARIANT_FIELDS, where);
  if (out.length > 0) return out;
  if (!isText(inv[KEY.text])) out.push(typeFault(where, KEY.text, 'text'));
  if (!isList(inv[KEY.goals], isText)) out.push(typeFault(where, KEY.goals, 'a list of ids'));
  if (!isList(inv[KEY.principles], Number.isInteger)) out.push(typeFault(where, KEY.principles, 'a list of numbers'));
  if (!isList(inv[KEY.questions], isText)) out.push(typeFault(where, KEY.questions, 'a list of ids'));
  return out;
}

function rowShape(row, where) {
  const out = keyFaults(row, [KEY.id], ROW_KEYS, where);
  if (out.length > 0) return out;
  const hasGoals = row[KEY.goals] !== undefined;
  const hasBase = row[KEY.base] !== undefined;
  if (hasGoals === hasBase) return [fault(GOAL_FAULTS.GOAL_BAD_BASE, where, `a question row has exactly one of «${KEY.goals}» or «${KEY.base}»`)];
  if (hasGoals) return isList(row[KEY.goals], isText) && row[KEY.goals].length > 0 ? [] : [typeFault(where, KEY.goals, 'a non-empty list of ids')];
  return reasonFaults(GOAL_FAULTS.GOAL_BAD_BASE, where, row[KEY.base], row[KEY.baseNote], BASE_REASONS, KEY.base);
}

const SHAPES = { [LIST.goals]: goalShape, [LIST.invariants]: invariantShape, [LIST.questions]: rowShape };

// The shape of the file and of every record, and the repeated ids. Anything else needs this to be clean first.
export function shapeFaults(registry) {
  const lists = Object.values(LIST);
  if (registry === null || typeof registry !== 'object' || Array.isArray(registry)) return [fault(GOAL_FAULTS.GOAL_BAD_FILE, '-', 'the registry must be an object')];
  const out = Object.keys(registry).filter((k) => !lists.includes(k) && !META_KEYS.includes(k)).map((k) => fault(GOAL_FAULTS.GOAL_UNKNOWN_KEY, '-', `«${k}» is not a list of the registry`));
  for (const list of lists) {
    if (!Array.isArray(registry[list]) || registry[list].length === 0) { out.push(fault(GOAL_FAULTS.GOAL_BAD_FILE, list, `the registry needs a non-empty «${list}» list`)); continue; }
    const seen = new Set();
    for (const rec of registry[list]) {
      const where = `${list}:${idOf(rec) ?? '?'}`;
      if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) { out.push(fault(GOAL_FAULTS.GOAL_BAD_FILE, where, 'a record must be an object')); continue; }
      if (seen.has(idOf(rec))) out.push(fault(GOAL_FAULTS.GOAL_DUPLICATE_ID, where, 'repeated id'));
      seen.add(idOf(rec));
      out.push(...SHAPES[list](rec, where));
    }
  }
  return out;
}

