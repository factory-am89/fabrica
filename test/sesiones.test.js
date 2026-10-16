// Register of live sessions and split of work: two fake sessions are listed, 3 h without activity is inactive, a reservation
// of another live session warns at start-up, an expired one or one of an inactive session does not. Injected disk (temp dir)
// and clock; the CLI tests run the real scripts with a fake HOME.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ACTIVA_H, CADUCA_H, apuntarSesion, leerSesiones, purgarViejas, rutaDeSesiones,
} from '../scripts/lib/registro-sesiones.mjs';
import {
  choques, leerReparto, reservasVivasAjenas, solapan, validarReparto,
} from '../scripts/lib/reparto.mjs';
import { fin, listado, pasoSesiones, tocar } from '../scripts/sesiones.mjs';
import { arrancar } from '../scripts/al-arrancar.mjs';

const AQUI = import.meta.dirname;
const RAIZ = join(AQUI, '..');
const H = 36e5;
const T0 = Date.UTC(2026, 9, 16, 10, 0, 0);
const ID_A = 'aaaaaaaa-1111';
const ID_B = 'bbbbbbbb-2222';

function conCasa(fn) {
  const casa = mkdtempSync(join(tmpdir(), 'fabrica-ses-'));
  try {
    return fn(casa, join(casa, '.fabrica', 'sesiones'));
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
}

const sesion = (dir, id, rama, reloj, carpeta = `C:\\dev\\fabrica-${rama.split('/')[1]}`) => apuntarSesion({ id, carpeta, rama }, { dir, reloj });
const ejecutar = (paso, entrada) => {
  const lineas = [];
  let error = null;
  try {
    paso.ejecutar((l) => lineas.push(l), entrada);
  } catch (e) {
    error = e;
  }
  return { lineas, error };
};
const reparto = (casa, reservas) => {
  writeFileSync(join(casa, 'reparto.json'), JSON.stringify({ reservas }));
  return casa;
};
const reserva = (rama, ficheros, hasta) => ({ rama, ficheros, hasta });
const MAÑANA = new Date(T0 + 24 * H).toISOString();
const AYER = new Date(T0 - 24 * H).toISOString();

test('the register lives under ~/.fabrica/sesiones, one file per session', () => {
  assert.equal(rutaDeSesiones(() => '/home/x'), join('/home/x', '.fabrica', 'sesiones'));
  assert.equal(ACTIVA_H, 3);
});

test('two fake sessions: npm run sesiones lists both, with branch and folder, exit 0', () => conCasa((casa, dir) => {
  sesion(dir, ID_A, 'feat/uno', Date.now);
  sesion(dir, ID_B, 'fix/dos', Date.now);
  const r = spawnSync(process.execPath, [join(RAIZ, 'scripts', 'sesiones.mjs')], { encoding: 'utf8', env: { ...process.env, HOME: casa, USERPROFILE: casa } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 sesiones activas, 0 inactivas/);
  for (const [id, rama] of [[ID_A, 'feat/uno'], [ID_B, 'fix/dos']]) assert.ok(r.stdout.split('\n').some((l) => l.includes(id) && l.includes(rama) && l.startsWith('activa')), id);
  const j = spawnSync(process.execPath, [join(RAIZ, 'scripts', 'sesiones.mjs'), '--json'], { encoding: 'utf8', env: { ...process.env, HOME: casa, USERPROFILE: casa } });
  const datos = JSON.parse(j.stdout);
  assert.equal(datos.sesiones.length, 2);
  assert.equal(datos.registro, dir);
}));

test('a session with no activity for more than 3 h is inactive (clock injected; exactly 3 h still counts as active)', () => conCasa((_c, dir) => {
  sesion(dir, ID_A, 'feat/uno', () => T0);
  sesion(dir, ID_B, 'fix/dos', () => T0 + 2 * H);
  const en = (ms) => leerSesiones({ dir, reloj: () => ms }).sesiones.map((s) => [s.id, s.activa]);
  assert.deepEqual(en(T0 + 3 * H), [[ID_A, true], [ID_B, true]]);
  assert.deepEqual(en(T0 + 3 * H + 1), [[ID_A, false], [ID_B, true]]);
  const l = listado({ dir, reloj: () => T0 + 3 * H + 1 }).texto.split('\n');
  assert.match(l[0], /1 sesión activa, 1 inactiva/);
  assert.ok(l.some((x) => x.startsWith('inactiva') && x.includes(ID_A)));
  assert.ok(l.some((x) => x.startsWith('activa') && x.includes(ID_B)));
}));

test('a session file with no activity for more than 48 h is purged at start-up; the others and the unreadable ones stay', () => conCasa((_c, dir) => {
  assert.equal(CADUCA_H, 48);
  sesion(dir, ID_A, 'feat/uno', () => T0);
  sesion(dir, ID_B, 'fix/dos', () => T0 + 1 * H);
  assert.deepEqual(purgarViejas({ dir, reloj: () => T0 + 48 * H }), []);
  assert.deepEqual(purgarViejas({ dir, reloj: () => T0 + 48 * H + 1 }), [ID_A]);
  assert.deepEqual(readdirSync(dir), [`${ID_B}.json`]);
}));

test('the register is closed: a field with a wrong shape is refused and nothing is written', () => conCasa((_c, dir) => {
  for (const malo of [{ id: ID_A, carpeta: 'C:\\x\nsegunda línea', rama: 'feat/x' }, { id: ID_A, carpeta: 'C:\\x', rama: 'feat x; rm -rf /' }, { id: 'corto', carpeta: 'C:\\x', rama: 'feat/x' }, { id: ID_A, carpeta: '', rama: 'feat/x' }]) {
    assert.throws(() => apuntarSesion(malo, { dir, reloj: () => T0 }), /wrong shape/);
  }
  assert.equal(existsSync(dir), false);
}));

test('registering again keeps `inicio` and moves `ultima`', () => conCasa((_c, dir) => {
  sesion(dir, ID_A, 'feat/uno', () => T0);
  sesion(dir, ID_A, 'feat/uno', () => T0 + H);
  const otra = sesion(dir, ID_A, 'feat/uno', () => T0 + 2 * H);
  assert.equal(otra.inicio, new Date(T0).toISOString());
  assert.equal(otra.ultima, new Date(T0 + 2 * H).toISOString());
}));

test('a file that cannot be read is named, never skipped: the listing says it and the CLI exits 1', () => conCasa((casa, dir) => {
  sesion(dir, ID_A, 'feat/uno', () => T0);
  writeFileSync(join(dir, 'roto.json'), '{no es json');
  writeFileSync(join(dir, 'extra.json'), JSON.stringify({ id: ID_B, carpeta: 'C:\\x', rama: 'a', inicio: new Date(T0).toISOString(), ultima: new Date(T0).toISOString(), prompt: 'texto libre' }));
  const { sesiones, corruptas } = leerSesiones({ dir, reloj: () => T0 });
  assert.equal(sesiones.length, 1);
  assert.deepEqual(corruptas, ['extra.json', 'roto.json']);
  const r = spawnSync(process.execPath, [join(RAIZ, 'scripts', 'sesiones.mjs')], { encoding: 'utf8', env: { ...process.env, HOME: casa, USERPROFILE: casa } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /extra\.json, roto\.json/);
}));

test('hook tocar: updates `ultima` keeping folder and branch (git not asked again); creates the file when there is none; fin deletes it', () => conCasa((_c, dir) => {
  sesion(dir, ID_A, 'feat/uno', () => T0, 'C:\\dev\\fabrica-uno');
  const sinGit = () => { throw new Error('git must not be asked when the file exists'); };
  const f = tocar({ session_id: ID_A, cwd: 'C:\\otra' }, { dir, reloj: () => T0 + H, rama: sinGit });
  assert.deepEqual([f.carpeta, f.rama, f.ultima], ['C:\\dev\\fabrica-uno', 'feat/uno', new Date(T0 + H).toISOString()]);
  const nueva = tocar({ session_id: ID_B, cwd: 'C:\\dev\\fabrica-dos' }, { dir, reloj: () => T0, rama: () => 'fix/dos' });
  assert.deepEqual([nueva.carpeta, nueva.rama], ['C:\\dev\\fabrica-dos', 'fix/dos']);
  assert.throws(() => tocar({ cwd: 'x' }, { dir }), /valid session_id/);
  fin({ session_id: ID_A }, { dir });
  assert.deepEqual(readdirSync(dir), [`${ID_B}.json`]);
}));

test('hook modes run for real: tocar and fin read the hook JSON on stdin', () => conCasa((casa, dir) => {
  const hook = (modo, entrada) => spawnSync(process.execPath, [join(RAIZ, 'scripts', 'sesiones.mjs'), modo], { input: JSON.stringify(entrada), encoding: 'utf8', env: { ...process.env, HOME: casa, USERPROFILE: casa } });
  const r = hook('tocar', { session_id: ID_A, cwd: RAIZ });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(dir), [`${ID_A}.json`]);
  assert.equal(hook('fin', { session_id: ID_A }).status, 0);
  assert.deepEqual(readdirSync(dir), []);
  const mala = hook('tocar', { cwd: RAIZ });
  assert.equal(mala.status, 1);
  assert.match(mala.stderr, /valid session_id/);
}));

test('reparto.json: closed shape, no file means no reservations, a broken file throws', () => conCasa((casa) => {
  assert.deepEqual(leerReparto(casa), { reservas: [] });
  const ok = reserva('feat/uno', ['scripts/a.mjs'], MAÑANA);
  assert.deepEqual(validarReparto({ reservas: [ok] }), { reservas: [ok] });
  for (const mala of [null, { reservas: 'x' }, { reservas: [], nota: 'libre' }, { reservas: [{ ...ok, nota: 'libre' }] }, { reservas: [{ ...ok, ficheros: [] }] },
    { reservas: [{ ...ok, ficheros: ['con espacio y texto libre'] }] }, { reservas: [{ ...ok, hasta: 'mañana' }] }, { reservas: [{ ...ok, rama: 'a b' }] }]) {
    assert.throws(() => validarReparto(mala), /reparto\.json/, JSON.stringify(mala));
  }
  writeFileSync(join(casa, 'reparto.json'), '{roto');
  assert.throws(() => leerReparto(casa), /not JSON/);
}));

test('the reparto.json of the repo is valid', () => {
  validarReparto(JSON.parse(readFileSync(join(RAIZ, 'reparto.json'), 'utf8')));
});

test('solapan: same file, or a folder (slash) that holds the other; a file name that only starts the same does not', () => {
  assert.equal(solapan('a/b.mjs', 'a/b.mjs'), true);
  assert.equal(solapan('scripts/', 'scripts/token.mjs'), true);
  assert.equal(solapan('scripts/token.mjs', 'scripts/'), true);
  assert.equal(solapan('scripts/token.mjs', 'scripts/token.mjs.bak'), false);
  assert.equal(solapan('scripts', 'scripts/token.mjs'), false);
});

test('reservasVivasAjenas: only another branch, not expired, with an active session; own, expired, inactive and sessionless ones are out', () => {
  const sesiones = [{ id: ID_A, carpeta: 'C:\\a', rama: 'feat/uno', activa: true }, { id: ID_B, carpeta: 'C:\\b', rama: 'fix/dos', activa: false }];
  const r = { reservas: [
    reserva('feat/uno', ['x'], MAÑANA), reserva('fix/dos', ['y'], MAÑANA), reserva('feat/tres', ['z'], MAÑANA), reserva('feat/uno', ['w'], AYER),
  ] };
  assert.deepEqual(reservasVivasAjenas(r, sesiones, 'feat/mia', T0).map((x) => x.ficheros[0]), ['x']);
  assert.deepEqual(reservasVivasAjenas(r, sesiones, 'feat/uno', T0), []);
  const justo = { reservas: [reserva('feat/uno', ['x'], new Date(T0).toISOString())] };
  assert.deepEqual(reservasVivasAjenas(justo, sesiones, 'feat/mia', T0), [], 'expires at `hasta`');
  assert.equal(reservasVivasAjenas(justo, sesiones, 'feat/mia', T0 - 1).length, 1);
});

test('start-up step: a reservation of another LIVE session warns with the files, the branch and the folder', () => conCasa((casa, dir) => {
  sesion(dir, ID_A, 'feat/uno', () => T0 - H);
  const r = reparto(mkdtempSync(join(casa, 'rep-')), [reserva('feat/uno', ['scripts/token.mjs', 'test/'], MAÑANA)]);
  const paso = pasoSesiones({ dir, reloj: () => T0, memoria: () => ({ libre: 2048 * 1048576, total: 8192 * 1048576 }), rama: () => 'feat/mia', raiz: () => r });
  const { lineas, error } = ejecutar(paso, { session_id: ID_B, cwd: 'C:\\dev\\fabrica-mia' });
  assert.equal(error, null);
  assert.match(lineas[0], /^sesiones: 2 activas de 2 registradas \(esta: bbbbbbbb, feat\/mia\) · memoria libre 2048 de 8192 MiB/);
  const aviso = lineas.filter((l) => l.startsWith('AVISO DE REPARTO'));
  assert.equal(aviso.length, 1);
  assert.match(aviso[0], /feat\/uno \(sesión aaaaaaaa, C:\\dev\\fabrica-uno\) tiene reservado scripts\/token\.mjs, test\/ hasta /);
  assert.ok(existsSync(join(dir, `${ID_B}.json`)), 'this session is registered');
}));

test('start-up step: no warning when the reservation is expired, or its session is inactive (3 h), or it is my own', () => conCasa((casa, dir) => {
  sesion(dir, ID_A, 'feat/uno', () => T0 - 4 * H);
  sesion(dir, 'cccccccc-3333', 'fix/tres', () => T0 - H);
  const r = reparto(mkdtempSync(join(casa, 'rep-')), [
    reserva('feat/uno', ['a'], MAÑANA), reserva('fix/tres', ['b'], AYER), reserva('feat/mia', ['c'], MAÑANA),
  ]);
  const paso = pasoSesiones({ dir, reloj: () => T0, memoria: () => ({ libre: 1048576, total: 2097152 }), rama: () => 'feat/mia', raiz: () => r });
  const { lineas, error } = ejecutar(paso, { session_id: ID_B, cwd: 'C:\\dev\\x' });
  assert.equal(error, null);
  assert.deepEqual(lineas.filter((l) => l.includes('REPARTO')), []);
  assert.match(lineas[0], /^sesiones: 2 activas de 3 registradas/);
}));

test('start-up step: my own reservation that overlaps one of another live session is said as a clash', () => conCasa((casa, dir) => {
  sesion(dir, ID_A, 'feat/uno', () => T0);
  const r = reparto(mkdtempSync(join(casa, 'rep-')), [reserva('feat/uno', ['scripts/token.mjs'], MAÑANA), reserva('feat/mia', ['scripts/'], MAÑANA)]);
  assert.deepEqual(choques(leerReparto(r), reservasVivasAjenas(leerReparto(r), leerSesiones({ dir, reloj: () => T0 }).sesiones, 'feat/mia', T0), 'feat/mia', T0), [{ rama: 'feat/uno', fichero: 'scripts/token.mjs' }]);
  const paso = pasoSesiones({ dir, reloj: () => T0, memoria: () => ({ libre: 1048576, total: 2097152 }), rama: () => 'feat/mia', raiz: () => r });
  const { lineas } = ejecutar(paso, { session_id: ID_B, cwd: 'C:\\x' });
  assert.ok(lineas.some((l) => l === 'AVISO DE REPARTO: tu rama feat/mia reserva scripts/token.mjs, que choca con la reserva de feat/uno'), lineas.join('\n'));
}));

test('start-up step: fails loudly with no session_id, with an unreadable session file, and with a broken reparto.json', () => conCasa((casa, dir) => {
  const base = { dir, reloj: () => T0, memoria: () => ({ libre: 1048576, total: 2097152 }), rama: () => 'feat/mia' };
  const r = reparto(mkdtempSync(join(casa, 'rep-')), []);
  assert.match(ejecutar(pasoSesiones({ ...base, raiz: () => r }), null).error.message, /session_id/);
  assert.match(ejecutar(pasoSesiones({ ...base, raiz: () => r }), { session_id: 'x' }).error.message, /session_id/);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'roto.json'), 'no');
  assert.match(ejecutar(pasoSesiones({ ...base, raiz: () => r }), { session_id: ID_B, cwd: 'C:\\x' }).error.message, /roto\.json/);
  rmSync(join(dir, 'roto.json'));
  writeFileSync(join(r, 'reparto.json'), '{roto');
  assert.match(ejecutar(pasoSesiones({ ...base, raiz: () => r }), { session_id: ID_B, cwd: 'C:\\x' }).error.message, /reparto\.json: not JSON/);
}));

