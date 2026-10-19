// The three GitHub Apps (manifests, convertir.mjs) and the token.mjs JWT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { destino, argsSecreto, argsEntornoPs, ENTORNO_ADMIN } from '../apps/convertir.mjs';
import { jwt, orden } from '../scripts/token.mjs';
import { leer, manifiestos } from './support/factory.mjs';
import { ADMIN_APP_SLUG, REPO } from '../scripts/lib/repo.mjs';

test('convertir.mjs guarda los secretos del revisor en su environment', () => {
  assert.deepEqual(argsSecreto('REVISOR_APP_KEY').slice(-2), ['--env', 'revisor']);
  assert.doesNotMatch(leer('apps/convertir.mjs'), /REVISOR_APP_ID/);
});

test('constructor y revisor piden solo los permisos acordados', () => {
  const [constructor, revisor] = manifiestos();
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

// Lista CERRADA de la App administradora (plans/app-admin.md, punto 1). Igualdad, no inclusión:
// añadir un permiso o un evento, o cambiar un nivel, hace fallar este test.
const PERMISOS_ADMIN = {
  administration: 'write', contents: 'write', workflows: 'write', environments: 'write',
  pull_requests: 'write', checks: 'read', actions: 'read', metadata: 'read',
};

test('fabrica-administrador pide exactamente la lista cerrada de permisos y ningún evento', () => {
  const admin = manifiestos().find((m) => m.name === ADMIN_APP_SLUG);
  assert.ok(admin, 'falta el botón de fabrica-administrador');
  assert.deepEqual(admin.default_permissions, PERMISOS_ADMIN);
  assert.deepEqual(admin.default_events, []);
  assert.equal(admin.public, false);
  assert.ok(!('hook_attributes' in admin), 'la App no tiene webhook');
});

test('convertir.mjs guarda la clave administradora en el environment administrador, limitado a main', () => {
  assert.equal(ENTORNO_ADMIN, 'administrador');
  assert.deepEqual(argsSecreto('ADMIN_APP_KEY', 'o/r', ENTORNO_ADMIN), ['secret', 'set', 'ADMIN_APP_KEY', '--repo', 'o/r', '--env', 'administrador']);
  // Una sola fuente de «environment limitado a main»: convertir.mjs llama a entorno.ps1, que usa la función de lib-gh.ps1.
  const ps = argsEntornoPs('o/r', ENTORNO_ADMIN);
  assert.deepEqual(ps.slice(-4), ['-Repo', 'o/r', '-Nombre', 'administrador']);
  assert.ok(ps.includes('-File') && ps[ps.indexOf('-File') + 1].endsWith('entorno.ps1'));
  const conv = leer('apps/convertir.mjs');
  assert.doesNotMatch(conv, /deployment[_-]branch[_-]polic/, 'convertir.mjs no repite la regla de lib-gh.ps1');
  assert.doesNotMatch(conv, /422|already exists/, 'ningún error de la creación se traga');
  assert.match(leer('apps/entorno.ps1'), /Asegurar-Environment-Limitado \$Repo \$Nombre/);
  const lib = leer('apps/lib-gh.ps1');
  assert.match(lib, /'name=main', '-f', 'type=branch'/);
  assert.match(lib, /NO queda limitado a main/, 'la función lee de vuelta y lanza si no está limitado');
  assert.match(lib, /function Asegurar-Environment-Revisor.*Asegurar-Environment-Limitado \$Repo 'revisor'/);
  assert.doesNotMatch(leer('apps/convertir.mjs'), /ADMIN_APP_ID/);
});

test('ADMIN_APP_SLUG es la App que crean apps/crear-apps.html y apps/convertir.mjs', () => {
  assert.ok(leer('apps/crear-apps.html').includes(`<h2>3. ${ADMIN_APP_SLUG}</h2>`), 'crear-apps.html no crea la App con ese nombre');
  assert.equal(destino(ADMIN_APP_SLUG), 'administrador');
  assert.doesNotMatch(leer('apps/convertir.mjs'), /['"]fabrica-administrador['"]/, 'el slug va en la constante, no escrito a mano');
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

// The Apps belong to the organization that owns REPO (fabrica-constructor and fabrica-revisor are owned by
// factory-am89): a private App created under a personal account cannot be installed on the organization.
test('every form in crear-apps.html creates the App under the organization that owns REPO', () => {
  const org = REPO.split('/')[0];
  const acciones = [...leer('apps/crear-apps.html').matchAll(/<form action="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(acciones.length, 3, 'expected one form per App');
  for (const a of acciones) assert.equal(a, `https://github.com/organizations/${org}/settings/apps/new`);
});
