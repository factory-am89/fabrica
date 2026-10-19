// The only reader of a decision line (the PR body section "Decisions" now; the plans later). The two forms are
// written once, in FORM_SPECS; FORMS, the parser and every message derive from it (see FORMS below).
// It checks existence and form, not whether the citation fits. The principles are the numbered lines of
// CLAUDE.md and the classes are the four of standards/intervention.md; both are read, never copied here, and
// a file that no longer has the expected shape fails loudly (principle 3).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadClasses, defaultRoot } from './intervention.mjs';

export const DECISION_FAULTS = Object.freeze(
  Object.fromEntries([
    'BAD_FORM',
    'UNKNOWN_PRINCIPLE',
    'UNKNOWN_CLASS',
    'EMPTY_FIELD',
    'NO_ALTERNATIVE',
    'SAME_AS_CHOSEN',
  ].map((c) => [c, c])),
);

export const PRINCIPLES_FILE = 'CLAUDE.md';
export const DECIDED = 'decidido';
export const NONE = /^None\.?$/;

// The only place that says what a decision line looks like: its head and its fields in order, each with the
// placeholder shown in the form. `placeholder` is what the author replaces; a decision's motivo is a class or DECIDED.
export const CLASS_PLACEHOLDER = '<class>';
export const FORM_SPECS = Object.freeze({
  decision: { head: 'principio', fields: [['eligió', '<x>'], ['descartó', '<y>'], ['motivo', `${CLASS_PLACEHOLDER} o ${DECIDED}`]] },
  exception: { head: 'excepción a principio', fields: [['motivo', '<text>'], ['coste', '<text>']] },
});
export const FIELD_SEPARATOR = ' | ';
export const PRINCIPLE_PLACEHOLDER = '<n>';
const formOf = ({ head, fields }) => [`- ${head} ${PRINCIPLE_PLACEHOLDER}`, ...fields.map(([label, ph]) => `${label}: ${ph}`)].join(FIELD_SEPARATOR);
export const FORMS = Object.freeze({ decision: formOf(FORM_SPECS.decision), exception: formOf(FORM_SPECS.exception) });

// Principles are the lines "<n>. text" of CLAUDE.md, and they must be numbered 1..k with no gap.
export function parsePrinciples(text) {
  const numbers = text.split(/\r?\n/).map((l) => /^(\d+)\. \S/.exec(l)?.[1]).filter(Boolean).map(Number);
  if (numbers.length === 0) throw new Error(`decision: no numbered principles ("1. text") found in ${PRINCIPLES_FILE}`);
  numbers.forEach((n, i) => {
    if (n !== i + 1) throw new Error(`decision: the principles of ${PRINCIPLES_FILE} are not numbered 1..${numbers.length} in order (found ${numbers.join(', ')})`);
  });
  return numbers;
}

export function loadPrinciples(root = defaultRoot()) {
  return parsePrinciples(readFileSync(path.join(root, PRINCIPLES_FILE), 'utf8'));
}

export function loadRules(root = defaultRoot()) {
  return { principles: loadPrinciples(root), classes: loadClasses(root) };
}

const fault = (code, line, message) => ({ code, line, message });

// parts[i] must read "<label>: <value>"; returns the value, or null when the label is not that one.
function field(part, label) {
  const prefix = `${label}:`;
  return part.startsWith(prefix) ? part.slice(prefix.length).trim() : null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HEAD = new RegExp(`^- (${Object.values(FORM_SPECS).map((s) => escapeRe(s.head)).join('|')}) (\\S+)$`);
const [CHOSE, DISCARDED, REASON] = FORM_SPECS.decision.fields.map(([label]) => label);

function lineFaults(raw, n, { principles, classes }) {
  const parts = raw.split(FIELD_SEPARATOR).map((p) => p.trim());
  const head = HEAD.exec(parts[0]);
  const isException = head?.[1] === FORM_SPECS.exception.head;
  const labels = (isException ? FORM_SPECS.exception : FORM_SPECS.decision).fields.map(([label]) => label);
  const values = labels.map((l, i) => (parts[i + 1] === undefined ? null : field(parts[i + 1], l)));
  if (!head || parts.length !== labels.length + 1 || values.includes(null)) {
    return [fault(DECISION_FAULTS.BAD_FORM, n, `not a decision line; expected "${FORMS.decision}" or "${FORMS.exception}"`)];
  }
  const out = [];
  if (!/^\d+$/.test(head[2]) || !principles.includes(Number(head[2]))) {
    out.push(fault(DECISION_FAULTS.UNKNOWN_PRINCIPLE, n, `principle ${head[2]} is not one of the numbered principles of ${PRINCIPLES_FILE} (1 to ${principles.length})`));
  }
  const empty = labels.filter((_, i) => values[i] === '');
  for (const l of empty) {
    if (!isException && l === DISCARDED) out.push(fault(DECISION_FAULTS.NO_ALTERNATIVE, n, `${DISCARDED} is empty; a decision names what was discarded`));
    else out.push(fault(DECISION_FAULTS.EMPTY_FIELD, n, `${l} is empty`));
  }
  if (!isException) {
    const [chose, discarded, reason] = values;
    if (discarded !== '' && discarded === chose) out.push(fault(DECISION_FAULTS.SAME_AS_CHOSEN, n, `${DISCARDED} is the same as ${CHOSE}`));
    if (reason !== '' && reason !== DECIDED && !classes.includes(reason)) {
      out.push(fault(DECISION_FAULTS.UNKNOWN_CLASS, n, `${REASON} must be ${DECIDED} or one of the closed-list classes: ${classes.join(', ')}`));
    }
  }
  return out;
}

// content: the text of the section. "None" is valid; otherwise every non-empty line must be a valid decision line.
// Returns [{ code, line, message }]. rules: { principles, classes }, read from the repo when not given.
export function decisionFaults(content, rules = loadRules()) {
  const lines = String(content).split(/\r?\n/);
  if (NONE.test(content.trim())) return [];
  return lines.flatMap((raw, i) => (raw.trim() === '' ? [] : lineFaults(raw.trim(), i + 1, rules)));
}
