// The closed list (standards/intervention.md): parser good/bad cases, the matcher, and the link from CLAUDE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseClosedPaths, touchesClosedList, loadClosedPaths, INTERVENTION_FILE } from '../scripts/lib/intervention.mjs';

const block = (body) => `intro\n\n\`\`\`closed-paths\n${body}\n\`\`\`\n`;

test('parseClosedPaths: one block with globs, one per line (good)', () => {
  assert.deepEqual(parseClosedPaths(block('a/**\nb.md\n')), ['a/**', 'b.md']);
  assert.deepEqual(parseClosedPaths(block('a/**\r\nb.md').replace(/\n/g, '\r\n')), ['a/**', 'b.md']);
});

test('parseClosedPaths: missing, empty, two blocks, not a glob, absolute, parent, repeated all fail (bad)', () => {
  const bad = {
    missing: 'no block here',
    empty: block('\n'),
    two: block('a') + block('b'),
    prose: block('apps and more'),
    absolute: block('/etc/**'),
    parent: block('../x'),
    repeated: block('a\na'),
  };
  for (const [name, text] of Object.entries(bad)) assert.throws(() => parseClosedPaths(text), /intervention:/, name);
});

test('touchesClosedList: * stays inside a folder, ** crosses folders, exact names are exact', () => {
  assert.equal(touchesClosedList('apps/ruleset.ps1', ['apps/**']), true);
  assert.equal(touchesClosedList('apps/x/y.html', ['apps/**']), true);
  assert.equal(touchesClosedList('apps', ['apps/**']), false);
  assert.equal(touchesClosedList('x/CLAUDE.md', ['CLAUDE.md']), false);
  assert.equal(touchesClosedList('CLAUDE.md', ['CLAUDE.md']), true);
  assert.equal(touchesClosedList('a/b/c.js', ['a/*']), false);
  assert.equal(touchesClosedList('a/c.js', ['a/*']), true);
  assert.equal(touchesClosedList('aXmd', ['a.md']), false, 'a dot is a dot, not any character');
});

test('the real file parses and CLAUDE.md links it (one idea, one place)', () => {
  assert.ok(loadClosedPaths().length > 0);
  const claude = readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8');
  assert.ok(claude.includes(INTERVENTION_FILE), `CLAUDE.md must link ${INTERVENTION_FILE}`);
});
