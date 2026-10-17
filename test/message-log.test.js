// Log of Pablo's messages: UserPromptSubmit through `sesiones.mjs tocar` writes {t, sesion} and never the text.
// Good cases and bad ones (event missing, event of another kind, broken JSON). Own temp dir per test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contarMensajes, registrarMensaje, rutaDeMensajes } from '../scripts/lib/message-log.mjs';
import { tocar } from '../scripts/sesiones.mjs';

const RAIZ = join(import.meta.dirname, '..');
const T0 = Date.UTC(2026, 9, 17, 10, 0, 0);
const ID_A = 'aaaaaaaa-1111';
const ID_B = 'bbbbbbbb-2222';
const TEXTO = 'TEXTO-SECRETO-DEL-MENSAJE';

function conCasa(fn) {
  const casa = mkdtempSync(join(tmpdir(), 'fabrica-msg-'));
  try {
    return fn(casa, join(casa, '.fabrica', 'sesiones'), join(casa, '.fabrica', 'mensajes.jsonl'));
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
}
const opciones = (dir, rutaMensajes) => ({ dir, rutaMensajes, reloj: () => T0, rama: () => 'feat/x' });
const prompt = (extra = {}) => ({ hook_event_name: 'UserPromptSubmit', session_id: ID_A, cwd: 'C:/x', prompt: TEXTO, ...extra });

test('the log lives under ~/.fabrica/mensajes.jsonl', () => {
  assert.equal(rutaDeMensajes(() => '/home/x'), join('/home/x', '.fabrica', 'mensajes.jsonl'));
});

test('UserPromptSubmit writes one line with the time and the session id, and never the text', () => conCasa((_c, dir, ruta) => {
  tocar(prompt(), opciones(dir, ruta));
  const crudo = readFileSync(ruta, 'utf8');
  assert.deepEqual(JSON.parse(crudo), { t: new Date(T0).toISOString(), sesion: ID_A });
  assert.ok(!crudo.includes(TEXTO));
  assert.ok(!readFileSync(join(dir, `${ID_A}.json`), 'utf8').includes(TEXTO));
  tocar(prompt({ session_id: ID_B }), opciones(dir, ruta));
  assert.deepEqual(contarMensajes({ ruta }), { total: 2, porSesion: { [ID_A]: 1, [ID_B]: 1 }, corruptas: [] });
}));

test('PostToolBatch touches the session but writes no message line', () => conCasa((_c, dir, ruta) => {
  tocar(prompt({ hook_event_name: 'PostToolBatch' }), opciones(dir, ruta));
  assert.equal(existsSync(ruta), false);
  assert.equal(existsSync(join(dir, `${ID_A}.json`)), true);
}));

test('a hook of a subagent (agent_id) writes no message line', () => conCasa((_c, dir, ruta) => {
  tocar(prompt({ agent_id: 'sub-1' }), opciones(dir, ruta));
  assert.equal(existsSync(ruta), false);
}));

test('bad: event missing or of another kind fails loudly and writes nothing', () => conCasa((_c, dir, ruta) => {
  const sin = prompt();
  delete sin.hook_event_name;
  assert.throws(() => tocar(sin, opciones(dir, ruta)), /hook_event_name/);
  for (const malo of ['Stop', 'userpromptsubmit', '', 5, null]) {
    assert.throws(() => tocar(prompt({ hook_event_name: malo }), opciones(dir, ruta)), /hook_event_name/, String(malo));
  }
  assert.equal(existsSync(ruta), false);
  assert.equal(existsSync(dir), false);
}));

test('bad: a session id with a wrong shape is refused and nothing is written', () => conCasa((_c, _d, ruta) => {
  for (const malo of ['corto', 'a b c d e f g h', undefined, 7]) assert.throws(() => registrarMensaje({ sesion: malo, ruta, reloj: () => T0 }), /session id/);
  assert.equal(existsSync(ruta), false);
}));

test('the count names a line it cannot read, never skips it', () => conCasa((_c, _d, ruta) => {
  registrarMensaje({ sesion: ID_A, ruta, reloj: () => T0 });
  mkdirSync(join(ruta, '..'), { recursive: true });
  writeFileSync(ruta, `${readFileSync(ruta, 'utf8')}{roto\n{"t":"${new Date(T0).toISOString()}","sesion":"${ID_A}","texto":"${TEXTO}"}\n{"t":"ayer","sesion":"${ID_A}"}\n`);
  const c = contarMensajes({ ruta });
  assert.deepEqual([c.total, c.corruptas, c.porSesion[ID_A]], [4, [2, 3, 4], 1]);
  assert.deepEqual(contarMensajes({ ruta: join(ruta, 'no-existe') }), { total: 0, porSesion: {}, corruptas: [] });
}));

test('the hook runs for real: stdin JSON writes the line in the fake HOME; a missing event or broken JSON exits 1', () => conCasa((casa, dir, ruta) => {
  const hook = (crudo) => spawnSync(process.execPath, [join(RAIZ, 'scripts', 'sesiones.mjs'), 'tocar'], { input: crudo, encoding: 'utf8', env: { ...process.env, HOME: casa, USERPROFILE: casa } });
  const ok = hook(JSON.stringify(prompt({ cwd: RAIZ })));
  assert.equal(ok.status, 0, ok.stderr);
  const c = contarMensajes({ ruta });
  assert.deepEqual([c.total, c.porSesion[ID_A]], [1, 1]);
  assert.ok(!readFileSync(ruta, 'utf8').includes(TEXTO));
  const sin = hook(JSON.stringify({ session_id: ID_A, cwd: RAIZ }));
  assert.equal(sin.status, 1);
  assert.match(sin.stderr, /hook_event_name/);
  const rota = hook('{no es json');
  assert.equal(rota.status, 1);
  assert.match(rota.stderr, /^sesiones: /);
  assert.equal(contarMensajes({ ruta }).total, 1);
  assert.equal(existsSync(dir), true);
}));
