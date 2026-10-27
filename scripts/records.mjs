// Reads the verdict records of the `revisor` check-runs and prints the figures (rounds per PR, "no" per question).
//   node scripts/records.mjs --file <path> [--json]
// <path> is a JSON array of check-runs as the GitHub API returns them (only output.text is read). No network.
// Exit 1 when a check-run has no readable record (listed with its index) or the file cannot be read: a count that skips them would be false.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aggregate, readCheckRuns } from './lib/record.mjs';

export function informe(checkRuns, { json = false } = {}) {
  const { records, overrides, pending, cut, unreadable } = readCheckRuns(checkRuns);
  const { porPr, porPregunta } = aggregate(records);
  const prs = Object.keys(porPr).length;
  const rondasMedias = prs ? records.length / prs : null;
  const cifras = { records: records.length, porPr, porPregunta, rondasMedias, overrides, pending, cut, unreadable };
  if (json) return { salida: JSON.stringify(cifras, null, 2), unreadable };
  const lineas = [`records: ${records.length}`, `prs: ${prs}`, `rondasMedias: ${rondasMedias}`, `overrides: ${overrides}`, `pending: ${pending}`, `cut: ${cut}`];
  for (const [k, v] of Object.entries(porPr)) lineas.push(`${k}: ${JSON.stringify(v)}`);
  for (const [k, v] of Object.entries(porPregunta)) lineas.push(`${k}: ${JSON.stringify(v)}`);
  return { salida: lineas.join('\n'), unreadable };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const i = process.argv.indexOf('--file');
    const ruta = i > 0 ? process.argv[i + 1] : undefined;
    if (!ruta) throw new Error('usage: node scripts/records.mjs --file <path> [--json]');
    let datos;
    try {
      datos = JSON.parse(readFileSync(ruta, 'utf8'));
    } catch (e) {
      throw new Error(`cannot read ${ruta}: ${e.message}`);
    }
    if (!Array.isArray(datos)) throw new Error(`${ruta} must be a JSON array of check-runs`);
    const { salida, unreadable } = informe(datos, { json: process.argv.includes('--json') });
    console.log(salida);
    if (unreadable.length > 0) {
      console.error(`records: ${unreadable.length} check-run(s) without a readable record (index: ${unreadable.map((u) => u.index).join(', ')}); the figures above leave them out`);
      process.exit(1);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
