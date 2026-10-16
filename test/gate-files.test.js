// GATE_FILES must exist and must cover everything revisor.yml downloads or runs from .fabrica/,
// including the relative imports of those scripts. The expected set is derived from the workflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { GATE_FILES } from '../scripts/lib/gate.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

// Every `.fabrica/<path>` mentioned in the run commands and prompts of the workflow's steps.
function fabricaPaths(workflowText) {
  const doc = yaml.load(workflowText);
  const found = new Set();
  for (const job of Object.values(doc.jobs)) {
    for (const step of job.steps) {
      for (const text of [step.run, step.with?.prompt]) {
        for (const m of String(text ?? '').matchAll(/\.fabrica\/([\w./-]*[\w-])/g)) found.add(m[1]);
      }
    }
  }
  return [...found];
}

// Relative static imports of a script, followed recursively.
function withImports(rel, seen = new Set()) {
  if (seen.has(rel)) return seen;
  seen.add(rel);
  if (!rel.endsWith('.mjs')) return seen;
  const src = readFileSync(path.join(ROOT, rel), 'utf8');
  for (const m of src.matchAll(/^import .* from '(\.[^']+)';/gm)) {
    withImports(path.posix.join(path.posix.dirname(rel), m[1]), seen);
  }
  return seen;
}

test('every GATE_FILES path exists', () => {
  assert.ok(GATE_FILES.length > 0);
  for (const f of GATE_FILES) assert.ok(existsSync(path.join(ROOT, f)), `${f} does not exist`);
});

test('GATE_FILES has no duplicates', () => {
  assert.equal(new Set(GATE_FILES).size, GATE_FILES.length);
});

test('GATE_FILES covers what revisor.yml takes from .fabrica/ and its imports', () => {
  const text = readFileSync(path.join(ROOT, '.github/workflows/revisor.yml'), 'utf8');
  const taken = fabricaPaths(text);
  assert.ok(taken.length >= 3, `expected the workflow to use several .fabrica/ files, got ${taken}`);
  const needed = new Set();
  for (const t of taken) for (const f of withImports(t)) needed.add(f);
  for (const f of needed) assert.ok(GATE_FILES.includes(f), `${f} is used by revisor.yml but not in GATE_FILES`);
});

test('fabricaPaths: a workflow that uses .fabrica/ files yields them (good) and one that does not yields none (bad)', () => {
  const con = 'jobs:\n  a:\n    steps:\n      - run: node .fabrica/scripts/x.mjs\n      - uses: y@z\n        with:\n          prompt: lee .fabrica/estandares/c.md (ok)\n';
  assert.deepEqual(fabricaPaths(con).sort(), ['estandares/c.md', 'scripts/x.mjs']);
  assert.deepEqual(fabricaPaths('jobs:\n  a:\n    steps:\n      - run: echo hola\n'), []);
});
