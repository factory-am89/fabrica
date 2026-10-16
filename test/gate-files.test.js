// GATE_FILES must equal what the two gate workflows use from .fabrica/ (plus the workflows
// themselves), following imports. The expected set is derived from the workflows, not copied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { GATE_FILES } from '../scripts/lib/gate.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const WORKFLOWS = ['.github/workflows/revisor.yml', '.github/workflows/tests.yml'];

function strings(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (node && typeof node === 'object') for (const v of Object.values(node)) strings(v, out);
  return out;
}

// Every string of the parsed workflow (run, env, with, claude_args, prompt...) is scanned.
// `npm ... --prefix .fabrica` means the package files of the repo are used.
function fabricaPaths(workflowText) {
  const found = new Set();
  for (const s of strings(yaml.load(workflowText))) {
    for (const m of s.matchAll(/\.fabrica\/([\w./-]*[\w-])/g)) {
      if (!m[1].startsWith('node_modules/')) found.add(m[1]);
    }
    if (/\bnpm\b[^\n]*--prefix \.fabrica\b/.test(s)) found.add('package.json').add('package-lock.json');
  }
  return [...found];
}

// Relative references of a source file: static imports (also multi-line), dynamic import() and new URL().
function relativeRefs(src) {
  const refs = [];
  const patterns = [/\bfrom\s*['"](\.[^'"]+)['"]/g, /\bimport\s*\(\s*['"](\.[^'"]+)['"]/g, /\bimport\s+['"](\.[^'"]+)['"]/g, /new URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url/g];
  for (const re of patterns) for (const m of src.matchAll(re)) refs.push(m[1]);
  return refs;
}

function withReferences(rel, seen = new Set()) {
  if (seen.has(rel)) return seen;
  seen.add(rel);
  if (!/\.m?js$/.test(rel)) return seen;
  const src = readFileSync(path.join(ROOT, rel), 'utf8');
  for (const r of relativeRefs(src)) withReferences(path.posix.join(path.posix.dirname(rel), r), seen);
  return seen;
}

function expected() {
  const needed = new Set();
  for (const w of WORKFLOWS) {
    for (const p of [w, ...fabricaPaths(readFileSync(path.join(ROOT, w), 'utf8'))]) {
      for (const f of withReferences(p)) needed.add(f);
    }
  }
  return needed;
}

test('every GATE_FILES path exists and there are no duplicates', () => {
  assert.ok(GATE_FILES.length > 0);
  assert.equal(new Set(GATE_FILES).size, GATE_FILES.length, 'duplicates in GATE_FILES');
  for (const f of GATE_FILES) assert.ok(existsSync(path.join(ROOT, f)), `${f} does not exist`);
});

test('GATE_FILES is exactly what the workflows use, with imports', () => {
  const needed = expected();
  for (const f of needed) assert.ok(GATE_FILES.includes(f), `${f} is used by the gate but not in GATE_FILES`);
  for (const f of GATE_FILES) assert.ok(needed.has(f), `${f} is in GATE_FILES but nothing in the gate uses it`);
});

test('fabricaPaths: finds paths in run, env, with and claude_args (good), nothing in a plain workflow (bad)', () => {
  const con = [
    'jobs:', '  a:', '    steps:',
    '      - run: node .fabrica/scripts/x.mjs && .fabrica/node_modules/.bin/eslint',
    '        env:', '          P: .fabrica/e/env.txt',
    '      - uses: y@z', '        with:', '          prompt: lee .fabrica/estandares/c.md (ok)',
    '          claude_args: --x .fabrica/a/args.json',
    '      - run: npm ci --prefix .fabrica',
  ].join('\n');
  assert.deepEqual(fabricaPaths(con).sort(), ['a/args.json', 'e/env.txt', 'estandares/c.md', 'package-lock.json', 'package.json', 'scripts/x.mjs']);
  assert.deepEqual(fabricaPaths('jobs:\n  a:\n    steps:\n      - run: echo hola\n'), []);
});

test('relativeRefs: static (also multi-line), dynamic and new URL references (good), packages ignored (bad)', () => {
  const src = "import a from './a.mjs';\nimport {\n  b,\n} from '../b.js';\nconst c = await import('./c.mjs');\nconst d = new URL('../d.md', import.meta.url);\nimport x from 'node:fs';\nimport y from 'js-yaml';\n";
  assert.deepEqual(relativeRefs(src).sort(), ['../b.js', '../d.md', './a.mjs', './c.mjs']);
});
