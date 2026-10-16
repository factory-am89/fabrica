// Log of 1Password reads: one JSON line per `op` read in ~/.fabrica/op-reads.jsonl, so the number of
// reads (the quota that ran out on 2026-10-16) can be counted instead of guessed.
// Each line holds the ISO time, the script, WHAT was read as a name and the result. NEVER a value.
import * as fsReal from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const rutaDeRegistro = (casa = homedir) => join(casa(), '.fabrica', 'op-reads.jsonl');

// The script and what it read are names (a file or document name), never values: no spaces, newlines or quotes.
const FORMA_NOMBRE = /^[A-Za-z0-9._-]{1,80}$/;
// `ok` or a reason of MOTIVOS (token.mjs); the shape is checked here, the list lives in one place.
const FORMA_RESULTADO = /^[a-z][a-z0-9-]{0,40}$/;

// Appends one JSON line to a log file and creates its directory (user only). Shared by the op and gh logs.
export function anexarLinea(ruta, objeto, fs = fsReal) {
  fs.mkdirSync(dirname(ruta), { recursive: true, mode: 0o700 });
  fs.appendFileSync(ruta, `${JSON.stringify(objeto)}\n`);
}

// Appends one line. Throws if a field has the wrong shape or the disk refuses: the caller decides what to say.
export function registrarLectura({ script, nombre, resultado, ruta = rutaDeRegistro(), fs = fsReal, reloj = Date.now }) {
  if (!FORMA_NOMBRE.test(String(script)) || !FORMA_NOMBRE.test(String(nombre)) || !FORMA_RESULTADO.test(String(resultado))) {
    throw new Error('read log: field with a wrong shape (a name and a reason are expected, never a value)');
  }
  anexarLinea(ruta, { t: new Date(reloj()).toISOString(), script, leido: nombre, resultado }, fs);
}

// Reads per script: { 'token.mjs': { total, ok, error } }. No file means no reads. A broken line throws
// (a count that skips lines would be a wrong number).
export function contarLecturas({ ruta = rutaDeRegistro(), fs = fsReal } = {}) {
  let crudo;
  try {
    crudo = fs.readFileSync(ruta, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return {};
    throw e;
  }
  const cuentas = {};
  crudo.split('\n').forEach((linea, i) => {
    if (!linea) return;
    let d;
    try {
      d = JSON.parse(linea);
    } catch (e) {
      throw new Error(`read log: line ${i + 1} is not JSON`, { cause: e });
    }
    if (typeof d?.script !== 'string' || typeof d.resultado !== 'string') throw new Error(`read log: line ${i + 1} has the wrong shape`);
    const c = (cuentas[d.script] ??= { total: 0, ok: 0, error: 0 });
    c.total++;
    c[d.resultado === 'ok' ? 'ok' : 'error']++;
  });
  return cuentas;
}

export const VENTANA_MS = 60 * 60 * 1000;

// Reads inside the last VENTANA_MS, all scripts: { total, porScript, corruptas }. This is the number the read
// budget in token.mjs compares. A line that cannot be read (not JSON, wrong shape, no valid time) is NOT
// dropped: it counts as a read (it cannot be proven old) and its line number goes in `corruptas`, so the
// caller can say it. No file means no reads; any other disk error throws.
export function lecturasRecientes({ ruta = rutaDeRegistro(), fs = fsReal, reloj = Date.now, ventanaMs = VENTANA_MS } = {}) {
  let crudo;
  try {
    crudo = fs.readFileSync(ruta, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return { total: 0, porScript: {}, corruptas: [] };
    throw e;
  }
  const desde = reloj() - ventanaMs;
  const porScript = {};
  const corruptas = [];
  let total = 0;
  crudo.split('\n').forEach((linea, i) => {
    if (!linea) return;
    let d;
    try {
      d = JSON.parse(linea);
    } catch {
      d = null;
    }
    const t = typeof d?.t === 'string' ? Date.parse(d.t) : Number.NaN;
    const valida = typeof d?.script === 'string' && !Number.isNaN(t);
    if (!valida) corruptas.push(i + 1);
    else if (t <= desde) return;
    const script = valida ? d.script : '(unreadable line)';
    porScript[script] = (porScript[script] ?? 0) + 1;
    total++;
  });
  return { total, porScript, corruptas };
}
