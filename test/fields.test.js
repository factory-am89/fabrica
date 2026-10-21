// fields.json: every field the entities of entities.json have in code is declared (the real files are read, the
// sources are the real exports), and each fault code has a bad case that turns it red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OTHER, readEntities } from '../scripts/lib/entities.mjs';
import { GOAL_FIELDS, INVARIANT_FIELDS } from '../scripts/lib/goals-shape.mjs';
import { CAMPOS } from '../scripts/lib/intervention-log.mjs';
import { FIELDS as LESSON_FIELDS } from '../scripts/lib/lessons.mjs';
import { PLAN_FIELDS } from '../scripts/lib/plan.mjs';
import { REVIEWER_NO_FIELDS } from '../scripts/lib/reviewer-no.mjs';
import {
  ATTRIBUTE_KIND, ENTITY, FIELD_FAULTS, FIELD_SOURCES, KEYS, NEW, TEXT, discoveredFields, fieldFaults, fieldId, normalizeName, readFields,
} from '../scripts/lib/fields.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const entities = () => readEntities(RAIZ);
const real = () => readFields(RAIZ);
const clone = (x) => JSON.parse(JSON.stringify(x));
const codes = (fields, discovered) => fieldFaults({ fields }, entities(), RAIZ, discovered).map((f) => f.code);
// One declared field of the real registry, to build bad cases from: the first lesson field that no other field reuses (`existente`),
// so changing it breaks nothing else.
const BASE_NAME = LESSON_FIELDS.find((n) => !real().fields.some((f) => f[KEYS.existing] === `lesson.${n}`));
const base = () => clone(real().fields.find((f) => fieldId(f) === `lesson.${BASE_NAME}`));
const others = () => real().fields.filter((f) => fieldId(f) !== fieldId(base()));
const withBase = (...mutated) => [...others(), ...mutated];

test('the real registry has no fault: every field the sources list is declared, and nothing declared is unused', () => {
  assert.deepEqual(fieldFaults(real(), entities(), RAIZ), []);
});

test('the sources are the real exports: lesson, reviewer-no, intervention, plan, goal and invariant names are all discovered', () => {
  const found = discoveredFields(entities()).map((d) => `${d.owner}.${d.name}`);
  const expected = [
    ...LESSON_FIELDS.map((n) => `lesson.${n}`),
    ...REVIEWER_NO_FIELDS.map((n) => `${ENTITY.reviewerNo}.${n}`),
    ...CAMPOS.map((n) => `intervention.${n}`),
    ...Object.values(PLAN_FIELDS).map((n) => `plan.${n}`),
    ...GOAL_FIELDS.map((n) => `${ENTITY.goal}.${n}`),
    ...INVARIANT_FIELDS.map((n) => `${ENTITY.invariant}.${n}`),
  ];
  assert.deepEqual([...found].sort(), expected.sort());
  assert.deepEqual(Object.keys(FIELD_SOURCES).sort(), Object.values(ENTITY).sort());
});

test('a source that returns no list or an empty one throws, never «no fields»', () => {
  assert.throws(() => discoveredFields(entities(), { lesson: () => [] }), /no list of names/);
  assert.throws(() => discoveredFields(entities(), { lesson: () => undefined }), /no list of names/);
});

test('names are compared in lowercase and without accents', () => {
  assert.equal(normalizeName('Clasé'), normalizeName('CLASE'));
});

