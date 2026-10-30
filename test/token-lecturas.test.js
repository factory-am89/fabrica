// End to end: N real runs of `node scripts/token.mjs -- <command>` with a fake `op` and a fake GitHub
// (test/apoyo/precarga-falsa.mjs) count how many times the .pem is read. Before the cache: N. After: 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contarLecturas, rutaDeRegistro } from '../scripts/lib/op-log.mjs';
import './apoyo/sin-identidad.mjs'; // the result must not depend on the FABRICA_IDENTIDAD of the PC

const LLAMADAS = 10;
const raiz = (r) => fileURLToPath(new URL(r, import.meta.url));
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

test(`token.mjs: ${LLAMADAS} calls read the .pem once`, (t) => {
  const casa = mkdtempSync(join(tmpdir(), 'fabrica-lecturas-'));
  const contador = join(casa, 'contador.txt');
  writeFileSync(contador, '');
  mkdirSync(join(casa, 'AppData', 'Local'), { recursive: true });
  const env = {
    ...process.env, USERPROFILE: casa, HOME: casa, LOCALAPPDATA: join(casa, 'AppData', 'Local'),
    FABRICA_CONSTRUCTOR_CLIENT_ID: 'Iv_test_client', OP_SERVICE_ACCOUNT_TOKEN: 'ops_fake', FALSO_CONTADOR: contador, FALSO_PEM: privateKey,
  };
  delete env.FABRICA_REPO;
  try {
    for (let i = 0; i < LLAMADAS; i++) {
      const r = spawnSync(process.execPath, ['--import', pathToFileURL(raiz('./apoyo/precarga-falsa.mjs')).href, raiz('../scripts/token.mjs'), '--', process.execPath, '-e', 'process.exit(process.env.GH_TOKEN ? 0 : 9)'], { env, encoding: 'utf8' });
      assert.equal(r.status, 0, `call ${i + 1}: ${r.stderr}`);
    }
    const lecturas = readFileSync(contador, 'utf8').split('\n').filter(Boolean).length;
    t.diagnostic(`${LLAMADAS} calls -> ${lecturas} fake-op reads`);
    assert.equal(lecturas, 1);
    // the read log agrees with the fake op's own counter
    assert.deepEqual(contarLecturas({ ruta: rutaDeRegistro(() => casa) }), { 'token.mjs': { total: 1, ok: 1, error: 0 } });
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
});
