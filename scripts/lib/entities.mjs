// Reader and validator of the entity registry (entities.json at the repo root): the one place that says which
// kinds of thing the Factory has, where each lives, who reads it, and which base (how to write one) and forge
// (the code that checks one) it has. Pure functions over a parsed registry, plus the disk for path existence.
// Field names follow MenuPlan's ops/entidades.json. Faults are returned, never swallowed (principle 3).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const ENTITIES_FILE = 'entities.json';

export const ENTITY_FAULTS = Object.freeze(
  Object.fromEntries([
    'BAD_REGISTRY',
    'MISSING_FIELD',
    'DUPLICATE_ID',
    'BAD_VALUE',
    'MISSING_PATH',
    'HORIZONTAL_WITHOUT_BASE',
    'BAD_HOLE',
  ].map((c) => [c, c])),
);

export const SCOPES = ['horizontal', 'vertical'];
export const BASE_HOLE = 'hueco';
export const OTHER = 'otro';
export const NO_FORGE = 'sin-forja';
export const HOLE_REASONS = [NO_FORGE, OTHER];
const REQUIRED = ['id', 'name', 'scope', 'term', 'source_of_truth', 'readers'];
// A source_of_truth that is not a path (the entity has no file of its own).
export const NO_PATH = 'none';

const isText = (v) => typeof v === 'string' && v.trim() !== '';

export function readEntities(root) {
  const file = path.join(root, ENTITIES_FILE);
  if (!existsSync(file)) throw new Error(`${ENTITIES_FILE} not found in ${root}`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${ENTITIES_FILE} in ${root} is not readable JSON`, { cause: e });
  }
}

const fault = (code, where, message) => ({ code, where, message });

function pathFaults(e, root) {
  const paths = [e.source_of_truth, ...e.readers];
  if (isText(e.forge)) paths.push(e.forge);
  if (isText(e.base) && e.base !== BASE_HOLE) paths.push(e.base);
  return paths
    .filter((p) => isText(p) && p !== NO_PATH && !existsSync(path.join(root, p)))
    .map((p) => fault(ENTITY_FAULTS.MISSING_PATH, e.id, `${p} does not exist`));
}

function holeFaults(e) {
  if (!HOLE_REASONS.includes(e.base_reason)) {
    return [fault(ENTITY_FAULTS.BAD_HOLE, e.id, `base_reason must be one of ${HOLE_REASONS.join(', ')}`)];
  }
  if (e.base_reason === OTHER && !isText(e.base_note)) {
    return [fault(ENTITY_FAULTS.BAD_HOLE, e.id, `base_reason «${OTHER}» needs a base_note`)];
  }
  return [];
}

function horizontalFaults(e) {
  if (e.scope !== 'horizontal') return [];
  if (e.base === BASE_HOLE) return holeFaults(e);
  if (!isText(e.base) || !isText(e.forge)) {
    return [fault(ENTITY_FAULTS.HORIZONTAL_WITHOUT_BASE, e.id, `a horizontal entity needs base and forge, or base: ${BASE_HOLE} with a reason`)];
  }
  return [];
}

function oneFaults(e, root) {
  const where = e?.id ?? '?';
  const missing = REQUIRED.filter((k) => e?.[k] === undefined).map((k) => fault(ENTITY_FAULTS.MISSING_FIELD, where, `missing «${k}»`));
  if (missing.length > 0) return missing;
  const bad = [];
  if (!SCOPES.includes(e.scope)) bad.push(fault(ENTITY_FAULTS.BAD_VALUE, e.id, `scope must be one of ${SCOPES.join(', ')}`));
  if (!Array.isArray(e.readers)) bad.push(fault(ENTITY_FAULTS.BAD_VALUE, e.id, 'readers must be a list'));
  if (bad.length > 0) return bad;
  return [...horizontalFaults(e), ...pathFaults(e, root)];
}

export function entityFaults(registry, root) {
  if (!registry || !Array.isArray(registry.entities) || registry.entities.length === 0) {
    return [fault(ENTITY_FAULTS.BAD_REGISTRY, '-', 'the registry needs a non-empty «entities» list')];
  }
  const seen = new Set();
  const out = [];
  for (const e of registry.entities) {
    if (seen.has(e?.id)) out.push(fault(ENTITY_FAULTS.DUPLICATE_ID, e.id, 'repeated id'));
    seen.add(e?.id);
    out.push(...oneFaults(e, root));
  }
  return out;
}

// Entities whose base is a hole: what `audit` will count.
export const baseHoles = (registry) => registry.entities.filter((e) => e.base === BASE_HOLE).map((e) => e.id);