test('arrancar hands it the hook input, and a failing step shows as a headline', () => conCasa((casa, dir) => {
  const r = reparto(mkdtempSync(join(casa, 'rep-')), []);
  const lineas = [];
  const paso = pasoSesiones({ dir, reloj: () => T0, memoria: () => ({ libre: 1048576, total: 2097152 }), rama: () => 'feat/mia', raiz: () => r });
  assert.equal(arrancar([paso], (l) => lineas.push(l), { session_id: ID_A, cwd: 'C:\\x' }), 0);
  assert.match(lineas[0], /^sesiones: 1 activa de 1 registrada/);
  const mal = [];
  assert.equal(arrancar([paso], (l) => mal.push(l), null), 1);
  assert.match(mal[0], /FALLÓ el paso «sesiones»: .*session_id/);
}));

test('al-arrancar run for real with the hook JSON on stdin registers the session in the fake HOME', () => conCasa((casa, dir) => {
  const repo = join(casa, 'repo');
  const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  spawnSync('git', ['init', '-q', '-b', 'feat/de-prueba', repo]);
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x');
  const r = spawnSync(process.execPath, [join(RAIZ, 'scripts', 'al-arrancar.mjs')], {
    cwd: repo, input: JSON.stringify({ session_id: ID_A, cwd: repo }), encoding: 'utf8', env: { ...process.env, HOME: casa, USERPROFILE: casa },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /sesiones: 1 activa de 1 registrada \(esta: aaaaaaaa, feat\/de-prueba\)/);
  assert.doesNotMatch(r.stdout, /FALLÓ el paso «sesiones»/);
  assert.deepEqual(readdirSync(dir), [`${ID_A}.json`]);
}));

test('.claude/settings.json: UserPromptSubmit and PostToolBatch touch the session, SessionEnd closes it; SessionStart is untouched; npm run sesiones exists', () => {
  const s = JSON.parse(readFileSync(join(RAIZ, '.claude', 'settings.json'), 'utf8'));
  const ordenes = (evento) => (s.hooks[evento] ?? []).flatMap((g) => g.hooks.map((h) => h.command));
  for (const evento of ['UserPromptSubmit', 'PostToolBatch']) assert.ok(ordenes(evento).some((c) => c.includes('scripts/sesiones.mjs') && c.endsWith(' tocar')), evento);
  assert.ok(ordenes('SessionEnd').some((c) => c.includes('scripts/sesiones.mjs') && c.endsWith(' fin')));
  assert.ok(ordenes('SessionEnd').some((c) => c.includes('scripts/intervenciones.mjs')), 'the other SessionEnd hook is still there');
  assert.deepEqual(ordenes('SessionStart'), ['node "$CLAUDE_PROJECT_DIR/scripts/al-arrancar.mjs"']);
  assert.equal(JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).scripts.sesiones, 'node scripts/sesiones.mjs');
});

