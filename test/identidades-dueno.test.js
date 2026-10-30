// Los dueños donde vale cada identidad: una lista cerrada (nunca «cualquiera» para una identidad con escritura).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { leerFicha } from '../scripts/lib/repo-card.mjs';
import { IDENTIDADES } from '../scripts/lib/identities.mjs';
import { REPO, OWNER_LOGIN } from '../scripts/lib/repo.mjs';
import './apoyo/sin-identidad.mjs'; // the result must not depend on the FABRICA_IDENTIDAD of the PC

const ficha = (repo, identidad = 'fabrica-constructor') => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'duenos-')));
  writeFileSync(path.join(dir, '.fabrica.json'), JSON.stringify({ repo, base: 'staging', identidad }));
  return () => leerFicha(dir);
};

test('fabrica-constructor vale en repos de factory-am89 y de pabloam89', () => {
  assert.equal(ficha(REPO)().repo, REPO);
  assert.equal(ficha(`${OWNER_LOGIN}/MenuPlan`)().repo, `${OWNER_LOGIN}/MenuPlan`);
  assert.equal(ficha(`${OWNER_LOGIN.toUpperCase()}/MenuPlan`)().identidad, 'fabrica-constructor');
});

test('fabrica-constructor sigue sin valer en un dueño que no está en la lista', () => {
  assert.throws(ficha('otro-dueno/r'), /solo vale en repos de .*factory-am89.*pabloam89/);
});

test('los dueños son una lista cerrada y no vacía; solo «ninguna» (solo lectura) vale en cualquiera', () => {
  for (const [nombre, { duenos, borraRemotas }] of Object.entries(IDENTIDADES)) {
    if (duenos === null) assert.equal(borraRemotas, false, `${nombre}: «cualquiera» solo sin escritura`);
    else assert.ok(Array.isArray(duenos) && duenos.length > 0 && duenos.every((d) => typeof d === 'string' && d), nombre);
  }
});
