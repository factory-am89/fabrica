// Una sesión, una carpeta, una rama: crea C:\dev\fabrica-<nombre> como worktree con su rama.
//   node scripts/tarea.mjs feat/nombre-en-castellano
//   node scripts/tarea.mjs --json feat/nombre   (output rule and exit codes: see scripts/lib/exit.mjs)
// Sale de origin/main (tras un fetch) o de main si el repo aún no tiene remoto.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { instalarHooks } from './instalar-hooks.mjs';
import { ExitError, runCommand, finish } from './lib/exit.mjs';
import { gitOk, principal, nombreDeRama, carpetaDe, tieneOrigin } from './lib/carpetas.mjs';

export function crearTarea(rama, { cwd = process.cwd(), instalar = true, json = false, lanzar = spawnSync } = {}) {
  const nombre = nombreDeRama(rama);
  const raiz = principal(cwd);
  const carpeta = carpetaDe(raiz, nombre);
  if (existsSync(carpeta)) throw new ExitError('FOLDER_EXISTS', `Ya existe ${carpeta}: otra sesión la usa, o hay un resto que borrar a mano.`);
  let base = 'main';
  if (tieneOrigin(raiz)) {
    gitOk(['fetch', 'origin', 'main'], raiz);
    base = 'origin/main';
  }
  gitOk(['worktree', 'add', '--no-track', '-b', rama, carpeta, base], raiz);
  instalarHooks(raiz); // los hooks de git que niegan commit, merge y cherry-pick en la principal
  if (instalar) {
    const r = lanzar('npm', ['ci'], { cwd: carpeta, stdio: ['ignore', json ? 2 : 'inherit', 'inherit'], shell: process.platform === 'win32' });
    if (r.status !== 0) throw new ExitError('INSTALL_FAILED', `npm ci falló en ${carpeta}; la carpeta y la rama existen, arréglalo ahí.`);
  }
  return { carpeta, rama, base };
}

// Runs the command and returns { code, stdout, stderr }; the block below only prints and exits.
export function cliTarea(argv, opts = {}) {
  return runCommand(argv, {
    run: ([rama]) => crearTarea(rama, { ...opts, json: argv.includes('--json') }),
    human: ({ carpeta, rama, base }) => `tarea carpeta: ${carpeta} rama: ${rama} base: ${base}\nTrabaja ahí; el primer push es: git push -u origin ${rama}`,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) finish(cliTarea(process.argv.slice(2)));