test('a broken file of the session itself is not healed in silence: apuntarSesion throws and leaves it; only reescribirRota rewrites it', () => conCasa((_c, dir) => {
  mkdirSync(dir, { recursive: true });
  const ruta = join(dir, `${ID_A}.json`);
  writeFileSync(ruta, '{roto');
  assert.throws(() => sesion(dir, ID_A, 'feat/uno', () => T0), SyntaxError);
  assert.equal(readFileSync(ruta, 'utf8'), '{roto');
  apuntarSesion({ id: ID_A, carpeta: 'C:/x', rama: 'feat/uno' }, { dir, reloj: () => T0, reescribirRota: true });
  assert.equal(leerSesiones({ dir, reloj: () => T0 }).corruptas.length, 0);
}));

test('start-up step: a broken file of THIS session is named in the report and fails the step (then it is rewritten)', () => conCasa((casa, dir) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${ID_B}.json`), 'no es json');
  const r = reparto(mkdtempSync(join(casa, 'rep-')), []);
  const paso = pasoSesiones({ dir, reloj: () => T0, memoria: () => ({ libre: 1048576, total: 2097152 }), rama: () => 'feat/mia', raiz: () => r });
  const { lineas, error } = ejecutar(paso, { session_id: ID_B, cwd: 'C:/x' });
  assert.ok(lineas.some((l) => l.includes(`${ID_B}.json`) && l.includes('ilegible')), lineas.join('\n'));
  assert.ok(error.message.includes(`${ID_B}.json`), error.message);
  assert.equal(leerSesiones({ dir, reloj: () => T0 }).corruptas.length, 0);
}));

test('a missing cwd is not replaced by the current folder: the step and the tocar hook fail', () => conCasa((casa, dir) => {
  const r = reparto(mkdtempSync(join(casa, 'rep-')), []);
  const paso = pasoSesiones({ dir, reloj: () => T0, memoria: () => ({ libre: 1048576, total: 2097152 }), rama: () => 'feat/mia', raiz: () => r });
  assert.match(ejecutar(paso, { session_id: ID_B }).error.message, /cwd/);
  assert.throws(() => tocar({ session_id: ID_B }, { dir, reloj: () => T0, rama: () => 'feat/mia' }), /cwd/);
  assert.equal(existsSync(dir), false);
}));
