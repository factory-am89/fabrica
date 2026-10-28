// Shared test helpers for the tests that build throwaway git repos.
// Lives in test/apoyo/ with the other test helpers; node --test also runs it as a file, harmlessly (no side effects).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NOMBRE_FICHA } from '../../scripts/lib/repo-card.mjs';

// La ficha .fabrica.json de los repos de prueba: tarea y retire leen de ella la rama base.
export const FICHA_FABRICA = '{"repo":"factory-am89/fabrica","base":"main","identidad":"fabrica-constructor"}\n';

// Runs git and asserts it succeeded; returns trimmed stdout.
export const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

// <tmp>/fabrica with one commit on main, ready to get sibling folders. With `lockfile`, also a
// package.json and an empty package-lock.json so `npm ci` works offline.
export function repo({ lockfile = false } = {}) {
  const padre = realpathSync(mkdtempSync(path.join(tmpdir(), 'carpetas-')));
  const principal = path.join(padre, 'fabrica');
  mkdirSync(principal);
  git(principal, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false']]) git(principal, 'config', k, v);
  writeFileSync(path.join(principal, 'a.txt'), 'a\n');
  // la ficha: tarea y retire leen de ella la rama base (sin ficha fallan en alto)
  writeFileSync(path.join(principal, NOMBRE_FICHA), FICHA_FABRICA);
  git(principal, 'add', 'a.txt', NOMBRE_FICHA);
  if (lockfile) {
    writeFileSync(path.join(principal, 'package.json'), '{"name":"x","version":"1.0.0"}\n');
    writeFileSync(path.join(principal, 'package-lock.json'), '{"name":"x","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"x","version":"1.0.0"}}}\n');
    git(principal, 'add', 'package.json', 'package-lock.json');
  }
  git(principal, 'commit', '-q', '-m', 'inicial');
  return { padre, principal };
}
