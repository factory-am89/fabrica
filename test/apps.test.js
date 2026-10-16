// The three GitHub Apps (manifests, convertir.mjs) and the token.mjs JWT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { destino, argsSecreto, argsEntorno, ENTORNO_ADMIN } from '../apps/convertir.mjs';
import { jwt, orden } from '../scripts/token.mjs';
import { leer } from './apoyo/fabrica.mjs';

test('convertir.mjs guarda los secretos del revisor en su environment', () => {
  assert.deepEqual(argsSecreto('REVISOR_APP_KEY').slice(-2), ['--env', 'revisor']);
  assert.doesNotMatch(leer('apps/convertir.mjs'), /REVISOR_APP_ID/);
});

function manifests() {
  const html = leer('apps/crear-apps.html');
  const valores = [...html.matchAll(/name="manifest" value="([^"]*)"/g)].map((m) => m[1]);
  return valores.map((v) => JSON.parse(v.replaceAll('&quot;', '"').replaceAll('&amp;', '&')));
}

test('constructor y revisor piden solo los permisos acordados', () => {
  const [constructor, revisor] = manifests();
  assert.deepEqual(constructor.default_permissions, {
    contents: 'write', pull_requests: 'write', issues: 'write', workflows: 'write', checks: 'read', actions: 'read',
  });
  assert.deepEqual(revisor.default_permissions, { pull_requests: 'write', checks: 'write' });
  for (const m of [constructor, revisor]) {
    for (const prohibido of ['administration', 'secrets', 'environments']) {
      assert.ok(!(prohibido in m.default_permissions), `${m.name} pide ${prohibido}`);
    }
  }
});

// Lista CERRADA de la App administradora (plan-app-admin, punto 1). Igualdad, no inclusión:
// añadir un permiso o un evento, o cambiar un nivel, hace fallar este test.
const PERMISOS_ADMIN = {
  administration: 'write', contents: 'write', workflows: 'write', environments: 'write',
  pull_requests: 'write', checks: 'read', actions: 'read', metadata: 'read',
};

test('fabrica-administrador pide exactamente la lista cerrada de permisos y ningún evento', () => {
  const admin = manifests().find((m) => m.name === 'fabrica-administrador');
  assert.ok(admin, 'falta el botón de fabrica-administrador');
  assert.deepEqual(admin.default_permissions, PERMISOS_ADMIN);
  assert.deepEqual(admin.default_events, []);
  assert.equal(admin.public, false);
  assert.ok(!('hook_attributes' in admin), 'la App no tiene webhook');
});

test('convertir.mjs guarda la clave administradora en el environment administrador, limitado a main', () => {
  assert.equal(ENTORNO_ADMIN, 'administrador');
  assert.deepEqual(argsSecreto('ADMIN_APP_KEY', 'o/r', ENTORNO_ADMIN), ['secret', 'set', 'ADMIN_APP_KEY', '--repo', 'o/r', '--env', 'administrador']);
  const [crea, rama] = argsEntorno('o/r', ENTORNO_ADMIN);
  assert.ok(crea.join(' ').includes('repos/o/r/environments/administrador'));
  assert.ok(rama.join(' ').includes('deployment-branch-policies') && rama.join(' ').includes('name=main'));
  assert.doesNotMatch(leer('apps/convertir.mjs'), /ADMIN_APP_ID/);
});

test('convertir.mjs solo reconoce las tres Apps', () => {
  assert.equal(destino('fabrica-constructor'), 'constructor');
  assert.equal(destino('fabrica-revisor-1'), 'revisor');
  assert.equal(destino('fabrica-administrador'), 'administrador');
  assert.throws(() => destino('otra'));
});

test('token.mjs: JWT RS256 con el client id, orden tras -- y sin escribir en disco', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const [cab, cuerpo, firma] = jwt('Iv1.abc', pem, 1000).split('.');
  assert.equal(JSON.parse(Buffer.from(cab, 'base64url')).alg, 'RS256');
  const dec = JSON.parse(Buffer.from(cuerpo, 'base64url'));
  assert.deepEqual([dec.iss, dec.iat, dec.exp], ['Iv1.abc', 940, 1540]);
  assert.ok(createVerify('RSA-SHA256').update(`${cab}.${cuerpo}`).verify(publicKey, firma, 'base64url'));
  assert.deepEqual(orden(['--', 'gh', 'pr', 'list']), ['gh', 'pr', 'list']);
  assert.throws(() => orden(['gh']));
  assert.doesNotMatch(leer('scripts/token.mjs'), /writeFile|appendFile|console\.log\(.*token/);
});
