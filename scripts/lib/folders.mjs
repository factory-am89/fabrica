// Lo común de las carpetas de trabajo (worktrees): git, la carpeta principal y los nombres.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ExitError } from './exit.mjs';

export function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.error) throw new ExitError('GIT_FAILED', `No pude lanzar git: ${r.error.message}`);
  return r;
}

export function gitOk(args, cwd) {
  const r = git(args, cwd);
  if (r.status !== 0) throw new ExitError('GIT_FAILED', `git ${args.join(' ')} falló: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

// Ruta comparable: absoluta, con la barra de Windows, sin barra final y en minúsculas en Windows
// (git da C:/dev/x, Git Bash /c/dev/x y Claude C:\dev\x).
export function absoluta(p) {
  const unix = /^\/([a-zA-Z])(\/|$)/.exec(p);
  return path.resolve(unix ? `${unix[1]}:/${p.slice(unix[0].length)}` : p);
}

export function norm(p) {
  const r = absoluta(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

// Las carpetas de trabajo del repo; la primera es siempre la principal.
export function worktrees(cwd) {
  const salida = gitOk(['worktree', 'list', '--porcelain'], cwd);
  return salida.split(/\n\n+/).filter(Boolean).map((bloque) => {
    const ruta = /^worktree (.+)$/m.exec(bloque)[1];
    const rama = /^branch refs\/heads\/(.+)$/m.exec(bloque)?.[1] ?? null;
    return { ruta: path.normalize(ruta), rama };
  });
}

export const principal = (cwd) => worktrees(cwd)[0].ruta;

// feat/<nombre>, fix/<nombre> u ops/<nombre>, en minúsculas y con guiones; devuelve <nombre>.
export function nombreDeRama(rama) {
  const m = /^(?:feat|fix|ops)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(rama ?? '');
  if (!m) throw new ExitError('INVALID_BRANCH', `La rama «${rama}» no vale: feat/, fix/ u ops/ y un nombre en minúsculas y con guiones.`);
  return m[1];
}

// C:\dev\fabrica + «tema» → C:\dev\fabrica-tema, al lado de la principal.
export const carpetaDe = (raiz, nombre) => path.join(path.dirname(raiz), `${path.basename(raiz)}-${nombre}`);

export const tieneOrigin = (cwd) => gitOk(['remote'], cwd).split(/\s+/).includes('origin');
