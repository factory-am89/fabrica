// Las identidades con las que se habla a GitHub: UN solo mapa, del que salen la validación de la ficha
// (lib/ficha.mjs), el lanzador de las órdenes y si se pueden borrar ramas remotas (limpiar.mjs).
//   lanzador      script que lanza `-- gh api <ruta>` / `-- git ...` con esa identidad
//   borraRemotas  si con ella se pueden borrar ramas remotas
//   dueno         el único dueño de repos donde vale (null: cualquiera)
import { fileURLToPath } from 'node:url';
import { REPO } from './repo.mjs';

// La App fabrica-constructor, vía scripts/token.mjs (única puerta; gh a pelo no tiene sesión en este PC).
export const TOKEN = fileURLToPath(new URL('../token.mjs', import.meta.url));

export const IDENTIDADES = {
  'fabrica-constructor': { lanzador: TOKEN, borraRemotas: true, dueno: REPO.split('/')[0] },
  // Sin credencial: solo lectura de un repo público (lib/gh-publico.mjs).
  ninguna: { lanzador: fileURLToPath(new URL('./gh-publico.mjs', import.meta.url)), borraRemotas: false, dueno: null },
};

export const NOMBRES_IDENTIDAD = Object.keys(IDENTIDADES);

export function identidadDe(nombre) {
  if (!Object.hasOwn(IDENTIDADES, nombre)) throw new Error(`Identidad desconocida: ${nombre} (valen: ${NOMBRES_IDENTIDAD.join(', ')})`);
  return IDENTIDADES[nombre];
}
