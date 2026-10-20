// Prints how many human interventions there were, per class and per origin, from the log
// (rutaDeRegistroIntervenciones in scripts/lib/intervention-log.mjs).
//   npm run hitl            readable lines
//   npm run hitl -- --json  { registro, total, porClase, porOrigen, porFalta, sinFalta, caminos, nota, corruptas } (the contract other sessions read)
//   npm run hitl -- marcar <clase> <falta> [motivo]   an agent marks what the system lacked (origen agente; self-declared)
// Exit 1 when the log has lines that cannot be read (they are in `corruptas` and in `total`): a count that skips them would be wrong.
import { fileURLToPath } from 'node:url';
import { CAMINOS, ORIGEN_AGENTE, contarIntervenciones, registrarIntervencion, rutaDeRegistroIntervenciones } from './lib/intervention-log.mjs';

export const NOTA = 'falta es autodeclarada: la escribe quien marca (origen agente) o la deduce la clase donde es univoca; nadie la comprueba. Las lineas viejas no tienen falta (sinFalta).';

// `marcar <clase> <falta> [motivo]`: an agent says what the system lacked when Pablo had to step in. Throws outside the vocabulary.
export function marcar(clase, falta, motivo, opciones = {}) {
  registrarIntervencion({ clase, origen: ORIGEN_AGENTE, falta, motivo, ...opciones });
}

export function informe({ json = false, ruta = rutaDeRegistroIntervenciones() } = {}) {
  const c = contarIntervenciones({ ruta });
  const salida = json
    ? JSON.stringify({ registro: ruta, total: c.total, porClase: c.porClase, porOrigen: c.porOrigen, porFalta: c.porFalta, sinFalta: c.sinFalta, caminos: CAMINOS, nota: NOTA, corruptas: c.corruptas }, null, 2)
    : [`registro: ${ruta}`, `total: ${c.total}`, ...Object.entries(c.porClase).map(([k, v]) => `${k}: ${v}`), ...Object.entries(c.porOrigen).map(([k, v]) => `origen ${k}: ${v}`), ...Object.entries(c.porFalta).map(([k, v]) => `falta ${k}: ${v}${CAMINOS[k] ? ` -> ${CAMINOS[k]}` : ''}`), `sin falta (lineas viejas): ${c.sinFalta}`, NOTA].join('\n');
  return { salida, corruptas: c.corruptas };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'marcar') {
  const [, , , clase, falta, ...resto] = process.argv;
  try {
    if (!clase || !falta) throw new Error('usage: node scripts/hitl.mjs marcar <clase> <falta> [motivo]');
    marcar(clase, falta, resto.length ? resto.join(' ') : undefined);
    console.log(`hitl: marked ${clase} / ${falta} (origen agente, self-declared)`);
  } catch (e) {
    console.error(`hitl: ${e.message}`);
    process.exit(1);
  }
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { salida, corruptas } = informe({ json: process.argv.includes('--json') });
  console.log(salida);
  if (corruptas.length > 0) {
    console.error(`hitl: ${corruptas.length} unreadable lines in the log (line numbers: ${corruptas.join(', ')}); counted in total, in no class`);
    process.exit(1);
  }
}