test('good case is green and each fault code has a bad case that turns it red', () => {
  assert.deepEqual(codes(withBase(base())), []);
  assert.deepEqual(fieldFaults({}, entities(), RAIZ).map((f) => f.code), [FIELD_FAULTS.BAD_FIELD_REGISTRY]);

  const found = discoveredFields(entities());
  assert.deepEqual(codes(real().fields, [...found, { owner: 'lesson', name: 'campo-nuevo' }]), [FIELD_FAULTS.UNDECLARED_FIELD]);
  assert.deepEqual(codes(withBase(base(), { ...base(), [KEYS.name]: 'extra' })), [FIELD_FAULTS.UNUSED_FIELD]);
  assert.deepEqual(codes(withBase({ ...base(), [KEYS.wiring]: undefined })), [FIELD_FAULTS.MISSING_KEY]);
  assert.deepEqual(codes(withBase({ ...base(), [KEYS.kind]: 'otra-cosa' })), [FIELD_FAULTS.BAD_KIND]);
  assert.deepEqual(codes(withBase({ ...base(), [KEYS.kind]: ATTRIBUTE_KIND, [KEYS.parent]: 'no-es-entidad' })), [FIELD_FAULTS.BAD_PARENT]);
  assert.deepEqual(codes(withBase({ ...base(), [KEYS.owner]: 'fantasma' })), [FIELD_FAULTS.UNKNOWN_OWNER, FIELD_FAULTS.UNDECLARED_FIELD, FIELD_FAULTS.UNUSED_FIELD].sort());
  assert.deepEqual(codes(withBase({ ...base(), [KEYS.existing]: 'lesson.no-existe' })), [FIELD_FAULTS.UNKNOWN_EXISTING]);
  assert.deepEqual(codes(withBase({ ...base(), [KEYS.existing]: fieldId(base()) })), [FIELD_FAULTS.UNKNOWN_EXISTING]);
  assert.deepEqual(codes(withBase({ ...base(), [KEYS.newReason]: 'porque-si' })), [FIELD_FAULTS.BAD_NEW_REASON]);
  assert.deepEqual(codes(withBase({ ...base(), [KEYS.newReason]: OTHER })), [FIELD_FAULTS.BAD_NEW_REASON]);
  assert.deepEqual(codes(withBase({ ...base(), [KEYS.values]: 'cualquier-cosa' })), [FIELD_FAULTS.BAD_VALUES]);
  assert.deepEqual(codes(withBase({ ...base(), [KEYS.values]: TEXT })), [FIELD_FAULTS.BAD_TEXT_REASON]);
  assert.deepEqual(codes(withBase({ ...base(), [KEYS.wiring]: ['no/existe.mjs'] })), [FIELD_FAULTS.BAD_WIRING]);
  assert.deepEqual(codes(withBase({ ...base(), [KEYS.wiring]: [] })), [FIELD_FAULTS.BAD_WIRING]);
});

test('a source naming an id that is not an entity is a fault', () => {
  const sources = { ...FIELD_SOURCES, fantasma: () => ['x'] };
  const f = fieldFaults(real(), entities(), RAIZ, discoveredFields(entities()), sources);
  assert.deepEqual(f.map((x) => x.code), [FIELD_FAULTS.UNKNOWN_SOURCE]);
});

test('a repeated name (lowercase, no accents) is a fault in the same owner, and across owners unless it reuses the other field', () => {
  const sameOwner = { ...base(), [KEYS.name]: BASE_NAME.toUpperCase() };
  assert.ok(codes(withBase(base(), sameOwner)).includes(FIELD_FAULTS.DUPLICATE_NAME));
  const other = { ...base(), [KEYS.owner]: 'plan', [KEYS.kind]: ATTRIBUTE_KIND, [KEYS.parent]: 'plan', [KEYS.name]: BASE_NAME.replace(/^./, (c) => c.toUpperCase()) };
  const found = [...discoveredFields(entities()), { owner: 'plan', name: other[KEYS.name] }];
  assert.ok(codes(withBase(base(), { ...other, [KEYS.existing]: NEW, [KEYS.newReason]: 'sin-equivalente' }), found).includes(FIELD_FAULTS.DUPLICATE_NAME));
  assert.deepEqual(codes(withBase(base(), { ...other, [KEYS.existing]: fieldId(base()) }), found).filter((c) => c === FIELD_FAULTS.DUPLICATE_NAME), []);
});
