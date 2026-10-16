// Log of human interventions: one JSON line per event in ~/.fabrica/intervenciones.jsonl, so how often Pablo has to
// step in can be counted by class instead of guessed (plan-buenas-practicas, section 2).
// A line holds: t (ISO time, or null for origen bang-sin-hora), clase (CLASES), origen (ORIGENES). Nothing else: no command text, no path, no tool name,
// no session id. The vocabularies below are the only place that lists them.
import * as fsReal from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { anexarLinea } from './op-log.mjs';

export const CLASES = [
  'aprobar-puerta', 'alta-de-credencial', 'ampliar-permisos', 'traspaso-de-propiedad', 'aviso-de-permiso',
  'decision-de-proceso', 'decision-de-producto', 'desatasco', 'correccion-de-agente', 'sin-clasificar',
];
// Where the event was seen: `bang` is a `!` command Pablo typed in the session; `permiso` is a PermissionRequest hook;
// `bang-sin-hora` is a `!` whose transcript line has no readable time: it is logged with `t` null (never a made-up time).
export const ORIGENES = ['bang', 'permiso', 'bang-sin-hora'];
export const SIN_HORA = 'bang-sin-hora';
export const CAMPOS = ['t', 'clase', 'origen'];

export const rutaDeRegistroIntervenciones = (casa = homedir) => join(casa(), '.fabrica', 'intervenciones.jsonl');

// Appends one line. Throws if a field is outside the vocabulary or the disk refuses: the caller decides what to say.
export function registrarIntervencion({ clase, origen, ruta = rutaDeRegistroIntervenciones(), fs = fsReal, reloj = Date.now }) {
  if (!CLASES.includes(clase) || !ORIGENES.includes(origen)) {
    throw new Error('intervention log: field outside the vocabulary (a class and an origin are expected, nothing else)');
  }
  anexarLinea(ruta, { t: origen === SIN_HORA ? null : new Date(reloj()).toISOString(), clase, origen }, fs);
}

const vacio = (lista) => Object.fromEntries(lista.map((x) => [x, 0]));

// Events per class and per origin: { total, porClase, porOrigen, corruptas }. Every class is listed, also with 0.
// No file means no events. A line that cannot be read (not JSON, a field outside the vocabulary, no valid time) is NOT
// skipped: it counts in `total` and its line number goes in `corruptas`, so the caller can say it. Any other disk error throws.
export function contarIntervenciones({ ruta = rutaDeRegistroIntervenciones(), fs = fsReal } = {}) {
  const cuentas = { total: 0, porClase: vacio(CLASES), porOrigen: vacio(ORIGENES), corruptas: [] };
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
    const valida = CLASES.includes(d?.clase) && ORIGENES.includes(d.origen) && (d.origen === SIN_HORA ? d.t === null : typeof d.t === 'string' && !Number.isNaN(Date.parse(d.t)));
    if (!valida) {
      cuentas.corruptas.push(i + 1);
      return;
    }
    cuentas.porClase[d.clase]++;
    cuentas.porOrigen[d.origen]++;
  });
  return cuentas;
}
