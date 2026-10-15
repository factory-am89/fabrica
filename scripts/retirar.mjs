// Cierra una carpeta de trabajo: node scripts/retirar.mjs <nombre>
// Solo la borra si su rama ya está fusionada y no hay cambios sin guardar.
import { lstatSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, gitOk, norm, principal, worktrees, carpetaDe, tieneOrigin } from './lib/carpetas.mjs';

// Squash o rebase no dejan la rama como ancestro de main: se mira el PR fusionado, con la misma
// punta que la rama (un commit posterior a la fusión no estaría en main).
export function prFusionado(rama, punta) {
  const r = spawnSync('gh', ['pr', 'list', '--head', rama, '--state', 'merged', '--json', 'headRefOid', '--jq', '.[].headRefOid'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error(`No pude preguntar a GitHub por el PR de ${rama}: ${r.error?.message ?? r.stderr.trim()}`);
  return r.stdout.split(/\s+/).includes(punta);
}

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

export function retirar(nombre, { cwd = process.cwd(), consultarPR = prFusionado } = {}) {
  const raiz = principal(cwd);
  const carpeta = carpetaDe(raiz, nombre);
  const wt = worktrees(raiz).find((w) => norm(w.ruta) === norm(carpeta));
  if (!wt) throw new Error(`No hay ninguna carpeta de trabajo «${nombre}» (${carpeta}).`);
  if (!wt.rama) throw new Error(`${carpeta} no tiene rama (cabeza suelta): decide a mano.`);
  const dentro = path.relative(carpeta, path.resolve(cwd));
  if (!dentro.startsWith('..') && !path.isAbsolute(dentro)) throw new Error(`Estás dentro de ${carpeta}: sal de ella y vuelve a lanzarlo.`);
  const sucio = gitOk(['status', '--porcelain', '--', '.', ':(exclude)node_modules'], carpeta);
  if (sucio) throw new Error(`${carpeta} tiene cambios sin guardar; no se borra:\n${sucio}`);
  const remoto = tieneOrigin(raiz);
  if (remoto) gitOk(['fetch', 'origin', 'main'], raiz);
  const base = remoto ? 'origin/main' : 'main';
  const fusionada = git(['merge-base', '--is-ancestor', wt.rama, base], raiz).status === 0
    || (remoto && consultarPR(wt.rama, gitOk(['rev-parse', wt.rama], raiz)));
  if (!fusionada) throw new Error(`La rama ${wt.rama} no está fusionada en ${base}; no se borra nada.`);
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
