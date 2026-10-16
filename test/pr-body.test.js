// The PR body check: pure function, command, and the template derived from SECTIONS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prBodyFaults, SECTIONS } from '../scripts/lib/pr-body.mjs';
import { run } from '../scripts/pr-body.mjs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const good = read('./fixtures/pr-body/good.md');
const template = read('../.github/pull_request_template.md');
const testFiles = ['test/x.test.js'];

const without = (name) => good.replace(new RegExp(`## ${name}\\n[\\s\\S]*?(?=\\n## |$)`), '');
const withSection = (name, content) => good.replace(new RegExp(`(## ${name}\\n)[\\s\\S]*?(?=\\n## |$)`), `$1${content}\n`);
const dir = mkdtempSync(join(tmpdir(), 'pr-body-'));
const tmp = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };

// [name, body, files, expected fault]
const mutations = [
  ['no What changes', without('What changes'), [], /missing section: ## What changes/],
  ['What changes only a comment', withSection('What changes', '<!-- later -->'), [], /empty section: ## What changes/],
  ['no Evidence', without('Evidence'), [], /missing section: ## Evidence/],
  ['Evidence without code block', withSection('Evidence', 'it works'), [], /Evidence needs a closed/],
  ['Evidence with empty block', withSection('Evidence', '```\n\n```'), [], /Evidence needs a closed/],
  ['Evidence block only inside a comment', withSection('Evidence', '<!--\n```\nx\n```\n-->'), [], /empty section: ## Evidence/],
  ['Evidence block never closed', '## What changes\n\nx\n\n## Not verified\n\nNothing\n\n## Evidence\n\n```\nx\n', [], /Evidence needs a closed/],
  ['no Not verified', without('Not verified'), [], /missing section: ## Not verified/],
  ['empty Not verified', withSection('Not verified', '   '), [], /empty section: ## Not verified/],
  ['test file, no Red before', without('Red before'), testFiles, /missing section: ## Red before/],
  ['test file, empty Red before', withSection('Red before', ''), testFiles, /empty section: ## Red before/],
  ['only a test/ path as previous_filename, no Red before', without('Red before'), ['scripts/a.mjs', 'test/old.js'], /missing section: ## Red before/],
  ['### Evidence', good.replace('## Evidence', '### Evidence'), [], /missing section: ## Evidence/],
  ['lowercase evidence', good.replace('## Evidence', '## evidence'), [], /missing section: ## Evidence/],
  ['Evidence twice', `${good}\n## Evidence\n\n\`\`\`\nx\n\`\`\`\n`, [], /duplicate section: ## Evidence/],
  ['empty string', '', [], /PR body is empty/],
  ['null', null, [], /PR body is empty/],
  ['undefined', undefined, [], /PR body is empty/],
];

for (const [name, body, files, expected] of mutations) {
  test(`prBodyFaults: ${name} is a fault`, () => {
    const faults = prBodyFaults(body, files);
    assert.ok(faults.some((f) => expected.test(f)), `got ${JSON.stringify(faults)}`);
  });
}

test('prBodyFaults: the good body has no faults', () => {
  assert.deepEqual(prBodyFaults(good, testFiles), []);
});

test('prBodyFaults: no test file, no Red before needed', () => {
  assert.deepEqual(prBodyFaults(without('Red before'), ['scripts/a.mjs']), []);
  assert.deepEqual(prBodyFaults(without('Red before'), ['test-support/a.mjs']), []);
});

test('prBodyFaults: files that is not an array throws', () => {
  assert.throws(() => prBodyFaults(good, null), /files must be an array/);
});

test('template: headings are exactly SECTIONS and the untouched template has 3 faults', () => {
  const headings = [...template.matchAll(/^## (.*)$/gm)].map((m) => m[1]);
  assert.deepEqual(headings, SECTIONS.map((s) => s.name));
  const faults = prBodyFaults(template, []);
  assert.equal(faults.length, 3);
  for (const name of ['What changes', 'Evidence', 'Not verified']) {
    assert.ok(faults.some((f) => f.includes(`## ${name}`)), `${name} not reported in ${JSON.stringify(faults)}`);
  }
});

function command(args) {
  const out = []; const err = [];
  const code = run(args, (l) => out.push(l), (l) => err.push(l));
  return { code, out, err };
}

test('command: good body with a files file exits 0 and prints ok', () => {
  const r = command(['--body-file', tmp('good.md', good), '--files-file', tmp('f.txt', 'test/x.test.js\n')]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, ['pr-body: ok']);
});

test('command: faults exit 1 and go to stderr', () => {
  const r = command(['--body-file', tmp('t.md', template), '--files-file', tmp('e.txt', '')]);
  assert.equal(r.code, 1);
  assert.equal(r.err.length, 3);
});

test('command: compare file reads filename and previous_filename', () => {
  const body = tmp('nored.md', without('Red before'));
  const cmp = tmp('c.json', JSON.stringify({ files: [{ filename: 'scripts/a.mjs', previous_filename: 'test/old.js' }] }));
  assert.equal(command(['--body-file', body, '--compare-file', cmp]).code, 1);
  const cmp2 = tmp('c2.json', JSON.stringify({ files: [{ filename: 'scripts/a.mjs' }] }));
  assert.equal(command(['--body-file', body, '--compare-file', cmp2]).code, 0);
});

test('command: bad input exits 1', () => {
  const body = tmp('b.md', good);
  const f = tmp('f2.txt', '');
  assert.equal(command(['--body-file', join(dir, 'missing.md'), '--files-file', f]).code, 1);
  assert.equal(command(['--body-file', body, '--compare-file', tmp('nofiles.json', '{}')]).code, 1);
  const many = { files: Array.from({ length: 300 }, (_, i) => ({ filename: `a${i}` })) };
  assert.equal(command(['--body-file', body, '--compare-file', tmp('many.json', JSON.stringify(many))]).code, 1);
  assert.equal(command(['--body-file', body, '--files-file', f, '--compare-file', tmp('c3.json', '{"files":[]}')]).code, 1);
  assert.equal(command(['--body-file', body]).code, 1);
});
