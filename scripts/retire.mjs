// Cierra una carpeta de trabajo: node scripts/retire.mjs <nombre>
//   node scripts/retire.mjs [--repo <carpeta del repo ajeno>] <nombre>
//   node scripts/retire.mjs --json <nombre>   (output rule and exit codes: see scripts/lib/exit.mjs)
// Solo la borra si su rama ya está fusionada y no hay cambios sin guardar.
import { lstatSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExitError, RETIRE_RESULT, runCommand, finish } from './lib/exit.mjs';
import { git, gitOk, norm, principal, sacarRepo, fichaDe, worktrees, carpetaDe, tieneOrigin } from './lib/folders.mjs';
import { identidadDe } from './lib/identities.mjs';
import { motivoDeQuedarse, prFusionado } from './lib/can-delete.mjs';

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

export function retirar(nombre, { cwd = process.cwd(), consultarPR, token } = {}) {
  const raiz = principal(cwd);
  const ficha = fichaDe(raiz); // repo, rama base e identidad salen de la ficha, no de un texto fijo
  const carpeta = carpetaDe(raiz, nombre);
  const wt = worktrees(raiz).find((w) => norm(w.ruta) === norm(carpeta));
  if (!wt) throw new ExitError('NOT_FOUND', `No hay ninguna carpeta de trabajo «${nombre}» (${carpeta}).`);
  const remoto = tieneOrigin(raiz);
  consultarPR ??= (rama, punta) => prFusionado(punta, { repo: ficha.repo, token: token ?? identidadDe(ficha.identidad).lanzador, cwd: raiz, base: ficha.base });
  const rama0 = ficha.base;
  if (remoto) gitOk(['fetch', '--no-write-fetch-head', 'origin', rama0], raiz);
  const base = remoto ? `origin/${rama0}` : rama0;
  const fusionada = (punta) => git(['merge-base', '--is-ancestor', wt.rama, base], raiz).status === 0
    || (remoto && consultarPR(wt.rama, punta));
  const motivo = motivoDeQuedarse(wt, { todas: worktrees(raiz), cwd, fusionada });
  if (motivo) throw new ExitError(motivo.code, `${motivo.text} No se borra nada.`);
  const union = quitarUnion(path.join(carpeta, 'node_modules'));
  gitOk(['worktree', 'remove', carpeta], raiz);
  gitOk(['branch', '-D', wt.rama], raiz);
  return { carpeta, rama: wt.rama, union };
}

// Runs the command and returns { code, stdout, stderr }; the block below only prints and exits.
export function cliRetirar(argv, opts = {}) {
  return runCommand(argv, {
    run: (args) => {
      const { repoDir, resto: [nombre] } = sacarRepo(args);
      if (!nombre) throw new ExitError('USAGE', 'Falta el nombre de la carpeta: node scripts/retire.mjs [--repo <carpeta>] <nombre>');
      return { result: RETIRE_RESULT.REMOVED, ...retirar(nombre, { ...opts, ...(repoDir ? { cwd: repoDir } : {}) }) };
    },
    human: ({ carpeta, rama, union }) => `retirar carpeta: ${carpeta} rama: ${rama} union-quitada: ${union}`,
    refused: { result: RETIRE_RESULT.REFUSED },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) finish(cliRetirar(process.argv.slice(2)));
