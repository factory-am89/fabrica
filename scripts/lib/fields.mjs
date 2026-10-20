// Reader and validator of the field registry (fields.json at the repo root): every field that an entity of
// entities.json has in code is declared once, with its kind, owner, whether it already existed, what values it takes
// and where it is wired. A field in code that fields.json does not declare turns the test red (new-field rule =
// I1 «does it exist?» + I2 «entity, parameter or attribute, and with which values?» + I3 «where is it wired?»).
// The machine walks only the sources the entities of entities.json have (FIELD_SOURCES). What it cannot see (a synonym
// such as «precio»/«price», or a loose field in code that no source lists) is judged by question P10 (chunk 11 of the plan).
// Faults are returned, never swallowed (principle 3); a source that cannot be read throws.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { GOAL_FIELDS, INVARIANT_FIELDS } from './goals-shape.mjs';
import { CAMPOS } from './intervention-log.mjs';
import { FIELDS as LESSON_FIELDS, NO_LESSON_FIELDS } from './lessons.mjs';
import { PLAN_FIELDS } from './plan.mjs';
import { NO_PATH, OTHER } from './entities.mjs';

export const FIELDS_FILE = 'fields.json';

export const FIELD_FAULTS = Object.freeze(
  Object.fromEntries([
    'BAD_FIELD_REGISTRY',
    'MISSING_KEY',
    'UNDECLARED_FIELD',
    'DUPLICATE_NAME',
    'BAD_KIND',
    'BAD_PARENT',
    'UNKNOWN_OWNER',
    'UNKNOWN_EXISTING',
    'BAD_NEW_REASON',
    'BAD_VALUES',
    'BAD_TEXT_REASON',
    'BAD_WIRING',
    'UNUSED_FIELD',
    'UNKNOWN_SOURCE',
  ].map((c) => [c, c])),
);

// JSON keys of one declared field, written once (the plan names them in Spanish: tipo, dueño, existente, valores, cableado).
export const KEYS = Object.freeze({
  name: 'campo',
  kind: 'tipo',
  parent: 'de',
  owner: 'dueño',
  existing: 'existente',
  newReason: 'nueva_motivo',
  newNote: 'nueva_nota',
  values: 'valores',
  textReason: 'texto_motivo',
  textNote: 'texto_nota',
  wiring: 'cableado',
});
export const REQUIRED_KEYS = [KEYS.name, KEYS.kind, KEYS.owner, KEYS.existing, KEYS.values, KEYS.wiring];

export const ENTITY_KIND = 'entidad';
export const PARAMETER_KIND = 'parámetro';
export const ATTRIBUTE_KIND = 'atributo_de';
export const KINDS = [ENTITY_KIND, PARAMETER_KIND, ATTRIBUTE_KIND];
// `existente` is the id (`<dueño>.<campo>`) of a declared field this one reuses, or NEW with a closed reason.
export const NEW = 'nueva';
export const NEW_REASONS = ['sin-equivalente', OTHER];
export const VALUE_KINDS = ['enum', 'booleano', 'número', 'id', 'fecha', 'texto'];
export const TEXT = 'texto';
export const TEXT_REASONS = ['prosa-juzgada', OTHER];

// The entity ids of entities.json that have fields in code, written once.
export const ENTITY = Object.freeze({ lesson: 'lesson', noLesson: 'no-lesson', intervention: 'intervention', plan: 'plan', goal: 'goal', invariant: 'invariant' });

// Where each entity's fields are listed in code. Keys are entity ids of entities.json; values return the field names.
export const FIELD_SOURCES = Object.freeze({
  [ENTITY.lesson]: () => LESSON_FIELDS,
  [ENTITY.noLesson]: () => NO_LESSON_FIELDS,
  [ENTITY.intervention]: () => CAMPOS,
  [ENTITY.plan]: () => Object.values(PLAN_FIELDS),
  [ENTITY.goal]: () => GOAL_FIELDS,
  [ENTITY.invariant]: () => INVARIANT_FIELDS,
});

const isText = (v) => typeof v === 'string' && v.trim() !== '';
export const normalizeName = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const fieldId = (f) => `${f?.[KEYS.owner]}.${f?.[KEYS.name]}`;

