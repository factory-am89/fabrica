// End to end: the exit code and the stderr line of a real `node scripts/token.mjs` run when 1Password
// answers "Too many requests" (fake `op`, test/apoyo/precarga-falsa.mjs). No real `op`, `gh` or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MOTIVOS } from '../scripts/token.mjs';
import './apoyo/sin-identidad.mjs'; // the result must not depend on the FABRICA_IDENTIDAD of the PC

const raiz = (r) => fileURLToPath(new URL(r, import.meta.url));

test('token.mjs: 1Password "Too many requests" exits with the code of limite-de-1password', () => {
  const casa = mkdtempSync(join(tmpdir(), 'fabrica-salida-'));
  const contador = join(casa, 'contador.txt');
  writeFileSync(contador, '');
  mkdirSync(join(casa, 'AppData', 'Local'), { recursive: true });
  const env = {
    ...process.env, USERPROFILE: casa, HOME: casa, LOCALAPPDATA: join(casa, 'AppData', 'Local'),
    FABRICA_CONSTRUCTOR_CLIENT_ID: 'Iv_test_client', OP_SERVICE_ACCOUNT_TOKEN: 'ops_fake', FALSO_CONTADOR: contador,
    FALSO_STDERR: '[ERROR] Too many requests. op_SECRETO_VALOR',
  };
  delete env.FABRICA_REPO;
  try {
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(raiz('./apoyo/precarga-falsa.mjs')).href, raiz('../scripts/token.mjs'), '--', process.execPath, '-e', 'process.exit(0)'], { env, encoding: 'utf8' });
    assert.equal(r.status, MOTIVOS['limite-de-1password']);
    assert.match(r.stderr, /^limite-de-1password: /);
    assert.ok(!r.stderr.includes('SECRETO'), 'op output never reaches the message');
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
});
