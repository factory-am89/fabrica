// Live sessions of Claude on this PC (register in scripts/lib/registro-sesiones.mjs) and the split of work (reparto.json).
//   npm run sesiones [-- --json]   lists the registered sessions; one without activity for ACTIVA_H hours shows as inactive.
//   sesiones.mjs tocar|fin         hook modes (hook JSON on stdin), wired in .claude/settings.json:
//     tocar  UserPromptSubmit and PostToolBatch: the session did something -> its `ultima` is updated (a session that has
//            no file yet, e.g. started before this existed, gets one). Documented events with session_id and cwd in the
//            common input (https://code.claude.com/docs/en/hooks).
//     fin    SessionEnd: the session closed -> its file is deleted.
// The register itself (one line per session at start) is the step `sesiones` of scripts/al-arrancar.mjs.
// A failure in a hook mode is said on stderr and exits 1 (a non-blocking error for Claude Code): the session goes on, the failure is seen.
import { freemem, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';
import { git, principal } from './lib/carpetas.mjs';
import {
  ACTIVA_H, CADUCA_H, SIN_RAMA, idValido, apuntarSesion, leerFicha, leerSesiones, purgarViejas, quitarSesion, rutaDeSesiones,
} from './lib/registro-sesiones.mjs';
import { choques, leerReparto, reservasVivasAjenas } from './lib/reparto.mjs';

// The branch of a folder; a detached HEAD is SIN_RAMA. A folder that is not a repo throws.
export function ramaDe(carpeta) {
  const r = git(['branch', '--show-current'], carpeta);
  if (r.status !== 0) throw new Error(`no pude leer la rama de ${carpeta}: ${r.stderr.trim()}`);
  return r.stdout.trim() || SIN_RAMA;
}

const MIB = 1024 * 1024;
const memoriaReal = () => ({ libre: freemem(), total: totalmem() });

const unidad = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// The step of the start-up (scripts/al-arrancar.mjs): registers this session, purges the fallen ones, says how many are
// alive and the free memory, and warns about the files that another live session has reserved in reparto.json.
// Everything it reads from outside is injectable: the register directory, the clock, the memory, the branch and the root.
export const pasoSesiones = ({
  dir = rutaDeSesiones(), reloj = Date.now, memoria = memoriaReal, rama = ramaDe, raiz = principal, fs,
} = {}) => ({
  nombre: 'sesiones',
  ejecutar: (escribir, entrada) => {
    const id = entrada?.session_id;
    if (!idValido(id)) throw new Error('el gancho no trae un session_id válido; esta sesión no queda registrada');
    if (typeof entrada.cwd !== 'string' || entrada.cwd === '') throw new Error('el gancho no trae cwd; esta sesión no queda registrada');
    const carpeta = entrada.cwd;
    const miRama = rama(carpeta);
    const opciones = { dir, reloj, ...(fs ? { fs } : {}) };
    // Unreadable files are read BEFORE registering, so a broken file of this very session is named too, not healed in silence.
    const { corruptas } = leerSesiones(opciones);
    if (corruptas.includes(`${id}.json`)) escribir(`sesiones: la ficha de esta sesión (${id}.json) está ilegible; se reescribe y el paso falla para que se sepa`);
    apuntarSesion({ id, carpeta, rama: miRama }, { ...opciones, reescribirRota: true });
    const viejas = purgarViejas(opciones);
    const { sesiones } = leerSesiones(opciones);
    const activas = sesiones.filter((s) => s.activa).length;
    const m = memoria();
    escribir(`sesiones: ${unidad(activas, 'activa', 'activas')} de ${unidad(sesiones.length, 'registrada', 'registradas')} (esta: ${id.slice(0, 8)}, ${miRama}) · memoria libre ${Math.round(m.libre / MIB)} de ${Math.round(m.total / MIB)} MiB · detalle: npm run sesiones`);
    if (viejas.length > 0) escribir(`sesiones: ${unidad(viejas.length, 'ficha borrada', 'fichas borradas')} por llevar más de ${CADUCA_H} h sin actividad`);
    const reparto = leerReparto(raiz(carpeta), fs);
    const ahora = reloj();
    const ajenas = reservasVivasAjenas(reparto, sesiones, miRama, ahora);
    for (const a of ajenas) {
      escribir(`AVISO DE REPARTO: la rama ${a.rama} (sesión ${a.sesion.id.slice(0, 8)}, ${a.sesion.carpeta}) tiene reservado ${a.ficheros.join(', ')} hasta ${a.hasta}; no lo edites sin avisar`);
    }
    for (const c of choques(reparto, ajenas, miRama, ahora)) {
      escribir(`AVISO DE REPARTO: tu rama ${miRama} reserva ${c.fichero}, que choca con la reserva de ${c.rama}`);
    }
    if (corruptas.length > 0) throw new Error(`fichas de sesión ilegibles (bórralas o corrígelas): ${corruptas.join(', ')}`);
  },
});

// Hook mode `tocar`. `entrada` is the hook JSON. Returns the file written.
export function tocar(entrada, { dir = rutaDeSesiones(), reloj = Date.now, rama = ramaDe, fs } = {}) {
  const id = entrada?.session_id;
  if (!idValido(id)) throw new Error('hook input without a valid session_id');
  const opciones = { dir, reloj, ...(fs ? { fs } : {}) };
  const previa = leerFicha(id, opciones);
  if (!previa && (typeof entrada.cwd !== 'string' || entrada.cwd === '')) throw new Error('hook input without cwd and no file for this session');
  const carpeta = previa?.carpeta ?? entrada.cwd;
  return apuntarSesion({ id, carpeta, rama: previa?.rama ?? rama(carpeta) }, opciones);
}

export function fin(entrada, opciones = {}) {
  quitarSesion(entrada?.session_id, opciones);
}

// The listing: { texto, json, corruptas }. Pure apart from reading the register.
export function listado({ dir = rutaDeSesiones(), reloj = Date.now, fs, json = false } = {}) {
  const { sesiones, corruptas } = leerSesiones({ dir, reloj, ...(fs ? { fs } : {}) });
  const activas = sesiones.filter((s) => s.activa).length;
  const cuerpo = { registro: dir, activas, inactivas: sesiones.length - activas, sesiones, corruptas };
  if (json) return { texto: JSON.stringify(cuerpo, null, 2), corruptas };
  const lineas = [`${unidad(activas, 'sesión activa', 'sesiones activas')}, ${unidad(sesiones.length - activas, 'inactiva', 'inactivas')} (sin actividad más de ${ACTIVA_H} h) · registro: ${dir}`];
  for (const s of sesiones) lineas.push(`${s.activa ? 'activa  ' : 'inactiva'}  ${s.id}  ${s.rama}  ${s.carpeta}  última actividad hace ${s.horas.toFixed(1)} h`);
  return { texto: lineas.join('\n'), corruptas };
}

async function leerEntrada() {
  let crudo = '';
  for await (const trozo of process.stdin) crudo += trozo;
  return JSON.parse(crudo);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const modo = process.argv[2];
    if (modo === 'tocar') tocar(await leerEntrada());
    else if (modo === 'fin') fin(await leerEntrada());
    else if (modo === undefined || modo === '--json') {
      const { texto, corruptas } = listado({ json: modo === '--json' });
      console.log(texto);
      if (corruptas.length > 0) throw new Error(`fichas ilegibles: ${corruptas.join(', ')}`);
    } else throw new Error('usage: sesiones.mjs [--json] | tocar | fin (hook JSON on stdin)');
  } catch (e) {
    console.error(`sesiones: ${e.message}`);
    process.exit(1);
  }
}