export function readFields(root) {
  const file = path.join(root, FIELDS_FILE);
  if (!existsSync(file)) throw new Error(`${FIELDS_FILE} not found in ${root}`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${FIELDS_FILE} in ${root} is not readable JSON`, { cause: e });
  }
}

// [{owner, name}] for every entity of the entity registry that has a source in FIELD_SOURCES; a source that returns
// no list or an empty one throws (a truncated read is never taken as «no fields»).
export function discoveredFields(entityRegistry, sources = FIELD_SOURCES) {
  const out = [];
  for (const e of entityRegistry.entities) {
    if (!Object.hasOwn(sources, e.id)) continue;
    const names = sources[e.id]();
    if (!Array.isArray(names) || names.length === 0) throw new Error(`field source of «${e.id}» returned no list of names`);
    out.push(...names.map((name) => ({ owner: e.id, name })));
  }
  return out;
}

const fault = (code, where, message) => ({ code, where, message });

// A closed reason (`reason`) with the valve `otro` + free note (`note`).
function reasonFault(code, where, reason, note, list, what) {
  if (!list.includes(reason)) return [fault(code, where, `${what} must be one of ${list.join(', ')}`)];
  if (reason === OTHER && !isText(note)) return [fault(code, where, `${what} «${OTHER}» needs a note`)];
  return [];
}

function oneFaults(f, ctx) {
  const where = f?.[KEYS.owner] === undefined ? '?' : fieldId(f);
  const missing = REQUIRED_KEYS.filter((k) => f?.[k] === undefined).map((k) => fault(FIELD_FAULTS.MISSING_KEY, where, `missing «${k}»`));
  if (missing.length > 0) return missing;
  const out = [];
  if (!ctx.entityIds.includes(f[KEYS.owner])) out.push(fault(FIELD_FAULTS.UNKNOWN_OWNER, where, `owner ${JSON.stringify(f[KEYS.owner])} is not an entity of entities.json`));
  if (!KINDS.includes(f[KEYS.kind])) out.push(fault(FIELD_FAULTS.BAD_KIND, where, `kind must be one of ${KINDS.join(', ')}`));
  else if (f[KEYS.kind] === ATTRIBUTE_KIND && !ctx.entityIds.includes(f[KEYS.parent])) {
    out.push(fault(FIELD_FAULTS.BAD_PARENT, where, `kind «${ATTRIBUTE_KIND}» needs «${KEYS.parent}» to be an entity of entities.json`));
  }
  if (f[KEYS.existing] === NEW) out.push(...reasonFault(FIELD_FAULTS.BAD_NEW_REASON, where, f[KEYS.newReason], f[KEYS.newNote], NEW_REASONS, KEYS.newReason));
  else if (!ctx.ids.includes(f[KEYS.existing]) || f[KEYS.existing] === fieldId(f)) {
    out.push(fault(FIELD_FAULTS.UNKNOWN_EXISTING, where, `${KEYS.existing} must be «${NEW}» or the id of another declared field`));
  }
  if (!VALUE_KINDS.includes(f[KEYS.values])) out.push(fault(FIELD_FAULTS.BAD_VALUES, where, `${KEYS.values} must be one of ${VALUE_KINDS.join(', ')}`));
  else if (f[KEYS.values] === TEXT) out.push(...reasonFault(FIELD_FAULTS.BAD_TEXT_REASON, where, f[KEYS.textReason], f[KEYS.textNote], TEXT_REASONS, KEYS.textReason));
  const wiring = f[KEYS.wiring];
  if (!Array.isArray(wiring) || wiring.length === 0) out.push(fault(FIELD_FAULTS.BAD_WIRING, where, `${KEYS.wiring} must be a non-empty list of repo paths`));
  else {
    for (const p of wiring) {
      if (!isText(p) || p === NO_PATH || !existsSync(path.join(ctx.root, p))) out.push(fault(FIELD_FAULTS.BAD_WIRING, where, `${KEYS.wiring} path ${JSON.stringify(p)} does not exist`));
    }
  }
  return out;
}

// The same normalized name twice is a fault unless it is the same concept reused: another owner and `existente` set.
function duplicateFaults(fields) {
  const out = [];
  const first = new Map();
  for (const f of fields) {
    const key = normalizeName(f?.[KEYS.name]);
    if (!first.has(key)) { first.set(key, f); continue; }
    const same = first.get(key)[KEYS.owner] === f[KEYS.owner];
    if (same || f[KEYS.existing] === NEW) out.push(fault(FIELD_FAULTS.DUPLICATE_NAME, fieldId(f), `name «${f[KEYS.name]}» repeats «${fieldId(first.get(key))}»${same ? ' of the same owner' : `; set «${KEYS.existing}» to it or rename`}`));
  }
  return out;
}

// registry: parsed fields.json; entityRegistry: parsed entities.json; discovered: [{owner, name}] (see discoveredFields).
export function fieldFaults(registry, entityRegistry, root, discovered = discoveredFields(entityRegistry), sources = FIELD_SOURCES) {
  if (!registry || !Array.isArray(registry.fields) || registry.fields.length === 0) {
    return [fault(FIELD_FAULTS.BAD_FIELD_REGISTRY, '-', 'the registry needs a non-empty «fields» list')];
  }
  const entityIds = entityRegistry.entities.map((e) => e.id);
  const ctx = { root, entityIds, ids: registry.fields.map(fieldId) };
  const out = Object.keys(sources).filter((id) => !entityIds.includes(id)).map((id) => fault(FIELD_FAULTS.UNKNOWN_SOURCE, id, 'a field source names an id that is not an entity of entities.json'));
  const declared = new Set(registry.fields.map(fieldId));
  const found = new Set(discovered.map((d) => `${d.owner}.${d.name}`));
  for (const d of discovered) {
    if (!declared.has(`${d.owner}.${d.name}`)) out.push(fault(FIELD_FAULTS.UNDECLARED_FIELD, `${d.owner}.${d.name}`, `field in code that ${FIELDS_FILE} does not declare`));
  }
  for (const f of registry.fields) {
    out.push(...oneFaults(f, ctx));
    if (f?.[KEYS.owner] !== undefined && !found.has(fieldId(f))) out.push(fault(FIELD_FAULTS.UNUSED_FIELD, fieldId(f), 'declared but no source of entities.json lists it'));
  }
  out.push(...duplicateFaults(registry.fields));
  return out;
}
