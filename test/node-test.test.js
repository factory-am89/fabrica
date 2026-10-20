// scripts/lib/node-test.mjs copies the patterns of `node --test` from the Node documentation. This test ties the copy to the
// real runner: it writes a temp folder (in the OS tmpdir) of files that each log their own name, runs the real `node --test`
// there and compares the files that ran with what collectedByNodeTest answers for each one. No network, no clock.
// It covers every pattern, every extension, the nested case, node_modules and hidden names, and the refusal of a bad path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectedByNodeTest } from '../scripts/lib/node-test.mjs';

const LOG_VARIABLE = 'FABRICA_NODE_TEST_LOG';
// Each candidate carries its reason: one per pattern (and extension), then the ones that must NOT run.
const RUN = [
  'a.test.js', 'b.test.mjs', 'c.test.cjs', 'd.test.ts', 'e.test.mts', 'f.test.cts', // **/*.test.?(c|m)[jt]s
  'g-test.js', 'h_test.js', 'test-i.js', 'test.js', 'sub/test.mjs', 'sub/deep/j.test.js', 'sub/test-y.mts', // the other four, also nested
  'test/k.js', 'test/deep/l.cjs', 'test/m.ts', 'src/test/w.mjs', // **/test/**/*
];
const SKIP = [
  'test/n.txt', 'test/o.json', 'test/.p.js', 'foo.spec.js', 'tests/q.js', 'lib/r.js', 'a.test.jsx', 'xtest.js', 'mytest.js', 'test-x.txt', 'test.json',
  '.hid/s.test.js', '.hid/test/t.js', 'node_modules/t/u.test.js', 'node_modules/test/v.js',
];
const LOGGER = (rel) => `process.getBuiltinModule('node:fs').appendFileSync(process.env.${LOG_VARIABLE}, ${JSON.stringify(rel + '\n')});\n`;

function runInTempFolder(t, files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fabrica-node-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const rel of files) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), LOGGER(rel));
  }
  const log = path.join(dir, '..', `${path.basename(dir)}.log`);
  t.after(() => rmSync(log, { force: true }));
  writeFileSync(log, '');
  const env = { ...process.env, [LOG_VARIABLE]: log };
  delete env.NODE_TEST_CONTEXT; // inside `node --test` this makes a child run behave as a worker, not as a runner
  const r = spawnSync(process.execPath, ['--test'], { cwd: dir, env, encoding: 'utf8', timeout: 120_000 });
  assert.equal(r.error, undefined, String(r.error));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return readFileSync(log, 'utf8').split('\n').filter(Boolean).sort();
}

test('the copied patterns pick exactly the files the real `node --test` runs', (t) => {
  const ran = runInTempFolder(t, [...RUN, ...SKIP]);
  assert.deepEqual(ran, [...RUN].sort(), 'the real runner ran a different set than the one the reasons above expect');
  assert.deepEqual([...RUN, ...SKIP].filter(collectedByNodeTest).sort(), ran);
});

test('collectedByNodeTest refuses what is not a relative path with "/"', () => {
  for (const bad of ['', 'a\\b.test.js', '/abs/a.test.js', undefined, 7]) {
    assert.throws(() => collectedByNodeTest(bad), /must be a relative path with "\/"/, String(bad));
  }
});
