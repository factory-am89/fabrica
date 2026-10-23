// Ningún script escribe .git/FETCH_HEAD de la carpeta principal: pull lo lee y cualquier fetch lo pisa, así que un fetch ajeno
// rompe el `git pull` de otra sesión. Los scripts traen con `--no-write-fetch-head` y leen `origin/main`, nunca FETCH_HEAD.
// Test estático: recorre scripts/**/*.mjs y usuario/hooks/*.mjs y busca llamadas de git con el verbo en el argv (`['fetch', ...]`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIN_ESCRIBIR = '--no-write-fetch-head';

// Excepciones: ruta -> motivo. Un fetch sin la opción solo vale aquí, y el motivo es la condición que lo hace inocuo.
const EXCEPCIONES = new Map([
  ['usuario/hooks/limpiar-worktrees.mjs', 'su `git fetch -q --prune origin` solo corre en repos sin ficha (.fabrica.json); en un repo de la Fábrica el hook sale antes de llamar a git, así que no pisa el FETCH_HEAD de ninguna carpeta principal con ficha.'],
]);

// Un argv de git: un array literal cuyo primer elemento sin flags es el verbo, p. ej. ['fetch', 'origin'] o ['-C', x, 'pull'].
// Antes del verbo solo caben flags entre comillas ('-C') o nombres sueltos (el valor de -C); otro texto entre comillas no es un verbo de git.
const ARGV = /\[((?:\s*(?:["'`]-[^"'`\n]*["'`]|[\w.$()]+)\s*,)*?)\s*(["'`])(fetch|pull)\2([^\]]*)\]/g;

// Devuelve los fallos de un texto: cada llamada a pull, y cada fetch sin la opción (salvo en una ruta con excepción).
export function llamadasProhibidas(texto, ruta) {
  const fallos = [];
  for (const m of texto.matchAll(ARGV)) {
    const linea = texto.slice(0, m.index).split('\n').length;
    if (m[3] === 'pull') fallos.push(`${ruta}:${linea}: git pull lee y escribe FETCH_HEAD; usa fetch ${SIN_ESCRIBIR} y merge --ff-only`);
    else if (!m[0].includes(SIN_ESCRIBIR) && !EXCEPCIONES.has(ruta)) fallos.push(`${ruta}:${linea}: git fetch sin ${SIN_ESCRIBIR}`);
  }
  return fallos;
}

function ficheros(dir, recursivo) {
  const salida = [];
  for (const e of readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory() && recursivo) salida.push(...ficheros(rel, true));
    else if (e.isFile() && e.name.endsWith('.mjs')) salida.push(rel);
  }
  return salida;
}

test('ningún script ni hook de usuario hace pull ni fetch que escriba FETCH_HEAD', () => {
  const todos = [...ficheros('scripts', true), ...ficheros('usuario/hooks', false)];
  assert.ok(todos.includes('scripts/tarea.mjs') && todos.includes('usuario/hooks/limpiar-worktrees.mjs'), 'el recorrido no encuentra los ficheros esperados');
  const fallos = todos.flatMap((f) => llamadasProhibidas(readFileSync(path.join(RAIZ, f), 'utf8'), f));
  assert.deepEqual(fallos, []);
});

test('las llamadas que sí traen de verdad existen (el buscador no está ciego)', () => {
  const cuenta = (f) => [...readFileSync(path.join(RAIZ, f), 'utf8').matchAll(ARGV)].length;
  for (const f of ['scripts/tarea.mjs', 'scripts/retire.mjs', 'scripts/pull-main.mjs', 'usuario/hooks/limpiar-worktrees.mjs']) {
    assert.ok(cuenta(f) >= 1, `${f}: el buscador no ve su llamada a fetch`);
  }
});

test('caso malo: un texto con git pull sale rojo', () => {
  assert.equal(llamadasProhibidas("const r = git(['pull', '--ff-only'], raiz);", 'scripts/x.mjs').length, 1);
  assert.equal(llamadasProhibidas("git(['-C', dir, 'pull'], raiz)", 'scripts/x.mjs').length, 1);
});

test('caso malo: un fetch sin la opción sale rojo, también con el argv en varias líneas', () => {
  assert.equal(llamadasProhibidas("gitOk(['fetch', 'origin', 'main'], raiz);", 'scripts/x.mjs').length, 1);
  assert.equal(llamadasProhibidas("gitOk([\n  'fetch',\n  'origin',\n], raiz);", 'scripts/x.mjs').length, 1);
});

test('caso bueno: fetch con la opción pasa; la excepción solo cubre su ruta', () => {
  assert.deepEqual(llamadasProhibidas(`gitOk(['fetch', '${SIN_ESCRIBIR}', 'origin', 'main'], raiz);`, 'scripts/x.mjs'), []);
  const sinOpcion = 'git(["fetch", "-q", "--prune", "origin"], raiz);';
  assert.deepEqual(llamadasProhibidas(sinOpcion, 'usuario/hooks/limpiar-worktrees.mjs'), []);
  assert.equal(llamadasProhibidas(sinOpcion, 'usuario/hooks/otro.mjs').length, 1);
  assert.equal(llamadasProhibidas("git(['pull'])", 'usuario/hooks/limpiar-worktrees.mjs').length, 1, 'la excepción no cubre pull');
});
