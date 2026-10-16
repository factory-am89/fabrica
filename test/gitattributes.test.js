// intervenciones.md only ever gets lines appended: merge=union keeps both sides' lines instead of a conflict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ATRIBUTOS = readFileSync(path.join(RAIZ, '.gitattributes'), 'utf8');

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const ok = (cwd, ...args) => {
  const r = git(cwd, ...args);
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stdout}${r.stderr}`);
  return r;
};

test('two branches appending a row to intervenciones.md merge without conflict', (t) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'gitattributes-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  ok(dir, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) ok(dir, 'config', k, v);
  writeFileSync(path.join(dir, '.gitattributes'), ATRIBUTOS);
  writeFileSync(path.join(dir, 'intervenciones.md'), 'fila 1\nfila 2\n');
  ok(dir, 'add', '.');
  ok(dir, 'commit', '-q', '-m', 'base');
  for (const n of ['a', 'b']) {
    ok(dir, 'checkout', '-q', '-b', n, 'main');
    writeFileSync(path.join(dir, 'intervenciones.md'), `fila 1\nfila 2\nfila ${n}\n`);
    ok(dir, 'commit', '-q', '-am', n);
  }
  ok(dir, 'checkout', '-q', 'a');
  const r = git(dir, 'merge', '--no-edit', 'b');
  assert.equal(r.status, 0, `merge conflicted: ${r.stdout}${r.stderr}`);
  const lineas = readFileSync(path.join(dir, 'intervenciones.md'), 'utf8').split('\n');
  assert.ok(lineas.includes('fila a') && lineas.includes('fila b'), lineas.join('|'));
  assert.ok(!lineas.some((l) => l.startsWith('<<<<<<<')));
});

test('package.json never uses merge=union (union would corrupt JSON)', () => {
  assert.ok(!/^package\.json\s.*merge=union/m.test(ATRIBUTOS));
  assert.ok(!/^\*\s.*merge=union/m.test(ATRIBUTOS));
});
