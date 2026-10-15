// clientId(): fabrica-constructor tiene su client id por defecto; el entorno solo lo sustituye.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientId, CLIENT_ID_CONSTRUCTOR } from '../scripts/token.mjs';

test('clientId: sin entorno, o con entorno vacío, devuelve el de fabrica-constructor', () => {
  assert.equal(CLIENT_ID_CONSTRUCTOR, 'Iv23liur4l1hSrzmpd7h');
  assert.equal(clientId({}), CLIENT_ID_CONSTRUCTOR);
  assert.equal(clientId({ FABRICA_CONSTRUCTOR_CLIENT_ID: '  ' }), CLIENT_ID_CONSTRUCTOR);
});

test('clientId: el entorno manda', () => {
  assert.equal(clientId({ FABRICA_CONSTRUCTOR_CLIENT_ID: ' Iv23otro ' }), 'Iv23otro');
});
