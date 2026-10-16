// La capa de usuario: instalar copia usuario/ a ~/.claude/, la segunda vez no cambia nada y
// un cambio a mano hace salir a comprobar-pc con 1 nombrando el fichero. Siempre con un HOME temporal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HUELLA, instalar, comprobar } from '../scripts/instalar-pc.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'instalar-pc.mjs');

const nuevoHome = () => mkdtempSync(path.join(tmpdir(), 'instalar-pc-'));
const pc = (home, orden) => spawnSync('node', [SCRIPT, orden], { env: { ...process.env, FABRICA_HOME: home }, encoding: 'utf8' });
const claude = (home, ...r) => path.join(home, '.claude', ...r);

test('instalar copia CLAUDE.md y apunta la huella', () => {
  const home = nuevoHome();
  const r = pc(home, 'instalar');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(claude(home, 'CLAUDE.md'), 'utf8'), readFileSync(path.join(RAIZ, 'usuario', 'CLAUDE.md'), 'utf8'));
  const huella = JSON.parse(readFileSync(claude(home, HUELLA), 'utf8'));
  assert.deepEqual(Object.keys(huella), ['CLAUDE.md']);
  assert.equal(pc(home, 'comprobar').status, 0);
});

test('la segunda vez no cambia nada', () => {
  const home = nuevoHome();
  pc(home, 'instalar');
  const ficheros = ['CLAUDE.md', HUELLA];
  const mtimes = () => Object.fromEntries(ficheros.map((f) => [f, statSync(claude(home, f)).mtimeMs]));
  const antes = mtimes();
  const r = pc(home, 'instalar');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /sin cambios/);
  assert.deepEqual(mtimes(), antes);
});

test('un cambio a mano en destino hace salir a comprobar con 1 y el nombre del fichero', () => {
  const home = nuevoHome();
  pc(home, 'instalar');
  writeFileSync(claude(home, 'CLAUDE.md'), '# tocado a mano\n');
  const r = pc(home, 'comprobar');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /CLAUDE\.md editado-a-mano/);
});

test('un fichero que falta se nombra, y reinstalar sobrescribe lo editado y lo deja igual', () => {
  const home = nuevoHome();
  const r0 = pc(home, 'comprobar');
  assert.equal(r0.status, 1);
  assert.match(r0.stderr, /CLAUDE\.md falta/);
  pc(home, 'instalar');
  writeFileSync(claude(home, 'CLAUDE.md'), 'a mano\n');
  const r = pc(home, 'instalar');
  assert.match(r.stdout, /CLAUDE\.md \(editado-a-mano\)/);
  assert.equal(pc(home, 'comprobar').status, 0);
});

test('instalar no escribe nada fuera de lo que hay en usuario/ y la huella (ni settings.json ni memorias)', () => {
  const home = nuevoHome();
  pc(home, 'instalar');
  assert.deepEqual(readdirSync(claude(home)).sort(), ['CLAUDE.md', HUELLA]);
  assert.equal(existsSync(claude(home, 'settings.json')), false);
});

test('el mecanismo sirve para subcarpetas (hooks/) cuando usuario/ las tenga', () => {
  const home = nuevoHome();
  const origen = mkdtempSync(path.join(tmpdir(), 'origen-pc-'));
  mkdirSync(path.join(origen, 'hooks'));
  writeFileSync(path.join(origen, 'hooks', 'h.mjs'), 'a\n');
  assert.deepEqual(instalar({ home, origen }).map((c) => c.fichero), ['hooks/h.mjs']);
  assert.deepEqual(comprobar({ home, origen }), []);
  writeFileSync(claude(home, 'hooks', 'h.mjs'), 'b\n');
  assert.deepEqual(comprobar({ home, origen }).map((c) => `${c.fichero} ${c.estado}`), ['hooks/h.mjs editado-a-mano']);
});
