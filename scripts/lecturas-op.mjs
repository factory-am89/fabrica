// Prints how many 1Password reads each script made, from the read log (rutaDeRegistro in scripts/lib/registro-op.mjs).
//   npm run lecturas-op
import { contarLecturas, rutaDeRegistro } from './lib/registro-op.mjs';

console.log(JSON.stringify({ registro: rutaDeRegistro(), lecturas: contarLecturas() }, null, 2));
