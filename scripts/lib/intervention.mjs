// The closed list of paths that wait for Pablo lives in standards/intervention.md (one place).
// This module reads it: parseClosedPaths fails loudly when the block is missing or malformed,
// and touchesClosedList says whether a changed file meets it.
import { readFileSync } from 'node:fs';

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

const escapeChar = (s) => s.replace(/[.+^${}()|[\]\\]/g, (c) => `\\${c}`);
const toRegExp = (glob) => new RegExp(`^${glob.split('**').map((part) => part.split('*').map(escapeChar).join('[^/]*')).join('.*')}$`);

export function touchesClosedList(file, globs) {
  return globs.some((g) => toRegExp(g).test(file));
}

export function loadClosedPaths(root = new URL('../../', import.meta.url)) {
  return parseClosedPaths(readFileSync(new URL(INTERVENTION_FILE, root), 'utf8'));
}
