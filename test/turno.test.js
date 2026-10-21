// The turn of `npm run done` (scripts/lib/turno.mjs): lock, free memory, wait cap, release. Clock, sleeping, pids and
// memory are fakes, so no test waits for real; the lock files live in a temporary folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ExitError, EXIT } from '../scripts/lib/exit.mjs';
import {
  rutaDeCandadoDone, tomarTurno, liberarAlTerminar, umbralDeEntorno, pidVivoReal, SENALES,
  MIN_LIBRE_BYTES, ESPERA_MAX_MS, CANDADO_MAX_EDAD_MS, SONDEO_MS, VAR_MIN_LIBRE_MB,
} from '../scripts/lib/turno.mjs';
import { cliDone, turnoReal, DONE_LINE } from '../scripts/done.mjs';

const T0 = Date.parse('2026-10-21T10:00:00Z');
const GIB = 1024 ** 3;
const ME = 1111;
const OTHER = 2222;

// A world: a lock path in a temp folder, a clock that only moves when someone sleeps, the messages said.
function mundo({ vivos = [ME, OTHER], libre = () => 16 * GIB, alDormir = () => {} } = {}) {
  const ruta = rutaDeCandadoDone(() => mkdtempSync(path.join(tmpdir(), 'turno-')));
  mkdirSync(path.dirname(ruta), { recursive: true });
  const m = { t: T0, dichos: [], sueños: 0, ruta };
  m.opciones = {
    ruta, pid: ME, ahora: () => m.t, libre: () => libre(m), pidVivo: (p) => vivos.includes(p),
    dormir: (ms) => { m.sueños++; m.t += ms; alDormir(m); }, decir: (x) => m.dichos.push(x),
  };
  m.ponerCandado = (pid, desdeMs) => {
    writeFileSync(ruta, JSON.stringify({ pid, desde: new Date(desdeMs).toISOString() }));
  };
  return m;
}
const dueno = (m) => JSON.parse(readFileSync(m.ruta, 'utf8'));

test('turno: the lock path has the form rutaDe...(casa) under ~/.fabrica', () => {
  assert.equal(rutaDeCandadoDone(() => '/h'), path.join('/h', '.fabrica', 'done.lock'));
});

test('turno: a free machine takes the turn at once, writes pid and time, and gives it back', () => {
  const m = mundo();
  const t = tomarTurno(m.opciones);
  assert.deepEqual(dueno(m), { pid: ME, desde: new Date(T0).toISOString() });
  assert.equal(m.sueños, 0);
  t.soltar();
  assert.equal(existsSync(m.ruta), false);
  t.soltar(); // idempotent
});

test('turno: another live done holds it -> waits, says who and since when, then takes it when it leaves', () => {
  const m = mundo({ alDormir: (w) => { if (w.sueños === 3) rmSync(w.ruta); } });
  m.ponerCandado(OTHER, T0 - 60000);
  const t = tomarTurno(m.opciones);
  assert.equal(m.sueños, 3);
  assert.equal(m.t, T0 + 3 * SONDEO_MS);
  assert.equal(m.dichos.length, 1, 'the same message is not repeated every poll');
  assert.match(m.dichos[0], new RegExp(`pid ${OTHER}`));
  assert.match(m.dichos[0], new RegExp(new Date(T0 - 60000).toISOString()));
  assert.equal(dueno(m).pid, ME);
  t.soltar();
});

test('turno: the lock of a dead process is removed (and said), never waited for', () => {
  const m = mundo({ vivos: [ME] });
  m.ponerCandado(OTHER, T0 - 1000);
  const t = tomarTurno(m.opciones);
  assert.equal(m.sueños, 0);
  assert.equal(dueno(m).pid, ME);
  assert.match(m.dichos[0], new RegExp(`removed the lock of pid ${OTHER}.*dead`));
  t.soltar();
});

