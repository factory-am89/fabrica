// The decision-line reader: good lines, one bad line per fault code, and the two files it reads failing loudly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decisionFaults, DECISION_FAULTS, DECIDED, FORMS, CLASS_PLACEHOLDER, PRINCIPLE_PLACEHOLDER, parsePrinciples, loadRules } from '../scripts/lib/decision.mjs';
import { SECTIONS } from '../scripts/lib/pr-body.mjs';
import { parseClasses, CLASS_COUNT, INTERVENTION_FILE } from '../scripts/lib/intervention.mjs';

const root = new URL('../', import.meta.url);
const rules = loadRules();
const [firstClass] = rules.classes;
const firstPrinciple = rules.principles[0];
const missingPrinciple = rules.principles.length + 1;

const codes = (content) => decisionFaults(content, rules).map((f) => f.code);

test('good: None, a decision with a closed-list class, a decision with «decidido», an exception', () => {
  assert.deepEqual(codes('None'), []);
  assert.deepEqual(codes('None.\n'), []);
  assert.deepEqual(codes(`- principio ${firstPrinciple} | eligió: a | descartó: b | motivo: ${firstClass}`), []);
  assert.deepEqual(codes(`- principio ${firstPrinciple} | eligió: a | descartó: b | motivo: ${DECIDED}`), []);
  assert.deepEqual(codes(`- excepción a principio ${firstPrinciple} | motivo: no cabe | coste: una comprobación a mano`), []);
  assert.deepEqual(codes(`- principio ${firstPrinciple} | eligió: a | descartó: b | motivo: ${DECIDED}\n\n- excepción a principio ${firstPrinciple} | motivo: m | coste: c\n`), []);
});

// The forms the author reads in the PR template hint, filled with valid values, must pass the reader.
test('the two forms in the Decisions hint, filled in with valid values, have no faults', () => {
  const hint = SECTIONS.find((s) => s.name === 'Decisions').hint;
  const lines = [...hint.matchAll(/"(- [^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(lines, [FORMS.decision, FORMS.exception]);
  for (const form of lines) {
    let k = 0;
    const filled = form
      .replace(PRINCIPLE_PLACEHOLDER, String(firstPrinciple))
      .replace(`${CLASS_PLACEHOLDER} o ${DECIDED}`, DECIDED)
      .replace(/<[a-z]+>/g, () => `valor${k++}`);
    assert.deepEqual(decisionFaults(filled, rules), [], filled);
  }
  assert.ok(hint.includes(CLASS_PLACEHOLDER));
});

// [fault code, a content that must raise exactly that code]
const bad = [
  [DECISION_FAULTS.BAD_FORM, 'we chose a over b'],
  [DECISION_FAULTS.BAD_FORM, `- principio ${firstPrinciple} | eligió: a | descartó: b`],
  [DECISION_FAULTS.BAD_FORM, `- principio ${firstPrinciple} | descartó: b | eligió: a | motivo: ${DECIDED}`],
  [DECISION_FAULTS.BAD_FORM, `- excepción a principio ${firstPrinciple} | motivo: m`],
  [DECISION_FAULTS.UNKNOWN_PRINCIPLE, `- principio uno | eligió: a | descartó: b | motivo: ${DECIDED}`],
  [DECISION_FAULTS.UNKNOWN_PRINCIPLE, `- principio ${missingPrinciple} | eligió: a | descartó: b | motivo: ${DECIDED}`],
  [DECISION_FAULTS.UNKNOWN_PRINCIPLE, `- excepción a principio 0 | motivo: m | coste: c`],
  [DECISION_FAULTS.UNKNOWN_CLASS, `- principio ${firstPrinciple} | eligió: a | descartó: b | motivo: porque sí`],
  [DECISION_FAULTS.EMPTY_FIELD, `- principio ${firstPrinciple} | eligió: | descartó: b | motivo: ${DECIDED}`],
  [DECISION_FAULTS.EMPTY_FIELD, `- principio ${firstPrinciple} | eligió: a | descartó: b | motivo:`],
  [DECISION_FAULTS.EMPTY_FIELD, `- excepción a principio ${firstPrinciple} | motivo: m | coste:`],
  [DECISION_FAULTS.EMPTY_FIELD, `- excepción a principio ${firstPrinciple} | motivo: | coste: c`],
  [DECISION_FAULTS.NO_ALTERNATIVE, `- principio ${firstPrinciple} | eligió: a | descartó: | motivo: ${DECIDED}`],
  [DECISION_FAULTS.SAME_AS_CHOSEN, `- principio ${firstPrinciple} | eligió: a | descartó: a | motivo: ${DECIDED}`],
];

for (const [code, content] of bad) {
  test(`bad: ${code} for «${content}»`, () => {
    assert.deepEqual(codes(content), [code]);
  });
}

test('every fault code of the reader has a bad case here', () => {
  const covered = new Set(bad.map(([c]) => c));
  assert.deepEqual(Object.values(DECISION_FAULTS).filter((c) => !covered.has(c)), []);
});

test('a bad line among good ones is reported with its own line number', () => {
  const faults = decisionFaults(`- principio ${firstPrinciple} | eligió: a | descartó: b | motivo: ${DECIDED}\nfree text`, rules);
  assert.equal(faults.length, 1);
  assert.equal(faults[0].line, 2);
});

test('the real files: the principles are 1..n and the classes are the four of the closed list', () => {
  assert.deepEqual(rules.principles, rules.principles.map((_, i) => i + 1));
  assert.ok(rules.principles.length >= 1);
  assert.equal(rules.classes.length, CLASS_COUNT);
});

test('parsePrinciples fails loudly: no numbered line, a gap, a repeat', () => {
  assert.throws(() => parsePrinciples('Principios:\n- uno\n'), /no numbered principles/);
  assert.throws(() => parsePrinciples('1. a\n3. c\n'), /not numbered 1\.\.2 in order/);
  assert.throws(() => parsePrinciples('1. a\n1. b\n'), /not numbered/);
  assert.deepEqual(parsePrinciples('x\n1. a\n2. b\n\ny\n'), [1, 2]);
});

test('parseClasses fails loudly: no section, wrong count, a repeat', () => {
  const real = readFileSync(new URL(INTERVENTION_FILE, root), 'utf8');
  assert.deepEqual(parseClasses(real), rules.classes);
  assert.throws(() => parseClasses('# x\n'), /no "## Classes" section/);
  assert.throws(() => parseClasses('## Classes\n\n- **A**: x\n- **B**: y\n'), new RegExp(`expected ${CLASS_COUNT} classes.*found 2`));
  assert.throws(() => parseClasses('## Classes\n\n- **A**: x\n- **A**: x\n- **B**: y\n- **C**: z\n'), /repeated class: A/);
});
