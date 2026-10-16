// clientId(): fabrica-constructor tiene su client id por defecto; el entorno solo lo sustituye.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { clientId } from '../scripts/token.mjs';
import { CLIENT_ID_CONSTRUCTOR } from '../scripts/lib/repo.mjs';

// Solo la forma de un client id de GitHub App: el valor vive únicamente en repo.mjs, y cambiarlo allí no rompe este test.
const FORMA = /^Iv23li[A-Za-z0-9]+$/;

test('clientId: sin entorno, o con entorno vacío, devuelve el de fabrica-constructor', () => {
  assert.match(CLIENT_ID_CONSTRUCTOR, FORMA);
  assert.equal(clientId({}), CLIENT_ID_CONSTRUCTOR);
  assert.equal(clientId({ FABRICA_CONSTRUCTOR_CLIENT_ID: '  ' }), CLIENT_ID_CONSTRUCTOR);
});

test('clientId: el entorno manda', () => {
  assert.equal(clientId({ FABRICA_CONSTRUCTOR_CLIENT_ID: ' Iv23otro ' }), 'Iv23otro');
});

test('clientId: token.mjs lo importa de scripts/lib/repo.mjs y no lo escribe a mano', () => {
  const src = readFileSync(new URL('../scripts/token.mjs', import.meta.url), 'utf8');
  assert.ok(!src.includes(CLIENT_ID_CONSTRUCTOR));
});

// Sincronía del client id: la fuente es CLIENT_ID_CONSTRUCTOR. Lo que comprueba una máquina (principio 5):
// ningún fichero escribe otro valor Iv23li..., y los textos que nombran la variable remiten a la constante.
export function incoherencias(ficheros, constante) {
  const malos = [];
  for (const [f, src] of Object.entries(ficheros)) {
    src.split('\n').forEach((linea, i) => {
      for (const m of linea.matchAll(/Iv23li[A-Za-z0-9]+/g)) {
        if (m[0] !== constante) malos.push(`${f}:${i + 1} escribe el client id ${m[0]} y la fuente dice ${constante}`);
      }
      if (linea.includes('FABRICA_CONSTRUCTOR_CLIENT_ID') && !linea.includes('CLIENT_ID_CONSTRUCTOR')) {
        malos.push(`${f}:${i + 1} nombra FABRICA_CONSTRUCTOR_CLIENT_ID sin remitir a CLIENT_ID_CONSTRUCTOR`);
      }
    });
  }
  return malos;
}

test('client id: el verificador acepta lo bueno y señala fichero:línea de lo malo', () => {
  const C = 'Iv23liAAAA';
  assert.deepEqual(incoherencias({ 'a.md': 'x\nusa CLIENT_ID_CONSTRUCTOR y Iv23liAAAA' }, C), []);
  assert.deepEqual(incoherencias({ 'a.md': 'x\ny Iv23liBBBB' }, C), ['a.md:2 escribe el client id Iv23liBBBB y la fuente dice Iv23liAAAA']);
  assert.deepEqual(incoherencias({ 'b.ps1': 'ok\nok\nFABRICA_CONSTRUCTOR_CLIENT_ID = 1' }, C),
    ['b.ps1:3 nombra FABRICA_CONSTRUCTOR_CLIENT_ID sin remitir a CLIENT_ID_CONSTRUCTOR']);
});

// Los ficheros de texto versionados, menos este test, que lleva valores malos a propósito como fixtures.
const TEXTO = /\.(mjs|js|json|md|ps1|html|yml|yaml|txt)$/;
// Solo los ficheros versionados: lo que haya suelto en la carpeta (p. ej. una copia `.fabrica/` bajada por el CI) no cuenta.
// `git ls-files` no mira el historial, solo el índice: el resultado no depende de qué commits haya.
function ficherosDeTexto(raiz = new URL('..', import.meta.url), salida = {}) {
  const lista = execFileSync('git', ['ls-files', '-z'], { cwd: raiz, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const f of lista) {
    if (f === 'test/token-clientid.test.js' || !TEXTO.test(f)) continue;
    salida[f] = readFileSync(new URL(f, raiz), 'utf8');
  }
  return salida;
}

test('client id: el escáner ve el árbol y cubre la skill que nombra la variable', () => {
  const ficheros = ficherosDeTexto();
  assert.ok('scripts/lib/repo.mjs' in ficheros && '.claude/skills/github/SKILL.md' in ficheros);
  assert.ok(!('test/token-clientid.test.js' in ficheros));
});

test('client id: ningún fichero del repo lo contradice ni lo da por obligatorio', () => {
  assert.deepEqual(incoherencias(ficherosDeTexto(), CLIENT_ID_CONSTRUCTOR), []);
});
