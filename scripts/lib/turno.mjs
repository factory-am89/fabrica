// Turn for `npm run done`: one suite at a time on the machine, and only when there is memory to run it.
// Measured 21 oct 2026: several builders ran `done` together with ~2.2 GB free of 16 GB and the system killed
// background processes for lack of memory. So: a lock file in ~/.fabrica/ (one holder at a time) and a floor of free memory.
// Everything outside the pure logic (clock, sleeping, free memory, live pids, files, printing) is injected.
import * as fsReal from 'node:fs';
import { freemem, homedir } from 'node:os';
import { join } from 'node:path';
import { ExitError } from './exit.mjs';

export const rutaDeCandadoDone = (casa = homedir) => join(casa(), '.fabrica', 'done.lock');

// Free memory below which the suite does not start: the machine had 2.2 GB free of 16 GB and processes died, so 3 GiB.
export const MIN_LIBRE_BYTES = 3 * 1024 ** 3;
// Longest a run waits for its turn plus memory; past it, it fails (never starts anyway). A suite takes minutes, so 30 min is a long queue.
export const ESPERA_MAX_MS = 30 * 60 * 1000;
// A lock older than this is not a suite in progress, even if its pid is alive (a hung process or a reused pid).
export const CANDADO_MAX_EDAD_MS = 45 * 60 * 1000;
// How often the wait looks again.
export const SONDEO_MS = 5000;
// Overrides the floor (in MB) for the tests of the real process; the run says it on screen when it is set.
export const VAR_MIN_LIBRE_MB = 'FABRICA_DONE_MIN_LIBRE_MB';

// Reads the floor from the environment: unset -> MIN_LIBRE_BYTES; set but not a number >= 0 -> fails loudly.
export function umbralDeEntorno(env) {
  const v = env[VAR_MIN_LIBRE_MB];
  if (v === undefined) return MIN_LIBRE_BYTES;
  const mb = Number(v);
  if (v.trim() === '' || !Number.isFinite(mb) || mb < 0) throw new Error(`${VAR_MIN_LIBRE_MB}=«${v}» is not a number of MB >= 0`);
  return mb * 1024 ** 2;
}

// Is that pid a live process? EPERM means it lives but is not ours; ESRCH means it is gone; anything else is an error.
export function pidVivoReal(pid, kill = process.kill.bind(process)) {
  try { kill(pid, 0); return true; } catch (e) {
    if (e.code === 'ESRCH') return false;
    if (e.code === 'EPERM') return true;
    throw e;
  }
}

// Sleeps in the same thread (the whole of `done` is synchronous).
export const dormirReal = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const GiB = (b) => (b / 1024 ** 3).toFixed(1);
const dosDigitos = (n) => String(Math.floor(n)).padStart(2, '0');
const minutos = (ms) => `${Math.floor(ms / 60000)}m${dosDigitos((ms % 60000) / 1000)}s`;

function leer(fs, ruta) {
  let texto;
  try { texto = fs.readFileSync(ruta, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  try {
    const d = JSON.parse(texto);
    if (Number.isInteger(d?.pid) && Number.isFinite(Date.parse(d?.desde))) return { texto, ...d };
  } catch { /* not JSON: handled below as unreadable, never as stale */ }
  return { texto, ilegible: true };
}

// Takes the lock or reports who holds it. Returns { tomado: true } or { tomado: false, dueno }.
function intentar({ fs, ruta, pid, ahora, pidVivo, edadMax, decir }) {
  fs.mkdirSync(join(ruta, '..'), { recursive: true });
  try {
    fs.writeFileSync(ruta, JSON.stringify({ pid, desde: new Date(ahora()).toISOString() }), { flag: 'wx' });
    return { tomado: true };
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  const dueno = leer(fs, ruta);
  if (dueno === null) return { tomado: false, dueno }; // vanished between the two calls: try again at once
  if (dueno.ilegible) return { tomado: false, dueno };
  const edad = ahora() - Date.parse(dueno.desde);
  const motivo = !pidVivo(dueno.pid) ? `its process ${dueno.pid} is dead` : edad > edadMax ? `it is ${minutos(edad)} old (more than ${minutos(edadMax)})` : null;
  if (motivo === null) return { tomado: false, dueno };
  // Remove only the very lock we judged stale; if it changed meanwhile, someone else took it.
  const ahoraEs = leer(fs, ruta);
  if (ahoraEs?.texto === dueno.texto) {
    fs.rmSync(ruta);
    decir(`done: removed the lock of pid ${dueno.pid} (since ${dueno.desde}): ${motivo}`);
  }
  return { tomado: false, dueno: null };
}

// Removes the lock only if it is ours.
function soltar({ fs, ruta, pid }) {
  const d = leer(fs, ruta);
  if (d && d.pid === pid) fs.rmSync(ruta);
}

// Waits for its turn and for free memory. Returns { soltar } (idempotent). Throws ExitError('DONE_TURN_TIMEOUT') when
// ESPERA_MAX_MS runs out; the lock is then released first, and the suite is never started.
export function tomarTurno({
  fs = fsReal, ruta = rutaDeCandadoDone(), pid = process.pid, ahora = Date.now, dormir = dormirReal, pidVivo = pidVivoReal,
  libre = freemem, minLibre = MIN_LIBRE_BYTES, esperaMax = ESPERA_MAX_MS, edadMax = CANDADO_MAX_EDAD_MS, sondeo = SONDEO_MS,
  decir = (m) => console.error(m),
} = {}) {
  const limite = ahora() + esperaMax;
  const alFallar = (que) => new ExitError('DONE_TURN_TIMEOUT', `done: gave up after ${minutos(esperaMax)} waiting for ${que}; the suite was not started`);
  let ultimo = '';
  const avisar = (m) => { if (m !== ultimo) { ultimo = m; decir(m); } };
  for (;;) {
    const r = intentar({ fs, ruta, pid, ahora, pidVivo, edadMax, decir });
    if (r.tomado) break;
    if (ahora() >= limite) throw alFallar(r.dueno?.ilegible ? `the lock ${ruta} (unreadable)` : `the turn of pid ${r.dueno?.pid ?? '(changing hands)'}`);
    if (r.dueno?.ilegible) avisar(`done: waiting: the lock ${ruta} cannot be read (pid and time unknown)`);
    else if (r.dueno) avisar(`done: waiting for my turn: pid ${r.dueno.pid} has been running done since ${r.dueno.desde}`);
    if (r.dueno !== null && r.dueno !== undefined) dormir(sondeo);
  }
  const liberar = () => soltar({ fs, ruta, pid });
  try {
    while (libre() < minLibre) {
      if (ahora() >= limite) throw alFallar(`free memory (${GiB(libre())} GiB free, ${GiB(minLibre)} GiB needed)`);
      avisar(`done: waiting for memory: ${GiB(libre())} GiB free, ${GiB(minLibre)} GiB needed`);
      dormir(sondeo);
    }
  } catch (e) { liberar(); throw e; }
  return { soltar: liberar };
}

// Releases the lock whatever way the process ends: a signal or the exit itself. `proc` is process (injectable).
export const SENALES = Object.freeze({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129 });
export function liberarAlTerminar(turno, proc = process) {
  proc.on('exit', () => turno.soltar());
  for (const [senal, codigo] of Object.entries(SENALES)) proc.on(senal, () => { turno.soltar(); proc.exit(codigo); });
}
