// The throwaway root that test/audit.test.js and test/goals-debt.test.js measure: every source the audit reads, each in a known state.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { INDICATORS } from '../../scripts/audit.mjs';
import { BASE_HOLE, ENTITIES_FILE, HORIZONTAL } from '../../scripts/lib/entities.mjs';
import { ENTITY, FIELDS_FILE, KEYS, TEXT } from '../../scripts/lib/fields.mjs';
import { CHECK, GOALS_FILE, KEY, LIST } from '../../scripts/lib/goals.mjs';
import { INTERVENCIONES_FILE, LESSONS_DIR, LESSON_NOTE, NO_QUESTION, REASON_SINGLE, STANDARDS, SIGNAL_MACHINE, SIGNAL_NONE } from '../../scripts/lib/lessons.mjs';
import { CHECKED_BY, FIELDS } from '../../scripts/lib/questions.mjs';
import { RULES_BUDGET_FILE } from '../../scripts/lib/skills.mjs';

// A goals.json of one goal with the given indicators and no reader (the audit lists its debt; it does not validate the file).
export const goalsOf = (indicators, extra = {}) => ({
  [LIST.goals]: [{ [KEY.id]: 'G1', [KEY.name]: 'goal', [KEY.invariants]: [], [KEY.principles]: [], [KEY.indicators]: indicators, [KEY.readers]: [], [KEY.check]: CHECK.nobody, ...extra }],
  [LIST.invariants]: [],
  [LIST.questions]: [],
});

export function put(root, rel, text) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text);
}
export const question = (n, who) => `### Q${n} — text\n${FIELDS.checkedBy.label}: ${who}\n\n`;
export const manyLines = (n) => `${'// x\n'.repeat(n)}`;

// A root with every source the audit reads, each in a known state; `over` replaces files by relative path.
export function fixture(t, over = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'fabrica-audit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    [STANDARDS[0]]: question(1, CHECKED_BY.machine) + question(2, CHECKED_BY.reviewer) + question(3, CHECKED_BY.reviewer),
    [`${LESSONS_DIR}/a.json`]: JSON.stringify({ signal: SIGNAL_MACHINE, reason: [REASON_SINGLE], question: 'C1', mechanism: 'test/uses.test.js' }),
    [`${LESSONS_DIR}/b.json`]: JSON.stringify({ signal: SIGNAL_NONE, reason: [REASON_SINGLE], question: 'C1', mechanism: 'scripts/con.mjs' }),
    [`${LESSONS_DIR}/c.json`]: JSON.stringify({ signal: SIGNAL_MACHINE, question: NO_QUESTION, mechanism: 'scripts/sin.mjs' }),
    'package.json': JSON.stringify({ scripts: {} }),
    [FIELDS_FILE]: JSON.stringify({ fields: [{ [KEYS.name]: LESSON_NOTE, [KEYS.owner]: ENTITY.lesson, [KEYS.values]: TEXT }] }),
    [RULES_BUDGET_FILE]: JSON.stringify({ budget: { uno: 3, dos: 4 } }),
    [INTERVENCIONES_FILE]: '# h\n2026-01-01 | clic | a | b | repetida: no\n2026-01-02 | clic | a | b | repetida: no\nsuelta\n',
    [ENTITIES_FILE]: JSON.stringify({ entities: [{ id: 'e1', scope: HORIZONTAL, base: BASE_HOLE }, { id: 'e2', scope: HORIZONTAL, base: 'x.md' }] }),
    [GOALS_FILE]: JSON.stringify(goalsOf([INDICATORS.questions])),
    'scripts/con.mjs': "console.log('--json');\n",
    'scripts/sin.mjs': 'export const a = 1;\n',
    'scripts/lib/vocab.mjs': 'export const WORDS = [\n  \'vocabulary-word\', \'tiny\',\n];\nconst PRIVATE = \'private-word-here\';\n',
    'test/uses.test.js': "const a = 'vocabulary-word'; const b = 'tiny'; const c = 'private-word-here';\n",
    ...over,
  };
  for (const [rel, text] of Object.entries(files)) put(root, rel, text);
  return root;
}
