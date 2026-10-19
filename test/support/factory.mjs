// Helpers shared by the test files that were split out of the old test/fabrica.test.js.
import { readFileSync } from 'node:fs';
import { decidir, leerPreguntas } from '../../scripts/veredicto.mjs';

export const leer = (ruta) => readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8');
export const preguntas = leerPreguntas(leer('standards/code.md'));
export const buenas = () => preguntas.filter((p) => p.quien === 'revisor').map((p) => ({ id: p.id, respuesta: 'sí', prueba: 'x.js:1' }));
export const SHA = 'a'.repeat(40);
export const ctx = (extra = {}) => ({ sha: SHA, cabeza: SHA, ...extra });
export const juzga = (respuestas, c = ctx()) => decidir(JSON.stringify({ respuestas }), preguntas, c);

// The App manifests of apps/crear-apps.html, parsed (the real ones: tests compare against these, never a copy).
export function manifiestos() {
  const valores = [...leer('apps/crear-apps.html').matchAll(/name="manifest" value="([^"]*)"/g)].map((m) => m[1]);
  return valores.map((v) => JSON.parse(v.replaceAll('&quot;', '"').replaceAll('&amp;', '&')));
}
