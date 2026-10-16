// Prints how many human interventions there were, per class and per origin, from the log
// (rutaDeRegistroIntervenciones in scripts/lib/registro-intervenciones.mjs).
//   npm run hitl            readable lines
//   npm run hitl -- --json  { registro, total, porClase, porOrigen, corruptas } (the contract other sessions read)
// Exit 1 when the log has lines that cannot be read (they are in `corruptas` and in `total`): a count that skips them would be wrong.
import { fileURLToPath } from 'node:url';
import { contarIntervenciones, rutaDeRegistroIntervenciones } from './lib/registro-intervenciones.mjs';

export function informe({ json = false, ruta = rutaDeRegistroIntervenciones() } = {}) {
  const c = contarIntervenciones({ ruta });
  const salida = json
    ? JSON.stringify({ registro: ruta, ...c }, null, 2)
    : [`registro: ${ruta}`, `total: ${c.total}`, ...Object.entries(c.porClase).map(([k, v]) => `${k}: ${v}`), ...Object.entries(c.porOrigen).map(([k, v]) => `origen ${k}: ${v}`)].join('\n');
  return { salida, corruptas: c.corruptas };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { salida, corruptas } = informe({ json: process.argv.includes('--json') });
  console.log(salida);
  if (corruptas.length > 0) {
    console.error(`hitl: ${corruptas.length} unreadable lines in the log (line numbers: ${corruptas.join(', ')}); counted in total, in no class`);
    process.exit(1);
  }
}
