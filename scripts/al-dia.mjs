// Paso «al-dia» del arranque: la carpeta principal avanza con `git pull --ff-only`.
// Si no puede (cambios sin guardar, divergente, sin red, rama suelta) no toca nada y lo dice como fallo.
// Nunca rebase, reset ni stash: solo avanza una rama que no tiene nada propio que perder.
import { git, gitOk, principal } from './lib/folders.mjs';

export function alDia(raiz = principal(process.cwd())) {
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
