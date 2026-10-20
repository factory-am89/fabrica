// Indicator `free-values` of scripts/audit.mjs: for every field that fields.json marks as free text (`texto`), the values
// the repo's own files hold for it, which ones repeat, and, when few different values cover many, a proposal of enum.
// It only proposes: turning a field into an enum is another PR. A signal, not a gate (the audit never fails on it).
// A text field with no reader here throws: a field whose values are not read would be a silent hole (principle 3).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { KEYS, TEXT, fieldId, readFields } from './fields.mjs';
import { NO_LESSON_KEYS, readLessons, readNoLesson } from './lessons.mjs';
import { PLAN_DIR, PLAN_FIELDS, parsePlan } from './plan.mjs';

// A value repeated at least MIN_REPEATS times is «repeated». An enum is proposed when there are at least MIN_VALUES values,
// at most MAX_ENUM_VALUES different ones, and the different ones are at most MAX_DISTINCT_SHARE of the values (so they do repeat).
export const MIN_REPEATS = 2;
export const MIN_VALUES = 5;
export const MAX_ENUM_VALUES = 8;
export const MAX_DISTINCT_SHARE = 0.5;
export const PLAN_NONE = 'none';

const clean = (v) => String(v).trim().replace(/\s+/g, ' ');
const planChunks = (root) => {
  const dir = path.join(root, PLAN_DIR);
  return readdirSync(dir).filter((f) => f.endsWith('.md')).sort().flatMap((f) => parsePlan(readFileSync(path.join(dir, f), 'utf8')).chunks);
};
// A chunk whose field is absent has no value; an empty list is the plan's own word for «none».
const planField = (key, of) => (root) => planChunks(root).map(of).filter((v) => v !== null && v !== undefined).map((v) => (Array.isArray(v) ? (v.length === 0 ? PLAN_NONE : v.join(', ')) : v));

// owner id (entity of entities.json) -> field name -> reader of its values. lesson and no-lesson share the name (`existente` in fields.json).
export const VALUE_READERS = Object.freeze({
  lesson: { [NO_LESSON_KEYS.note]: (root) => readLessons(root).map((l) => JSON.parse(l.text)[NO_LESSON_KEYS.note]).filter((v) => v !== undefined) },
  'no-lesson': { [NO_LESSON_KEYS.note]: (root) => JSON.parse(readNoLesson(root)).entries.map((e) => e[NO_LESSON_KEYS.note]).filter((v) => v !== undefined) },
  plan: {
    [PLAN_FIELDS.blockedBy]: planField(PLAN_FIELDS.blockedBy, (c) => c.blockedBy),
    [PLAN_FIELDS.existing]: planField(PLAN_FIELDS.existing, (c) => c.existing),
    [PLAN_FIELDS.notDone]: planField(PLAN_FIELDS.notDone, (c) => c.notDone),
    [PLAN_FIELDS.done]: planField(PLAN_FIELDS.done, (c) => c.done?.code),
  },
});

// Pure: the values of one field -> {total, distinct, repeated: [{value, count}], proposal: sorted distinct values | null}.
export function summarize(values) {
  const counts = new Map();
  for (const v of values.map(clean)) counts.set(v, (counts.get(v) ?? 0) + 1);
  const repeated = [...counts].filter(([, n]) => n >= MIN_REPEATS).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const proposes = values.length >= MIN_VALUES && counts.size <= MAX_ENUM_VALUES && counts.size <= values.length * MAX_DISTINCT_SHARE;
  return { total: values.length, distinct: counts.size, repeated, proposal: proposes ? [...counts.keys()].sort() : null };
}

export function freeValues(root, readers = VALUE_READERS) {
  const fields = readFields(root).fields.filter((f) => f[KEYS.values] === TEXT).map((f) => {
    const read = readers[f[KEYS.owner]]?.[f[KEYS.name]];
    if (read === undefined) throw new Error(`free-values: text field «${fieldId(f)}» has no reader of its values (add it to VALUE_READERS)`);
    return { field: fieldId(f), ...summarize(read(root)) };
  });
  return { minValues: MIN_VALUES, maxEnumValues: MAX_ENUM_VALUES, count: fields.filter((f) => f.proposal !== null).length, fields };
}

export const humanFreeValues = (id, r) => [
  `${id}: ${r.count} of ${r.fields.length} text fields with a proposal of enum`,
  ...r.fields.filter((x) => x.proposal !== null).map((x) => `  ${x.field}: ${JSON.stringify(x.proposal)}`),
];
