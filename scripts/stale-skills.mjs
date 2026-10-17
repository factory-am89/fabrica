// Lists the skills not reviewed for more than REVISAR_DIAS days (the reader of `comprobado`). Reports, never blocks.
//   npm run stale-skills        (optional argv[2]: repo root, for tests)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skillsViejas, REVISAR_DIAS } from './lib/skills.mjs';

const raiz = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const hoy = new Date().toISOString().slice(0, 10);
const viejas = skillsViejas(raiz, hoy);
if (viejas.length === 0) console.log('ninguna');
for (const v of viejas) console.log(`${v.nombre}: revisada ${v.comprobado}, hace ${v.dias} días (más de ${REVISAR_DIAS})`);
