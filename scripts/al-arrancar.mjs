// Lo que se hace al arrancar una sesión: .claude/settings.json lanza solo este script (SessionStart).
// Un paso nuevo se añade a PASOS, no a settings.json. Un paso que falla se dice y no impide los demás.
import { fileURLToPath } from 'node:url';
import { limpiar, imprimir } from './limpiar.mjs';

export const PASOS = [
  {
    nombre: 'limpiar',
    ejecutar: (escribir) => {
      const s = limpiar();
      imprimir(s, escribir);
      if (s.fallos > 0) throw new Error(`${s.fallos} cosas sin borrar (arriba)`);
    },
  },
];

// Devuelve cuántos pasos fallaron.
export function arrancar(pasos = PASOS, escribir = console.log) {
  let fallos = 0;
  for (const paso of pasos) {
    try {
      paso.ejecutar(escribir);
    } catch (e) {
      fallos += 1;
      escribir(`al-arrancar FALLÓ el paso «${paso.nombre}»: ${e.message}`);
    }
  }
  return fallos;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(arrancar() > 0 ? 1 : 0);
}
