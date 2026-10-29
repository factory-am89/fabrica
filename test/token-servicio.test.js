// tokenServicio(): el token de la cuenta de servicio sale del entorno y, si no, del llavero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tokenServicio, ErrorLlavero } from '../scripts/token.mjs';

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
  for (const llavero of [() => '', () => null]) {
    assert.throws(
      () => tokenServicio({}, llavero),
      (e) => /arranque de Pablo/.test(e.message) && !e.message.includes('ops_') && !e.message.includes('\n'),
    );
  }
});

test('llavero: token.mjs y arranque.ps1 leen el mismo apps/llavero.json y ninguno repite los nombres', () => {
  const leer = (r) => readFileSync(new URL(r, import.meta.url), 'utf8');
  const { recurso, usuario } = JSON.parse(leer('../apps/llavero.json'));
  assert.ok(recurso && usuario);
  for (const f of ['../scripts/token.mjs', '../apps/arranque.ps1']) {
    const src = leer(f);
    assert.match(src, /llavero\.json/, f + ' debe leer apps/llavero.json');
    assert.ok(!src.includes(`'${recurso}'`), f + ' repite el recurso del llavero');
    assert.ok(!src.includes(`'${usuario}'`), f + ' repite el usuario del llavero');
  }
  assert.match(leer('../scripts/token.mjs'), /_TOKEN: token/);
});

test('tokenServicio: un fallo de powershell no se disfraza de «falta el token»', () => {
  for (const causa of ['timeout', 'salida 3']) {
    assert.throws(
      () => tokenServicio({}, () => { throw new ErrorLlavero(`powershell falló al leer el llavero (${causa}); la entrada puede existir: reintenta.`); }),
      (e) => e.message.includes(causa) && !/arranque de Pablo/.test(e.message),
    );
  }
});

test('tokenServicio: cualquier otra excepción del llavero sube, no se traga', () => {
  assert.throws(() => tokenServicio({}, () => { throw new Error('rotura'); }), /rotura/);
});
