// Las identidades con las que se habla a GitHub: UN solo mapa, del que salen la validación de la ficha
// (lib/repo-card.mjs), el lanzador de las órdenes y si se pueden borrar ramas remotas (clean.mjs).
//   lanzador      script que lanza `-- gh api <ruta>` / `-- git ...` con esa identidad
//   borraRemotas  si con ella se pueden borrar ramas remotas
//   duenos        lista cerrada de dueños de repos donde vale (null: cualquiera, solo para una identidad sin escritura)
import { fileURLToPath } from 'node:url';
import { REPO, OWNER_LOGIN } from './repo.mjs';

// La App fabrica-constructor, vía scripts/token.mjs (única puerta; gh a pelo no tiene sesión en este PC).
export const TOKEN = fileURLToPath(new URL('../token.mjs', import.meta.url));

export const IDENTIDADES = {
  'fabrica-constructor': { lanzador: TOKEN, borraRemotas: true, duenos: [REPO.split('/')[0], OWNER_LOGIN] },
  // Sin credencial: solo lectura de un repo público (lib/gh-public.mjs).
  ninguna: { lanzador: fileURLToPath(new URL('./gh-public.mjs', import.meta.url)), borraRemotas: false, duenos: null },
};

export const NOMBRES_IDENTIDAD = Object.keys(IDENTIDADES);

export function identidadDe(nombre) {
  if (!Object.hasOwn(IDENTIDADES, nombre)) throw new Error(`Identidad desconocida: ${nombre} (valen: ${NOMBRES_IDENTIDAD.join(', ')})`);
  return IDENTIDADES[nombre];
}
