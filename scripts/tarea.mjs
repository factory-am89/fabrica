// Una sesión, una carpeta, una rama: crea C:\dev\fabrica-<nombre> como worktree con su rama.
//   node scripts/tarea.mjs feat/nombre-en-castellano
//   node scripts/tarea.mjs --json feat/nombre   (output rule and exit codes: see scripts/lib/exit.mjs)
// Sale de origin/<base> (tras un fetch) o de <base> si el repo aún no tiene remoto; <base> es el campo base de la
// ficha .fabrica.json del repo (sin ficha, error). Para un repo ajeno: --repo <carpeta del repo>; solo se
// instalan los hooks de git de la Fábrica si el repo trae los suyos en .githooks/.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { instalarHooks } from './install-hooks.mjs';
import { ExitError, runCommand, finish } from './lib/exit.mjs';
import { gitOk, principal, sacarRepo, fichaDe, nombreDeRama, carpetaDe, tieneOrigin } from './lib/folders.mjs';

export function crearTarea(rama, { cwd = process.cwd(), instalar = true, json = false, lanzar = spawnSync } = {}) {
  const nombre = nombreDeRama(rama);
  const raiz = principal(cwd);
  const rama0 = fichaDe(raiz).base;
  const carpeta = carpetaDe(raiz, nombre);
  if (existsSync(carpeta)) throw new ExitError('FOLDER_EXISTS', `Ya existe ${carpeta}: otra sesión la usa, o hay un resto que borrar a mano.`);
  let base = rama0;
  if (tieneOrigin(raiz)) {
    gitOk(['fetch', '--no-write-fetch-head', 'origin', rama0], raiz);
    base = `origin/${rama0}`;
  }
  gitOk(['worktree', 'add', '--no-track', '-b', rama, carpeta, base], raiz);
  // los hooks de git que niegan commit, merge y cherry-pick en la principal: solo donde el repo los trae
  if (existsSync(path.join(raiz, '.githooks', 'denegar-principal.sh'))) instalarHooks(raiz);
  if (instalar) {
    const r = lanzar('npm', ['ci'], { cwd: carpeta, stdio: ['ignore', json ? 2 : 'inherit', 'inherit'], shell: process.platform === 'win32' });
    if (r.status !== 0) throw new ExitError('INSTALL_FAILED', `npm ci falló en ${carpeta}; la carpeta y la rama existen, arréglalo ahí.`);
  }
  return { carpeta, rama, base };
}

// Runs the command and returns { code, stdout, stderr }; the block below only prints and exits.
export function cliTarea(argv, opts = {}) {
  return runCommand(argv, {
    run: (args) => {
      const { repoDir, resto } = sacarRepo(args);
      return crearTarea(resto[0], { ...opts, ...(repoDir ? { cwd: repoDir } : {}), json: argv.includes('--json') });
    },
    human: ({ carpeta, rama, base }) => `tarea carpeta: ${carpeta} rama: ${rama} base: ${base}\nTrabaja ahí; el primer push es: git push -u origin ${rama}`,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) finish(cliTarea(process.argv.slice(2)));
