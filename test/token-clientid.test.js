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
