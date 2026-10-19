// The closed list of paths that wait for Pablo lives in standards/intervention.md (one place).
// This module reads it: parseClosedPaths fails loudly when the block is missing or malformed,
// and touchesClosedList says whether a changed file meets it.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FENCE = /^```closed-paths[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;
const GLOB = /^[A-Za-z0-9_.\-/*]+$/;

export const INTERVENTION_FILE = 'standards/intervention.md';

export function parseClosedPaths(text) {
  const blocks = [...text.matchAll(FENCE)];
  if (blocks.length !== 1) throw new Error(`intervention: expected exactly one closed-paths block, found ${blocks.length}`);
  const lines = blocks[0][1].split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error('intervention: the closed-paths block is empty');
  for (const line of lines) {
    if (!GLOB.test(line) || line.startsWith('/') || line.split('/').includes('..')) throw new Error(`intervention: not a relative glob: ${line}`);
  }
  const repeated = lines.find((l, i) => lines.indexOf(l) !== i);
  if (repeated) throw new Error(`intervention: repeated glob: ${repeated}`);
  return lines;
}

// The four classes of the closed list are bold bullets under "## Classes"; this is their only reader.
// Anything but exactly CLASS_COUNT of them fails loudly: a change to the list is a change to the closed list.
export const CLASS_COUNT = 4;
const CLASSES_SECTION = /^## Classes[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m;
const CLASS_BULLET = /^- \*\*([^*]+)\*\*:/;

export function parseClasses(text) {
  const section = CLASSES_SECTION.exec(text);
  if (!section) throw new Error('intervention: no "## Classes" section');
  const names = section[1].split(/\r?\n/).map((l) => CLASS_BULLET.exec(l)?.[1].trim()).filter(Boolean);
  if (names.length !== CLASS_COUNT) throw new Error(`intervention: expected ${CLASS_COUNT} classes under "## Classes", found ${names.length}`);
  const repeated = names.find((n, i) => names.indexOf(n) !== i);
  if (repeated) throw new Error(`intervention: repeated class: ${repeated}`);
  return names;
}

const escapeChar =(s) => s.replace(/[.+^${}()|[\]\\]/g, (c) => `\\${c}`);
const toRegExp = (glob) => new RegExp(`^${glob.split('**').map((part) => part.split('*').map(escapeChar).join('[^/]*')).join('.*')}$`);

export function touchesClosedList(file, globs) {
  return globs.some((g) => toRegExp(g).test(file));
}

// The root is built from a path, not from a URL relative to this file: test/gate-files.test.js reads that as an import.
export function loadClasses(root = path.resolve(import.meta.dirname, '..', '..')) {
  return parseClasses(readFileSync(path.join(root, INTERVENTION_FILE), 'utf8'));
}

export function loadClosedPaths(root = path.resolve(import.meta.dirname, '..', '..')) {
  return parseClosedPaths(readFileSync(path.join(root, INTERVENTION_FILE), 'utf8'));
}
