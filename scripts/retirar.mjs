// Cierra una carpeta de trabajo: node scripts/retirar.mjs <nombre>
// Solo la borra si su rama ya está fusionada y no hay cambios sin guardar.
import { lstatSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, gitOk, norm, principal, worktrees, carpetaDe, tieneOrigin } from './lib/carpetas.mjs';
import { motivoDeQuedarse, prFusionado } from './lib/puede-borrarse.mjs';

// Si node_modules es una unión o un enlace se quita ella sola: borrar en recursivo a través de
// una unión vacía la carpeta de destino (se perdió así un node_modules el 8 oct).
export function quitarUnion(ruta) {
  let info;
  try {
    info = lstatSync(ruta);
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
  if (!info.isSymbolicLink()) return false;
  unlinkSync(ruta);
  return true;
}

export function retirar(nombre, { cwd = process.cwd(), consultarPR = (rama, punta) => prFusionado(punta) } = {}) {
  const raiz = principal(cwd);
  const carpeta = carpetaDe(raiz, nombre);
  const wt = worktrees(raiz).find((w) => norm(w.ruta) === norm(carpeta));
  if (!wt) throw new Error(`No hay ninguna carpeta de trabajo «${nombre}» (${carpeta}).`);
  const remoto = tieneOrigin(raiz);
  if (remoto) gitOk(['fetch', 'origin', 'main'], raiz);
  const base = remoto ? 'origin/main' : 'main';
  const fusionada = (punta) => git(['merge-base', '--is-ancestor', wt.rama, base], raiz).status === 0
    || (remoto && consultarPR(wt.rama, punta));
  const motivo = motivoDeQuedarse(wt, { todas: worktrees(raiz), cwd, fusionada });
  if (motivo) throw new Error(`${motivo} No se borra nada.`);
  const union = quitarUnion(path.join(carpeta, 'node_modules'));
  gitOk(['worktree', 'remove', carpeta], raiz);
  gitOk(['branch', '-D', wt.rama], raiz);
  return { carpeta, rama: wt.rama, union };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { carpeta, rama, union } = retirar(process.argv[2]);
    console.log(`retirar carpeta: ${carpeta} rama: ${rama} union-quitada: ${union}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
