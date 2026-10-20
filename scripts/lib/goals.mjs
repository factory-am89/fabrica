// Reader and validator of the goals registry (goals.json at the repo root): the goals of the Factory, the invariants that serve them and
// the row of every question (which goal it serves, or why it protects all of them). The shape is in goals-shape.mjs; this module checks
// what needs the repo: that every name points at something that exists, and that every reader exists and resolves to a trigger.
// Nothing is stored that can be computed (principle 4): the trigger of a reader is `triggerOf` (scripts/lib/triggers.mjs) and an
// indicator being «no concluyente» is computed by `audit` from its cases; the unknown-key rule keeps both out of the file.
// The ids of the indicators come from the caller (`indicators`, the values of INDICATORS in scripts/audit.mjs): this module cannot import audit.
// Faults are returned, never swallowed (principle 3); a file or a standard that cannot be read throws.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PRINCIPLES_FILE, loadPrinciples } from './decision.mjs';
import { GOAL_FAULTS, HOLE, KEY, LIST, fault, idOf, shapeFaults } from './goals-shape.mjs';
import { STANDARDS } from './lessons.mjs';
import { ID_SOURCE, readQuestions } from './questions.mjs';
import { triggerOf } from './triggers.mjs';
import { readWiring } from './wiring.mjs';

export * from './goals-shape.mjs';

// Every question of the standards, by id: { id, standard, checkedBy }. A standard with no questions throws.
export function readAllQuestions(root) {
  const out = new Map();
  for (const standard of STANDARDS) {
    for (const q of readQuestions(readFileSync(path.join(root, standard), 'utf8'))) out.set(q.id, { id: q.id, standard, checkedBy: q.checkedBy });
  }
  return out;
}

const ids = (registry, list) => registry[list].map(idOf);

// Every id a record names must be the id of a record of the list it names.
function refFaults(registry, known, principles, indicators) {
  const out = [];
  const refs = (where, names, list, label) => out.push(...names.filter((n) => !list.includes(n)).map((n) => fault(GOAL_FAULTS.GOAL_UNKNOWN_REF, where, `${label} «${n}» does not exist`)));
  const badPrinciples = (where, nums) => out.push(...nums.filter((n) => !principles.includes(n)).map((n) => fault(GOAL_FAULTS.GOAL_UNKNOWN_PRINCIPLE, where, `principle ${n} is not in ${PRINCIPLES_FILE}`)));
  for (const g of registry[LIST.goals]) {
    const where = `${LIST.goals}:${g[KEY.id]}`;
    refs(where, g[KEY.invariants], known.invariants, 'invariant');
    badPrinciples(where, g[KEY.principles]);
    out.push(...g[KEY.indicators].filter((i) => i !== HOLE && !indicators.includes(i)).map((i) => fault(GOAL_FAULTS.GOAL_UNKNOWN_INDICATOR, where, `indicator «${i}» is not in INDICATORS`)));
  }
  for (const inv of registry[LIST.invariants]) {
    const where = `${LIST.invariants}:${inv[KEY.id]}`;
    refs(where, inv[KEY.goals], known.goals, 'goal');
    refs(where, inv[KEY.questions], known.rows, 'question row');
    badPrinciples(where, inv[KEY.principles]);
  }
  for (const row of registry[LIST.questions]) refs(`${LIST.questions}:${row[KEY.id]}`, row[KEY.goals] ?? [], known.goals, 'goal');
  return out;
}

// A goal and its invariants name each other (two copies of one fact that must agree), and an invariant serves a goal and sits in a principle or a question.
function invariantFaults(registry) {
  const out = [];
  const goals = new Map(registry[LIST.goals].map((g) => [g[KEY.id], g]));
  const invariants = new Map(registry[LIST.invariants].map((i) => [i[KEY.id], i]));
  for (const g of goals.values()) {
    for (const i of g[KEY.invariants].filter((n) => invariants.has(n) && !invariants.get(n)[KEY.goals].includes(g[KEY.id]))) {
      out.push(fault(GOAL_FAULTS.GOAL_MIRROR, `${LIST.goals}:${g[KEY.id]}`, `lists ${i}, which does not list it back`));
    }
  }
  for (const inv of invariants.values()) {
    for (const g of inv[KEY.goals].filter((n) => goals.has(n) && !goals.get(n)[KEY.invariants].includes(inv[KEY.id]))) {
      out.push(fault(GOAL_FAULTS.GOAL_MIRROR, `${LIST.invariants}:${inv[KEY.id]}`, `lists ${g}, which does not list it back`));
    }
    if (inv[KEY.goals].length === 0 || (inv[KEY.principles].length === 0 && inv[KEY.questions].length === 0)) {
      out.push(fault(GOAL_FAULTS.GOAL_INVARIANT_LOOSE, `${LIST.invariants}:${inv[KEY.id]}`, 'an invariant serves a goal and is in a principle or a question'));
    }
  }
  return out;
}

// A reader is a question id, a path or a package.json script; it must exist and resolve to a trigger.
function readerFaults(registry, root, questions) {
  const isQuestionId = new RegExp(`^${ID_SOURCE}$`);
  const scripts = readWiring(root).scripts;
  const out = [];
  for (const g of registry[LIST.goals]) {
    for (const reader of g[KEY.readers]) {
      const where = `${LIST.goals}:${g[KEY.id]}`;
      const exists = isQuestionId.test(reader) ? questions.has(reader) : reader.includes('/') ? existsSync(path.join(root, reader)) : scripts.includes(reader);
      if (!exists) out.push(fault(GOAL_FAULTS.GOAL_READER_MISSING, where, `reader «${reader}» is not a question, a file or a package.json script`));
      else if (triggerOf(reader, root) === null) out.push(fault(GOAL_FAULTS.GOAL_READER_UNFIRED, where, `nothing fires reader «${reader}»`));
    }
  }
  return out;
}

// The question rows against the questions the standards really have, both ways.
function rowFaults(registry, questions) {
  const rows = ids(registry, LIST.questions);
  return [
    ...[...questions.keys()].filter((q) => !rows.includes(q)).map((q) => fault(GOAL_FAULTS.GOAL_QUESTION_NO_ROW, q, `question ${q} has no row in ${LIST.questions}`)),
    ...rows.filter((r) => !questions.has(r)).map((r) => fault(GOAL_FAULTS.GOAL_ROW_NO_QUESTION, r, `row ${r} names a question no standard has`)),
  ];
}

// registry: parsed goals.json; root: the repo (CLAUDE.md, the standards, the workflows are read from it); indicators: the ids of INDICATORS.
export function goalFaults(registry, root, { indicators }) {
  const shape = shapeFaults(registry);
  if (shape.length > 0) return shape;
  const questions = readAllQuestions(root);
  const known = { goals: ids(registry, LIST.goals), invariants: ids(registry, LIST.invariants), rows: ids(registry, LIST.questions) };
  return [
    ...refFaults(registry, known, loadPrinciples(root), indicators),
    ...invariantFaults(registry),
    ...rowFaults(registry, questions),
    ...readerFaults(registry, root, questions),
  ];
}
