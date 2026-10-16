// Register of live sessions: one small JSON file per session in ~/.fabrica/sesiones/<id>.json, outside the repo, so every
// folder (worktree) of this PC sees the others. A file holds: id, carpeta, rama, inicio, ultima (ISO times). Nothing else:
// no prompt, no tool name, no free text. The shapes below are the only place that lists them.
// A session writes only its own file (it is overwritten, so anexarLinea of registro-op.mjs does not fit; the directory
// mode and the "no file means nothing" rule are the same as in the other logs).
import * as fsReal from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// A session with no activity for more than ACTIVA_H hours is shown as inactive; one with none for CADUCA_H hours is purged.
export const ACTIVA_H = 3;
export const CADUCA_H = 48;
export const CAMPOS = ['id', 'carpeta', 'rama', 'inicio', 'ultima'];
export const SIN_RAMA = 'sin-rama';

export const FORMA_ID = /^[\w-]{6,80}$/;
export const FORMA_RAMA = /^[\w./-]{1,100}$/;
// A path: no control characters (so no newline), as long as Windows allows.
// eslint-disable-next-line no-control-regex -- the control characters are exactly what is refused
const FORMA_CARPETA = /^[^\u0000-\u001f]{1,260}$/u;

export const rutaDeSesiones = (casa = homedir) => join(casa(), '.fabrica', 'sesiones');

// A value is checked against its shape only if it is a string (String(undefined) would pass as «undefined»).
const con = (re, x) => typeof x === 'string' && re.test(x);
export const idValido = (x) => con(FORMA_ID, x);
const esHora = (x) => typeof x === 'string' && !Number.isNaN(Date.parse(x));
const ESTA_LIB = 'session register:';

// Throws unless the object is a valid file; returns it. Used when writing and when reading.
export function validarFicha(f) {
  const bien = f && typeof f === 'object' && Object.keys(f).join() === CAMPOS.join()
    && idValido(f.id) && con(FORMA_CARPETA, f.carpeta) && con(FORMA_RAMA, f.rama)
    && esHora(f.inicio) && esHora(f.ultima);
  if (!bien) throw new Error(`${ESTA_LIB} field with a wrong shape (an id, a folder, a branch and two times are expected, nothing else)`);
  return f;
}

// A file that is not JSON or has a wrong shape: the two ways a file can be "unreadable"; anything else (disk) is rethrown.
const esFichaRota = (e) => e instanceof SyntaxError || String(e?.message).startsWith(ESTA_LIB);

const ficheroDe = (dir, id) => join(dir, `${id}.json`);

// Writes (or rewrites) the file of a session; `inicio` is kept from the previous file when there is one.
// Written to a temp name and renamed, so a reader never sees half a file. Throws on a bad field or a refusing disk.
// A previous file that is broken THROWS: it is not healed in silence. `reescribirRota: true` rewrites it (the caller must have named it first).
export function apuntarSesion({ id, carpeta, rama }, { dir = rutaDeSesiones(), fs = fsReal, reloj = Date.now, reescribirRota = false } = {}) {
  if (!idValido(id)) throw new Error(`${ESTA_LIB} field with a wrong shape (a session id is expected)`);
  const ahora = new Date(reloj()).toISOString();
  let inicio = ahora;
  try {
    inicio = validarFicha(JSON.parse(fs.readFileSync(ficheroDe(dir, id), 'utf8'))).inicio;
  } catch (e) {
    // No previous file is the normal case; a broken one is only replaced when the caller asked for it.
    if (e?.code !== 'ENOENT' && !(reescribirRota && esFichaRota(e))) throw e;
  }
  const ficha = validarFicha({ id, carpeta, rama, inicio, ultima: ahora });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `${id}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(ficha)}\n`);
  fs.renameSync(tmp, ficheroDe(dir, id));
  return ficha;
}

// The file of a session, or null when it has none. A broken file throws (the caller decides).
export function leerFicha(id, { dir = rutaDeSesiones(), fs = fsReal } = {}) {
  try {
    return validarFicha(JSON.parse(fs.readFileSync(ficheroDe(dir, id), 'utf8')));
  } catch (e) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
}

export function quitarSesion(id, { dir = rutaDeSesiones(), fs = fsReal } = {}) {
  if (!idValido(id)) throw new Error(`${ESTA_LIB} field with a wrong shape (a session id is expected)`);
  fs.rmSync(ficheroDe(dir, id), { force: true });
}

// The registered sessions: { sesiones: [{ ...ficha, horas, activa }], corruptas: [file names] }. No directory means none.
// A file that cannot be read is NOT dropped: its name goes in `corruptas`, so the caller can say it.
export function leerSesiones({ dir = rutaDeSesiones(), fs = fsReal, reloj = Date.now } = {}) {
  let nombres;
  try {
    nombres = fs.readdirSync(dir);
  } catch (e) {
    if (e?.code === 'ENOENT') return { sesiones: [], corruptas: [] };
    throw e;
  }
  const ahora = reloj();
  const sesiones = [];
  const corruptas = [];
  for (const nombre of nombres.filter((n) => n.endsWith('.json')).sort()) {
    try {
      const f = validarFicha(JSON.parse(fs.readFileSync(join(dir, nombre), 'utf8')));
      const horas = (ahora - Date.parse(f.ultima)) / 36e5;
      sesiones.push({ ...f, horas, activa: horas <= ACTIVA_H });
    } catch (e) {
      if (!esFichaRota(e)) throw e;
      corruptas.push(nombre);
    }
  }
  return { sesiones, corruptas };
}

// Deletes the files of sessions with no activity for more than CADUCA_H hours (a session that fell without closing).
// Returns the ids deleted. Unreadable files are left alone: leerSesiones reports them.
export function purgarViejas({ dir = rutaDeSesiones(), fs = fsReal, reloj = Date.now } = {}) {
  const { sesiones } = leerSesiones({ dir, fs, reloj });
  const viejas = sesiones.filter((s) => s.horas > CADUCA_H);
  for (const s of viejas) fs.rmSync(ficheroDe(dir, s.id), { force: true });
  return viejas.map((s) => s.id);
}
