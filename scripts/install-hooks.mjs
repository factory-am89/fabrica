// Activa los hooks de git de .githooks/ en la carpeta principal: `git config core.hooksPath` local.
// Lo hace solo `npm run tarea`; este script es el «una línea» si hace falta a mano:
//   npm run instalar-hooks
// El config es del repo y lo ven todas las carpetas de trabajo; los hooks se niegan a sí mismos
// fuera de la principal (ver .githooks/denegar-principal.sh).
import { fileURLToPath } from 'node:url';
import { gitOk, principal } from './lib/folders.mjs';

// El hook que marca un repo como dueño de estos hooks: tarea solo los activa donde existe.
export const HOOK_MARCA = '.githooks/denegar-principal.sh';

export function instalarHooks(cwd = process.cwd()) {
  const raiz = principal(cwd);
  gitOk(['config', '--local', 'core.hooksPath', '.githooks'], raiz);
  return raiz;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(`hooks de git activos en ${instalarHooks()}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
