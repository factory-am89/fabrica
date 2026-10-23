// Paso «al-dia» del arranque: la carpeta principal avanza con un avance rápido (`merge --ff-only`).
// Si no puede (cambios sin guardar, divergente, sin red, rama suelta, sin upstream) no toca nada y lo dice como fallo.
// Nunca rebase, reset ni stash: solo avanza una rama que no tiene nada propio que perder.
// No usa `git pull`: pull lee .git/FETCH_HEAD y refs/remotes/origin/main, que también escriben otros fetch (el hook de
// usuario, `npm run tarea`, órdenes a mano); medido el 23 oct 2026: 26 de 30 arranques fallan. Trae a una ref propia
// (refs/fabrica/al-dia/<rama>) sin FETCH_HEAD y avanza desde ella: 0 de 50. Un al-dia cada vez (candado de lib/turno.mjs):
// dos al-dia sí escriben la misma ref propia.
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

const porLineas = (r) => (r.stderr.trim() || r.stdout.trim()).split(/\r?\n/).join(' | ');

function avanzar(raiz) {
  const estado = git(['status', '--porcelain'], raiz);
  if (estado.status !== 0) return { ok: false, motivo: `no pude mirar el estado de ${raiz}: ${estado.stderr.trim()}` };
  if (estado.stdout.trim()) return { ok: false, motivo: `la carpeta principal ${raiz} tiene cambios sin guardar; no la toco` };
  const antes = gitOk(['rev-parse', 'HEAD'], raiz);
  const actual = git(['symbolic-ref', '--short', 'HEAD'], raiz);
  if (actual.status !== 0) return { ok: false, motivo: `la carpeta principal ${raiz} no está en una rama (HEAD suelto); no pudo avanzar: ${actual.stderr.trim()}` };
  const rama = actual.stdout.trim();
  const remoto = git(['config', '--get', `branch.${rama}.remote`], raiz).stdout.trim();
  const fusion = git(['config', '--get', `branch.${rama}.merge`], raiz).stdout.trim();
  if (!remoto || !fusion.startsWith('refs/heads/')) return { ok: false, motivo: `la rama ${rama} de ${raiz} no tiene upstream (branch.${rama}.remote y branch.${rama}.merge); no pudo avanzar` };
  const propia = `refs/fabrica/al-dia/${fusion.slice('refs/heads/'.length)}`;
  const trae = git(['fetch', '--no-write-fetch-head', '--refmap=', remoto, `+${fusion}:${propia}`], raiz);
  if (trae.status !== 0) return { ok: false, motivo: `la carpeta principal ${raiz} no pudo avanzar (git fetch a ${propia}): ${porLineas(trae)}` };
  const r = git(['merge', '--ff-only', propia], raiz);
  if (r.status !== 0) return { ok: false, motivo: `la carpeta principal ${raiz} no pudo avanzar (git merge --ff-only): ${porLineas(r)}` };
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
