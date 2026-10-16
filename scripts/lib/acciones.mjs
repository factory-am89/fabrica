// Regla C4 de estandares/codigo.md: cada `uses:` de un workflow va fijado por SHA.
// Única excepción, escrita aquí y probada en test/fabrica.test.js: los workflows reutilizables de la
// propia Fábrica, llamados con `@main` (el repo que llama siempre usa el juez actual). Ningún otro
// repo, ninguna otra ruta y ninguna otra referencia.
import { REPO } from './repo.mjs';

const PREFIJO = `${REPO}/.github/workflows/`;
const FICHERO_MAIN = /^[A-Za-z0-9_-]+[.]ya?ml@main$/; // sin barras: no sale de la carpeta ni entra en subcarpetas
const POR_SHA = /@[0-9a-f]{40}$/;

export function accionFijada(uses) {
  if (POR_SHA.test(uses)) return true;
  return uses.startsWith(PREFIJO) && FICHERO_MAIN.test(uses.slice(PREFIJO.length));
}

// Las acciones (`uses:`) de un texto de workflow.
export function accionesDe(texto) {
  return [...texto.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
}
