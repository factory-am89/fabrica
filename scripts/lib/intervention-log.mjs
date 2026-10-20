// Log of human interventions: one JSON line per event in ~/.fabrica/intervenciones.jsonl, so how often Pablo has to
// step in can be counted by class instead of guessed (plan-buenas-practicas, section 2).
// A line holds: t (ISO time, or null for origen bang-sin-hora), clase (CLASES), origen (ORIGENES), falta (FALTAS: what the system lacked, so
// Pablo had to step in) and, only when falta is `otro`, a short motivo. Lines written before `falta` existed have no falta and are not migrated.
// Nothing else: no command text, no path, no tool name, no session id. The vocabularies below are the only place that lists them.
import * as fsReal from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { anexarLinea } from './op-log.mjs';

export const CLASES = [
  'aprobar-puerta', 'alta-de-credencial', 'ampliar-permisos', 'traspaso-de-propiedad', 'aviso-de-permiso',
  'decision-de-proceso', 'decision-de-producto', 'desatasco', 'correccion-de-agente', 'sin-clasificar',
  'contexto-aportado', 'pregunta-fuera-de-lista', 'revision-de-diff',
];
// What the system lacked. `sin-clasificar` is the honest value when the class does not say (it is counted, never replaced by a guess).
export const FALTAS = ['intencion', 'autoridad', 'conocimiento', 'verificacion', 'acceso', 'memoria', 'otro', 'sin-clasificar'];
// The way out for each lack: how to stop needing Pablo for it. intencion and autoridad are the legitimate residue.
export const CAMINOS = {
  conocimiento: 'datos legibles: el dato existia y no estaba legible; se escribe donde el agente lo lee',
  verificacion: 'maquina u otro agente: un check o un revisor juzga la calidad',
  acceso: 'automatizar: el clic o la credencial lo hace un mecanismo',
  memoria: 'leccion, skill o check: la orden repetida se escribe una vez',
  intencion: 'residuo legitimo: solo Pablo sabe que quiere',
  autoridad: 'residuo legitimo: las cuatro clases de standards/intervention.md',
};
// Class -> falta, only where the class says it without doubt. The others (aviso-de-permiso may be acceso or autoridad, desatasco, decision-de-proceso,
// correccion-de-agente, pregunta-fuera-de-lista) get `sin-clasificar` unless the caller says it.
export const FALTA_DE_CLASE = {
  'aprobar-puerta': 'autoridad',
  'alta-de-credencial': 'acceso',
  'ampliar-permisos': 'autoridad',
  'traspaso-de-propiedad': 'autoridad',
  'decision-de-producto': 'intencion',
  'contexto-aportado': 'conocimiento',
  'revision-de-diff': 'verificacion',
};
// Where the event was seen: `bang` is a `!` command Pablo typed in the session; `permiso` is a PermissionRequest hook;
// `bang-sin-hora` is a `!` whose transcript line has no readable time: it is logged with `t` null (never a made-up time).
// `agente` is a mark an agent wrote itself (`node scripts/hitl.mjs marcar`): self-declared, nobody checks it.
export const ORIGEN_AGENTE = 'agente';
export const ORIGENES = ['bang', 'permiso', 'bang-sin-hora', ORIGEN_AGENTE];
export const SIN_HORA = 'bang-sin-hora';
export const CAMPOS = ['t', 'clase', 'origen', 'falta'];
export const MAX_MOTIVO = 200;

const motivoValido = (falta, motivo) => (falta === 'otro' ? typeof motivo === 'string' && motivo.trim() !== '' && motivo.length <= MAX_MOTIVO && !motivo.includes('\n') : motivo === undefined);

export const rutaDeRegistroIntervenciones = (casa = homedir) => join(casa(), '.fabrica', 'intervenciones.jsonl');

// Appends one line. Throws if a field is outside the vocabulary or the disk refuses: the caller decides what to say.
export function registrarIntervencion({ clase, origen, falta = FALTA_DE_CLASE[clase] ?? 'sin-clasificar', motivo, ruta = rutaDeRegistroIntervenciones(), fs = fsReal, reloj = Date.now }) {
  if (!CLASES.includes(clase) || !ORIGENES.includes(origen) || !FALTAS.includes(falta)) {
    throw new Error('intervention log: field outside the vocabulary (a class, an origin and a falta are expected, nothing else)');
  }
  if (!motivoValido(falta, motivo)) throw new Error(`intervention log: motivo is required with falta otro and refused with any other (one line of at most ${MAX_MOTIVO} characters)`);
  anexarLinea(ruta, { t: origen === SIN_HORA ? null : new Date(reloj()).toISOString(), clase, origen, falta, ...(falta === 'otro' ? { motivo } : {}) }, fs);
}

const vacio = (lista) => Object.fromEntries(lista.map((x) => [x, 0]));

// Events per class, origin and falta: { total, porClase, porOrigen, porFalta, sinFalta, corruptas }. `sinFalta` counts the old lines (no falta, not migrated). Every class is listed, also with 0.
// No file means no events. A line that cannot be read (not JSON, a field outside the vocabulary, no valid time) is NOT
// skipped: it counts in `total` and its line number goes in `corruptas`, so the caller can say it. Any other disk error throws.
export function contarIntervenciones({ ruta = rutaDeRegistroIntervenciones(), fs = fsReal } = {}) {
  const cuentas = { total: 0, porClase: vacio(CLASES), porOrigen: vacio(ORIGENES), porFalta: vacio(FALTAS), sinFalta: 0, corruptas: [] };
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
    const valida = CLASES.includes(d?.clase) && ORIGENES.includes(d.origen) && (d.origen === SIN_HORA ? d.t === null : typeof d.t === 'string' && !Number.isNaN(Date.parse(d.t)))
      && (d.falta === undefined ? d.motivo === undefined : FALTAS.includes(d.falta) && motivoValido(d.falta, d.motivo));
    if (!valida) {
      cuentas.corruptas.push(i + 1);
      return;
    }
    cuentas.porClase[d.clase]++;
    cuentas.porOrigen[d.origen]++;
    if (d.falta === undefined) cuentas.sinFalta++;
    else cuentas.porFalta[d.falta]++;
  });
  return cuentas;
}
