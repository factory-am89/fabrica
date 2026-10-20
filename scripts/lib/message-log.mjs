// Log of Pablo's messages: one JSON line per message in ~/.fabrica/mensajes.jsonl, so how many times Pablo wrote in a
// session can be counted from a source that does not depend on what an agent declares.
// A line holds: t (ISO time) and sesion (the session id, so a line can be filtered by session). NEVER the text of the
// message, nor the folder, nor anything else (privacy; same criterion as intervention-log.mjs).
import * as fsReal from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { anexarLinea } from './op-log.mjs';
import { esHora, idValido } from './session-log.mjs';

export const CAMPOS = ['t', 'sesion'];
export const rutaDeMensajes = (casa = homedir) => join(casa(), '.fabrica', 'mensajes.jsonl');

// Appends one line. Throws if the session id has a wrong shape or the disk refuses: the caller decides what to say.
export function registrarMensaje({ sesion, ruta = rutaDeMensajes(), fs = fsReal, reloj = Date.now }) {
  if (!idValido(sesion)) throw new Error('message log: a valid session id is expected');
  anexarLinea(ruta, { t: new Date(reloj()).toISOString(), sesion }, fs);
}

// Messages: { total, porSesion, corruptas }. No file means no messages. A line that cannot be read (not JSON, wrong
// fields, no valid time) is NOT skipped: it counts in `total` and its line number goes in `corruptas`.
// `alLeer({t, sesion})`, if given, is called once for each readable line, so a caller can place messages in time.
export function contarMensajes({ ruta = rutaDeMensajes(), fs = fsReal, alLeer = () => {} } = {}) {
  const cuentas = { total: 0, porSesion: {}, corruptas: [] };
  let crudo;
  try {
    crudo = fs.readFileSync(ruta, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return cuentas;
    throw e;
  }
  crudo.split('\n').forEach((linea, i) => {
    if (!linea) return;
    let d;
    try {
      d = JSON.parse(linea);
    } catch {
      d = null;
    }
    cuentas.total++;
    const valida = d !== null && typeof d === 'object' && Object.keys(d).sort().join() === [...CAMPOS].sort().join()
      && idValido(d.sesion) && esHora(d.t);
    if (!valida) {
      cuentas.corruptas.push(i + 1);
      return;
    }
    alLeer({ t: d.t, sesion: d.sesion });
    cuentas.porSesion[d.sesion] = (cuentas.porSesion[d.sesion] ?? 0) + 1;
  });
  return cuentas;
}
