// Una sesión, una carpeta, una rama: crea C:\dev\fabrica-<nombre> como worktree con su rama.
//   node scripts/tarea.mjs feat/nombre-en-castellano
// Sale de origin/main (tras un fetch) o de main si el repo aún no tiene remoto.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gitOk, principal, nombreDeRama, carpetaDe, tieneOrigin } from './lib/carpetas.mjs';

export function crearTarea(rama, { cwd = process.cwd(), instalar = true } = {}) {
  const nombre = nombreDeRama(rama);
  const raiz = principal(cwd);
  const carpeta = carpetaDe(raiz, nombre);
  if (existsSync(carpeta)) throw new Error(`Ya existe ${carpeta}: otra sesión la usa, o hay un resto que borrar a mano.`);
  let base = 'main';
  if (tieneOrigin(raiz)) {
    gitOk(['fetch', 'origin', 'main'], raiz);
    base = 'origin/main';
  }
  gitOk(['worktree', 'add', '--no-track', '-b', rama, carpeta, base], raiz);
  if (instalar) {
    const r = spawnSync('npm', ['ci'], { cwd: carpeta, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) throw new Error(`npm ci falló en ${carpeta}; la carpeta y la rama existen, arréglalo ahí.`);
  }
  return { carpeta, rama, base };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { carpeta, rama, base } = crearTarea(process.argv[2]);
    console.log(`tarea carpeta: ${carpeta} rama: ${rama} base: ${base}`);
    console.log(`Trabaja ahí; el primer push es: git push -u origin ${rama}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