test('turno: a lock older than the cap is removed even if its pid is alive (and said)', () => {
  const m = mundo();
  m.ponerCandado(OTHER, T0 - CANDADO_MAX_EDAD_MS - 1000);
  const t = tomarTurno(m.opciones);
  assert.equal(dueno(m).pid, ME);
  assert.match(m.dichos[0], /removed the lock of pid 2222.*old/);
  t.soltar();
});

test('turno: a lock just under the cap with a live pid is respected', () => {
  const m = mundo();
  m.ponerCandado(OTHER, T0 - CANDADO_MAX_EDAD_MS + 1000);
  assert.throws(() => tomarTurno({ ...m.opciones, esperaMax: 0 }), (e) => e instanceof ExitError);
  assert.equal(dueno(m).pid, OTHER, 'the other lock must still be there');
});

test('turno: a lock that changes hands while being judged stale is not removed', () => {
  const m = mundo();
  m.ponerCandado(OTHER, T0 - 1000);
  // judged dead (first answer), but by then a third process has taken the lock
  const opciones = { ...m.opciones, esperaMax: 0, pidVivo: () => { m.ponerCandado(3333, T0); return false; } };
  assert.throws(() => tomarTurno(opciones), (e) => e instanceof ExitError);
  assert.equal(dueno(m).pid, 3333);
  assert.deepEqual(m.dichos, []);
});

test('done: the real turn is wired to the end of the process (exit and signals), and gives the lock back', () => {
  const m = mundo();
  const proc = Object.assign(new EventEmitter(), { salidas: [], exit(c) { this.salidas.push(c); } });
  turnoReal({}, m.opciones, proc);
  assert.equal(existsSync(m.ruta), true);
  assert.equal(proc.listenerCount('exit'), 1);
  proc.emit('SIGINT');
  assert.equal(existsSync(m.ruta), false);
  assert.deepEqual(proc.salidas, [SENALES.SIGINT]);
  assert.deepEqual(m.dichos, [], 'with the default floor nothing is said about it');
});

test('done: a floor set from the environment is said on screen, with its value', () => {
  const m = mundo();
  const proc = Object.assign(new EventEmitter(), { exit() {} });
  turnoReal({ [VAR_MIN_LIBRE_MB]: '512' }, m.opciones, proc).soltar();
  assert.equal(m.dichos.length, 1);
  assert.match(m.dichos[0], new RegExp(`${VAR_MIN_LIBRE_MB}: 512 MB \\(default 3072 MB\\)`));
});

test('turno: the wait runs out -> fails loud with DONE_TURN_TIMEOUT, leaves the other lock, never takes the turn', () => {
  const m = mundo();
  m.ponerCandado(OTHER, T0);
  assert.throws(() => tomarTurno(m.opciones), (e) => {
    assert.ok(e instanceof ExitError);
    assert.equal(e.exit, EXIT.DONE_TURN_TIMEOUT);
    assert.match(e.message, /the suite was not started/);
    assert.match(e.message, /pid 2222/);
    return true;
  });
  assert.equal(m.t - T0, ESPERA_MAX_MS, 'it waited exactly the cap');
  assert.equal(dueno(m).pid, OTHER);
});

test('turno: an unreadable lock is waited for and never removed; it times out saying so', () => {
  const m = mundo();
  writeFileSync(m.ruta, '{no es json');
  assert.throws(() => tomarTurno({ ...m.opciones, esperaMax: 2 * SONDEO_MS }), /unreadable/);
  assert.equal(readFileSync(m.ruta, 'utf8'), '{no es json');
  assert.match(m.dichos[0], /cannot be read/);
});

test('turno: low memory -> waits until it rises, says how much, then starts', () => {
  const m = mundo({ libre: (w) => (w.sueños < 2 ? 2.2 * GIB : MIN_LIBRE_BYTES) });
  const t = tomarTurno(m.opciones);
  assert.equal(m.sueños, 2);
  assert.match(m.dichos[0], /waiting for memory: 2\.2 GiB free, 3\.0 GiB needed/);
  assert.equal(dueno(m).pid, ME, 'it holds the turn while it waits for memory');
  t.soltar();
});

