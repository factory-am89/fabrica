// Cierra una carpeta de trabajo: node scripts/retirar.mjs <nombre>
//   node scripts/retirar.mjs --json <nombre>   (one JSON object on stdout; human text on stderr)
// Exit codes: see EXIT in scripts/lib/exit.mjs.
// Solo la borra si su rama ya está fusionada y no hay cambios sin guardar.
import { lstatSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExitError, RETIRE_RESULT, runCommand, finish } from './lib/exit.mjs';
import { git, gitOk, norm, principal, worktrees, carpetaDe, tieneOrigin } from './lib/carpetas.mjs';

// Squash o rebase no dejan la rama como ancestro de main: se mira el PR fusionado, con la misma
// punta que la rama (un commit posterior a la fusión no estaría en main).
// `lanzar` is injectable so tests never call the real gh.
export function prFusionado(rama, punta, lanzar = spawnSync) {
  const r = lanzar('gh', ['pr', 'list', '--head', rama, '--state', 'merged', '--json', 'headRefOid', '--jq', '.[].headRefOid'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new ExitError('GH_FAILED',`No pude preguntar a GitHub por el PR de ${rama}: ${r.error?.message ?? r.stderr.trim()}`);
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
  if (!wt) throw new ExitError('NOT_FOUND',`No hay ninguna carpeta de trabajo «${nombre}» (${carpeta}).`);
  if (!wt.rama) throw new ExitError('DETACHED_HEAD',`${carpeta} no tiene rama (cabeza suelta): decide a mano.`);
  const dentro = path.relative(carpeta, path.resolve(cwd));
  if (!dentro.startsWith('..') && !path.isAbsolute(dentro)) throw new ExitError('INSIDE_FOLDER',`Estás dentro de ${carpeta}: sal de ella y vuelve a lanzarlo.`);
  const sucio = gitOk(['status', '--porcelain', '--', '.', ':(exclude)node_modules'], carpeta);
  if (sucio) throw new ExitError('UNSAVED_CHANGES',`${carpeta} tiene cambios sin guardar; no se borra:\n${sucio}`);
  const remoto = tieneOrigin(raiz);
  if (remoto) gitOk(['fetch', 'origin', 'main'], raiz);
  const base = remoto ? 'origin/main' : 'main';
  const fusionada = git(['merge-base', '--is-ancestor', wt.rama, base], raiz).status === 0
    || (remoto && consultarPR(wt.rama, gitOk(['rev-parse', wt.rama], raiz)));
  if (!fusionada) throw new ExitError('NOT_MERGED',`La rama ${wt.rama} no está fusionada en ${base}; no se borra nada.`);
  const union = quitarUnion(path.join(carpeta, 'node_modules'));
  gitOk(['worktree', 'remove', carpeta], raiz);
  gitOk(['branch', '-D', wt.rama], raiz);
  return { carpeta, rama: wt.rama, union };
}

// Runs the command and returns { code, stdout, stderr }; the block below only prints and exits.
export function cliRetirar(argv, opts = {}) {
  return runCommand(argv, {
    run: ([nombre]) => {
      if (!nombre) throw new ExitError('USAGE', 'Falta el nombre de la carpeta: node scripts/retirar.mjs <nombre>');
      return { result: RETIRE_RESULT.REMOVED, ...retirar(nombre, opts) };
    },
    human: ({ carpeta, rama, union }) => `retirar carpeta: ${carpeta} rama: ${rama} union-quitada: ${union}`,
    refused: { result: RETIRE_RESULT.REFUSED },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) finish(cliRetirar(process.argv.slice(2)));
