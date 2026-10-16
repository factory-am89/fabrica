// The split of work, versioned: reparto.json at the repo root says which branch carries which files, until when.
// Machine-readable and closed: { "reservas": [{ "rama", "ficheros": [paths], "hasta": ISO time }] }, no free text.
// A path ending in a slash reserves the whole folder. The reservation belongs to a BRANCH; it counts only while a live
// (active) session is on that branch and until `hasta`.
import * as fsReal from 'node:fs';
import { join } from 'node:path';
import { FORMA_RAMA } from './session-log.mjs';

export const FICHERO_REPARTO = 'reparto.json';
const FORMA_FICHERO = /^[\w./@-]{1,200}$/;

// Throws unless `datos` has the closed shape; returns it.
export function validarReparto(datos) {
  const mal = (m) => { throw new Error(`reparto.json: ${m}`); };
  if (!datos || typeof datos !== 'object' || Object.keys(datos).join() !== 'reservas' || !Array.isArray(datos.reservas)) mal('expected { "reservas": [...] } and nothing else');
  datos.reservas.forEach((r, i) => {
    if (!r || typeof r !== 'object' || Object.keys(r).join() !== 'rama,ficheros,hasta') mal(`reserva ${i + 1}: expected rama, ficheros and hasta, nothing else`);
    if (typeof r.rama !== 'string' || !FORMA_RAMA.test(r.rama)) mal(`reserva ${i + 1}: rama with a wrong shape`);
    if (!Array.isArray(r.ficheros) || r.ficheros.length === 0 || !r.ficheros.every((f) => typeof f === 'string' && FORMA_FICHERO.test(f))) mal(`reserva ${i + 1}: ficheros must be a non-empty list of paths`);
    if (typeof r.hasta !== 'string' || Number.isNaN(Date.parse(r.hasta))) mal(`reserva ${i + 1}: hasta must be an ISO time`);
  });
  return datos;
}

// The reservations in `<raiz>/reparto.json`. No file means no reservations; a file that is not JSON or has a wrong shape throws.
export function leerReparto(raiz, fs = fsReal) {
  let crudo;
  try {
    crudo = fs.readFileSync(join(raiz, FICHERO_REPARTO), 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return { reservas: [] };
    throw e;
  }
  let datos;
  try {
    datos = JSON.parse(crudo);
  } catch (e) {
    throw new Error('reparto.json: not JSON', { cause: e });
  }
  return validarReparto(datos);
}

// Do two reservations cover a common file? Same path, or one is a folder (ends in a slash) that holds the other.
export const solapan = (a, b) => a === b || (a.endsWith('/') && b.startsWith(a)) || (b.endsWith('/') && a.startsWith(b));

// The reservations of OTHER branches that are in force: not expired and with an active session on that branch.
// [{ rama, ficheros, hasta, sesion: { id, carpeta } }]. Pure: the clock is a parameter.
export function reservasVivasAjenas({ reservas }, sesiones, miRama, ahora) {
  const out = [];
  for (const r of reservas) {
    if (r.rama === miRama || Date.parse(r.hasta) <= ahora) continue;
    const sesion = sesiones.find((s) => s.activa && s.rama === r.rama);
    if (sesion) out.push({ ...r, sesion: { id: sesion.id, carpeta: sesion.carpeta } });
  }
  return out;
}

// Files my own reservations in force share with a reservation in force of another branch: [{ rama, fichero }].
export function choques({ reservas }, ajenas, miRama, ahora) {
  const mias = reservas.filter((r) => r.rama === miRama && Date.parse(r.hasta) > ahora).flatMap((r) => r.ficheros);
  const out = [];
  for (const a of ajenas) for (const f of a.ficheros) if (mias.some((m) => solapan(m, f))) out.push({ rama: a.rama, fichero: f });
  return out;
}
