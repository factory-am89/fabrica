// The only reader of a decision line (the PR body section "Decisions" now; the plans later). Two forms:
//   - principio <n> | eligió: <x> | descartó: <y> | motivo: <class of the closed list> o decidido
//   - excepción a principio <n> | motivo: <text> | coste: <text>
// It checks existence and form, not whether the citation fits. The principles are the numbered lines of
// CLAUDE.md and the classes are the four of standards/intervention.md; both are read, never copied here, and
// a file that no longer has the expected shape fails loudly (principle 3).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadClasses } from './intervention.mjs';

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

// Principles are the lines "<n>. text" of CLAUDE.md, and they must be numbered 1..k with no gap.
export function parsePrinciples(text) {
  const numbers = text.split(/\r?\n/).map((l) => /^(\d+)\. \S/.exec(l)?.[1]).filter(Boolean).map(Number);
  if (numbers.length === 0) throw new Error(`decision: no numbered principles ("1. text") found in ${PRINCIPLES_FILE}`);
  numbers.forEach((n, i) => {
    if (n !== i + 1) throw new Error(`decision: the principles of ${PRINCIPLES_FILE} are not numbered 1..${numbers.length} in order (found ${numbers.join(', ')})`);
  });
  return numbers;
}

const defaultRoot = () => path.resolve(import.meta.dirname, '..', '..');

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

function lineFaults(raw, n, { principles, classes }) {
  const parts = raw.split(' | ').map((p) => p.trim());
  const head = /^- (principio|excepción a principio) (\S+)$/.exec(parts[0]);
  const isException = head?.[1] === 'excepción a principio';
  const labels = isException ? ['motivo', 'coste'] : ['eligió', 'descartó', 'motivo'];
  const values = labels.map((l, i) => (parts[i + 1] === undefined ? null : field(parts[i + 1], l)));
  if (!head || parts.length !== labels.length + 1 || values.includes(null)) {
    return [fault(DECISION_FAULTS.BAD_FORM, n, `not a decision line; expected "- principio <n> | eligió: <x> | descartó: <y> | motivo: <class> o ${DECIDED}" or "- excepción a principio <n> | motivo: <text> | coste: <text>"`)];
  }
  const out = [];
  if (!/^\d+$/.test(head[2]) || !principles.includes(Number(head[2]))) {
    out.push(fault(DECISION_FAULTS.UNKNOWN_PRINCIPLE, n, `principle ${head[2]} is not one of the numbered principles of ${PRINCIPLES_FILE} (1 to ${principles.length})`));
  }
  const empty = labels.filter((_, i) => values[i] === '');
  for (const l of empty) {
    if (l === 'descartó') out.push(fault(DECISION_FAULTS.NO_ALTERNATIVE, n, 'descartó is empty; a decision names what was discarded'));
    else out.push(fault(DECISION_FAULTS.EMPTY_FIELD, n, `${l} is empty`));
  }
  if (!isException) {
    const [chose, discarded, reason] = values;
    if (discarded !== '' && discarded === chose) out.push(fault(DECISION_FAULTS.SAME_AS_CHOSEN, n, 'descartó is the same as eligió'));
    if (reason !== '' && reason !== DECIDED && !classes.includes(reason)) {
      out.push(fault(DECISION_FAULTS.UNKNOWN_CLASS, n, `motivo must be ${DECIDED} or one of the closed-list classes: ${classes.join(', ')}`));
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