test('turno: memory never rises -> DONE_TURN_TIMEOUT and our lock is released first', () => {
  const m = mundo({ libre: () => 2.2 * GIB });
  assert.throws(() => tomarTurno(m.opciones), (e) => e instanceof ExitError && e.exit === EXIT.DONE_TURN_TIMEOUT && /free memory/.test(e.message));
  assert.equal(existsSync(m.ruta), false);
});

test('turno: soltar never removes a lock that is not ours', () => {
  const m = mundo();
  const t = tomarTurno(m.opciones);
  m.ponerCandado(OTHER, T0);
  t.soltar();
  assert.equal(dueno(m).pid, OTHER);
});

test('turno: the constants have the measured/derived values and make sense together', () => {
  assert.ok(MIN_LIBRE_BYTES > 2.2 * GIB, 'the floor is above the free memory at which processes died');
  assert.ok(CANDADO_MAX_EDAD_MS > SONDEO_MS && ESPERA_MAX_MS > SONDEO_MS);
});

test('turno: liberarAlTerminar gives the lock back on exit and on every signal, then exits with its code', () => {
  const soltados = [];
  const turno = { soltar: () => soltados.push('x') };
  const proc = Object.assign(new EventEmitter(), { salidas: [], exit(c) { this.salidas.push(c); } });
  liberarAlTerminar(turno, proc);
  proc.emit('exit');
  assert.equal(soltados.length, 1);
  for (const [senal, codigo] of Object.entries(SENALES)) {
    proc.emit(senal);
    assert.equal(proc.salidas.at(-1), codigo, senal);
  }
  assert.equal(soltados.length, 1 + Object.keys(SENALES).length);
});

test('turno: the floor from the environment: unset -> default; number -> MB; garbage -> fails loud', () => {
  assert.equal(umbralDeEntorno({}), MIN_LIBRE_BYTES);
  assert.equal(umbralDeEntorno({ [VAR_MIN_LIBRE_MB]: '0' }), 0);
  assert.equal(umbralDeEntorno({ [VAR_MIN_LIBRE_MB]: '512' }), 512 * 1024 ** 2);
  for (const mal of ['', 'mucho', '-1']) assert.throws(() => umbralDeEntorno({ [VAR_MIN_LIBRE_MB]: mal }), /MB/);
});

test('turno: pidVivoReal reads ESRCH as dead, EPERM as alive, and rethrows anything else', () => {
  const lanza = (code) => () => { throw Object.assign(new Error(code), { code }); };
  assert.equal(pidVivoReal(5, () => true), true);
  assert.equal(pidVivoReal(5, lanza('ESRCH')), false);
  assert.equal(pidVivoReal(5, lanza('EPERM')), true);
  assert.throws(() => pidVivoReal(5, lanza('EINVAL')), /EINVAL/);
  assert.equal(pidVivoReal(process.pid), true);
});

test('done + turno: the turn is given back when the steps pass, when they fail and when they throw', () => {
  const m = mundo();
  const turno = () => tomarTurno(m.opciones);
  for (const run of [() => 0, (s) => (s === 'test' ? 1 : 0), () => 1]) {
    cliDone(run, turno);
    assert.equal(existsSync(m.ruta), false);
  }
  assert.throws(() => cliDone(() => { throw new Error('boom'); }, turno), /boom/);
  assert.equal(existsSync(m.ruta), false);
});

test('done + turno: while the steps run the turn is held; if the wait runs out no step runs and the code is DONE_TURN_TIMEOUT', () => {
  const m = mundo();
  let tenido;
  cliDone(() => { tenido = existsSync(m.ruta); return 0; }, () => tomarTurno(m.opciones));
  assert.equal(tenido, true);
  m.ponerCandado(OTHER, T0);
  const ran = [];
  const r = cliDone((s) => { ran.push(s); return 0; }, () => tomarTurno(m.opciones));
  assert.deepEqual(ran, []);
  assert.equal(r.code, EXIT.DONE_TURN_TIMEOUT);
  assert.equal(r.stdout, `${DONE_LINE.turn}\n`);
  assert.match(r.stderr, /the suite was not started/);
});
