// tokenServicio(): el token de la cuenta de servicio sale del entorno y, si no, del llavero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tokenServicio } from '../scripts/token.mjs';

test('tokenServicio: el entorno manda y no toca el llavero', () => {
  let llamadas = 0;
  const t = tokenServicio({ OP_SERVICE_ACCOUNT_TOKEN: 'del-entorno' }, () => { llamadas++; return 'del-llavero'; });
  assert.equal(t, 'del-entorno');
  assert.equal(llamadas, 0);
});

test('tokenServicio: sin entorno, o con entorno vacío, lee el llavero', () => {
  assert.equal(tokenServicio({}, () => 'del-llavero\n'), 'del-llavero');
  assert.equal(tokenServicio({ OP_SERVICE_ACCOUNT_TOKEN: '  ' }, () => 'del-llavero'), 'del-llavero');
});

test('tokenServicio: sin ninguna vía, error en una frase y sin valores', () => {
  for (const llavero of [() => '', () => null, () => { throw new Error('ops_SECRETO'); }]) {
    assert.throws(
      () => tokenServicio({}, llavero),
      (e) => /arranque de Pablo/.test(e.message) && !e.message.includes('ops_') && !e.message.includes('\n'),
    );
  }
});

test('token.mjs: el recurso del llavero coincide con el script de arranque y el token no va en argumentos', () => {
  const src = readFileSync(new URL('../scripts/token.mjs', import.meta.url), 'utf8');
  assert.match(src, /Fabrica 1Password/);
  assert.match(src, /service-account/);
  assert.match(src, /OP_SERVICE_ACCOUNT_TOKEN: token/);
});
