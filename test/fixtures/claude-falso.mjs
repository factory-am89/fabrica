// `claude -p` falso para test/golden-run.test.js (GOLDEN_CLAUDE_BIN): sin modelo ni red.
// Anota en CLAUDE_FALSO_LOG (una línea JSON por llamada) los argumentos, el prompt de stdin, la carpeta de trabajo y
// todos los ficheros que hay en ella; y contesta como el modo json de claude: {is_error, total_cost_usd, structured_output}.
//   CLAUDE_FALSO_ALTERNA=1: en las llamadas impares contesta «no» a C5 y en las pares «sí» (un revisor inestable).
//   CLAUDE_FALSO_FALLA=1: contesta con is_error.
import { appendFileSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cargarPreguntas } from '../../scripts/veredicto.mjs';
import { CHECKED_BY } from '../../scripts/lib/questions.mjs';
import { ANSWER } from '../../scripts/lib/record.mjs';

const { CLAUDE_FALSO_LOG: log, CLAUDE_FALSO_ALTERNA: alterna, CLAUDE_FALSO_FALLA: falla } = process.env;
// `node --test` también lanza los ficheros de test/ sin más: sin log no hace nada.
if (log) {
  const ficheros = (dir, base = '') =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? ficheros(path.join(dir, e.name), `${base}${e.name}/`) : [`${base}${e.name}`]));
  const contador = `${log}.n`;
  const n = (existsSync(contador) ? Number(readFileSync(contador, 'utf8')) : 0) + 1;
  writeFileSync(contador, String(n));
  appendFileSync(log, `${JSON.stringify({ argv: process.argv.slice(2), stdin: readFileSync(0, 'utf8'), cwd: process.cwd(), ficheros: ficheros(process.cwd()) })}\n`);
  const ids = cargarPreguntas('standards/code.md', path.resolve(import.meta.dirname, '..', '..')).filter((q) => q.quien === CHECKED_BY.reviewer).map((q) => q.id);
  const respuestas = ids.map((id) => ({ id, respuesta: alterna && id === 'C5' && n % 2 === 1 ? ANSWER.no : ANSWER.yes, prueba: 'x' }));
  console.log(JSON.stringify(falla ? { is_error: true, result: 'falso' } : { is_error: false, total_cost_usd: 0.25, structured_output: { respuestas } }));
}
