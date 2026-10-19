// tests.yml aplica el eslint.config.js de la Fábrica al repo que lo llama (con la Fábrica bajada en
// `.fabrica/` dentro de él). Aquí se reproduce esa orden sobre una carpeta temporal que hace de llamador:
// la regla vale también fuera de la Fábrica y no lee la Fábrica bajada como si fuera código suyo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const FABRICA = path.resolve(import.meta.dirname, '..');
const ESLINT = path.join(FABRICA, 'node_modules', 'eslint', 'bin', 'eslint.js');

function lintDeLlamador(ficheros) {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'llamador-'));
  try {
    for (const [ruta, texto] of Object.entries(ficheros)) {
      mkdirSync(path.dirname(path.join(carpeta, ruta)), { recursive: true });
      writeFileSync(path.join(carpeta, ruta), texto);
    }
    return spawnSync(process.execPath, [ESLINT, '--config', path.join(FABRICA, 'eslint.config.js'), '.', '--max-warnings', '0'], { cwd: carpeta, encoding: 'utf8' });
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
}

const limpio = 'export const dos = () => 2;\n';
const funcionLarga = `export function larga() {\n${'  console.log(1);\n'.repeat(101)}}\n`;

test('el lint de la Fábrica pasa un repo limpio e ignora la Fábrica bajada en .fabrica/', () => {
  const r = lintDeLlamador({ 'src.mjs': limpio, '.fabrica/malo.js': 'var x = 1; if (x == 1) {}\n' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});

test('el lint de la Fábrica falla en el repo que llama: función de más de 100 líneas, == y variables sin usar', () => {
  const larga = lintDeLlamador({ 'larga.mjs': funcionLarga });
  assert.equal(larga.status, 1, larga.stderr);
  assert.match(larga.stdout, /max-lines-per-function/);
  const igual = lintDeLlamador({ 'a.mjs': 'export const f = (a) => a == 1;\n' });
  assert.equal(igual.status, 1);
  assert.match(igual.stdout, /eqeqeq/);
  const sinUsar = lintDeLlamador({ 'b.mjs': 'const x = 1;\n' });
  assert.equal(sinUsar.status, 1);
  assert.match(sinUsar.stdout, /no-unused-vars/);
});
