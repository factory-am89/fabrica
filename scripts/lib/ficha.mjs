// La ficha de un repo: .fabrica.json en su raíz. Dice qué hace falta saber para limpiarlo: sin ella no se
// adivina nada (ni repo, ni base, ni identidad): se falla en alto.
//   repo       owner/name en GitHub
//   base       rama a la que se fusionan los PR (main, staging)
//   identidad  con quién se habla a GitHub:
//              «fabrica-constructor»  la App fabrica-constructor, vía scripts/token.mjs (solo donde está instalada)
//              «ninguna»              sin credencial: solo lectura de un repo público; no se borran ramas remotas
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO } from './repo.mjs';

export const IDENTIDADES = ['fabrica-constructor', 'ninguna'];
const CLAVES = ['repo', 'base', 'identidad'];
export const NOMBRE_FICHA = '.fabrica.json';

// Lee y valida la ficha. `fichero` fuerza otra ruta (para probar un repo antes de darle ficha propia).
export function leerFicha(raiz, fichero = path.join(raiz, NOMBRE_FICHA)) {
  if (!existsSync(fichero)) {
    throw new Error(`Falta la ficha ${fichero}: sin ella no sé qué repo, qué rama base ni qué identidad usar. Crea un ${NOMBRE_FICHA} con ${CLAVES.join(', ')}.`);
  }
  let f;
  try {
    f = JSON.parse(readFileSync(fichero, 'utf8'));
  } catch (e) {
    throw new Error(`La ficha ${fichero} no es JSON legible: ${e.message}`);
  }
  if (f === null || typeof f !== 'object' || Array.isArray(f)) throw new Error(`La ficha ${fichero} debe ser un objeto con ${CLAVES.join(', ')}.`);
  const sobran = Object.keys(f).filter((k) => !CLAVES.includes(k));
  if (sobran.length) throw new Error(`La ficha ${fichero} trae claves que no conozco: ${sobran.join(', ')}.`);
  for (const k of CLAVES) if (typeof f[k] !== 'string' || !f[k].trim()) throw new Error(`La ficha ${fichero} no tiene «${k}» (texto no vacío).`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(f.repo)) throw new Error(`La ficha ${fichero}: «repo» debe ser owner/name, y es «${f.repo}».`);
  if (!IDENTIDADES.includes(f.identidad)) throw new Error(`La ficha ${fichero}: «identidad» debe ser una de ${IDENTIDADES.join(', ')}, y es «${f.identidad}».`);
  if (f.identidad === 'fabrica-constructor' && f.repo.split('/')[0].toLowerCase() !== REPO.split('/')[0].toLowerCase()) {
    throw new Error(`La ficha ${fichero}: la App fabrica-constructor solo está instalada en ${REPO.split('/')[0]}; ${f.repo} no vale con esa identidad.`);
  }
  return { repo: f.repo, base: f.base, identidad: f.identidad };
}
