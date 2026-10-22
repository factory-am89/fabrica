// Paso «al-dia» del arranque: la carpeta principal avanza con `git pull --ff-only`.
// Si no puede (cambios sin guardar, divergente, sin red, rama suelta) no toca nada y lo dice como fallo.
// Nunca rebase, reset ni stash: solo avanza una rama que no tiene nada propio que perder.
// Un pull cada vez: dos sesiones que arrancan juntas se pisan .git/FETCH_HEAD y fallan («Cannot fast-forward to
// multiple branches», 21 oct 2026; medido en carpetas temporales: 50 de 50 a la vez). El turno es el de lib/turno.mjs.
import path from 'node:path';
import { git, gitOk, principal } from './lib/folders.mjs';
import { tomarTurno } from './lib/turno.mjs';

// Sin suelo de memoria; un pull tarda segundos: 2 min de cola es mucha y un candado de más de 5 min no es un pull en marcha.
const TURNO = { minLibre: 0, esperaMax: 2 * 60 * 1000, edadMax: 5 * 60 * 1000, sondeo: 500, quien: 'al-dia', tarea: 'the pull' };
export const rutaDeCandadoAlDia = (raiz) => path.join(raiz, '.git', 'fabrica-al-dia.lock');

export function alDia(raiz = principal(process.cwd()), turno = (r) => tomarTurno({ ...TURNO, ruta: rutaDeCandadoAlDia(r) })) {
  let mio;
  try {
    mio = turno(raiz);
  } catch (e) {
    return { ok: false, motivo: `no conseguí turno para el pull de ${raiz}: ${e.message}` };
  }
  try {
    return avanzar(raiz);
  } finally {
    mio.soltar();
  }
}

function avanzar(raiz) {
  const estado = git(['status', '--porcelain'], raiz);
  if (estado.status !== 0) return { ok: false, motivo: `no pude mirar el estado de ${raiz}: ${estado.stderr.trim()}` };
  if (estado.stdout.trim()) return { ok: false, motivo: `la carpeta principal ${raiz} tiene cambios sin guardar; no la toco` };
  const antes = gitOk(['rev-parse', 'HEAD'], raiz);
  const r = git(['pull', '--ff-only'], raiz);
  if (r.status !== 0) return { ok: false, motivo: `la carpeta principal ${raiz} no pudo avanzar (git pull --ff-only): ${(r.stderr.trim() || r.stdout.trim()).split(/\r?\n/).join(' | ')}` };
  const despues = gitOk(['rev-parse', 'HEAD'], raiz);
  return { ok: true, antes, despues, avanzo: antes !== despues, raiz };
}

export const pasoAlDia = (alDiaFn = alDia) => ({
  nombre: 'al-dia',
  ejecutar: (escribir) => {
    const r = alDiaFn();
    if (!r.ok) throw new Error(r.motivo);
    escribir(r.avanzo
      ? `al-dia: la carpeta principal avanzó de ${r.antes.slice(0, 7)} a ${r.despues.slice(0, 7)}`
      : `al-dia: la carpeta principal ya estaba al día (${r.despues.slice(0, 7)})`);
  },
});
