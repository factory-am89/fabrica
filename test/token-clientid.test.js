// clientId(): fabrica-constructor tiene su client id por defecto; el entorno solo lo sustituye.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clientId } from '../scripts/token.mjs';
import { CLIENT_ID_CONSTRUCTOR } from '../scripts/lib/repo.mjs';

test('clientId: sin entorno, o con entorno vacío, devuelve el de fabrica-constructor', () => {
  assert.equal(CLIENT_ID_CONSTRUCTOR, 'Iv23liur4l1hSrzmpd7h');
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
      if (/\.(ps1|md)$/.test(f) && linea.includes('FABRICA_CONSTRUCTOR_CLIENT_ID') && !linea.includes('CLIENT_ID_CONSTRUCTOR')) {
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

test('client id: ningún fichero lo contradice ni lo da por obligatorio', () => {
  const ficheros = {};
  for (const f of ['apps/arranque.ps1', 'apps/ruleset.ps1', 'apps/crear-apps.html', 'PASOS-PABLO.md', 'scripts/token.mjs']) {
    ficheros[f] = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  }
  assert.deepEqual(incoherencias(ficheros, CLIENT_ID_CONSTRUCTOR), []);
});
