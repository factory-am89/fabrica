// Prints how many gh calls each API got (REST and GraphQL are separate quotas), per hour, from the gh log (rutaDeRegistroGh in scripts/lib/registro-gh.mjs).
//   npm run llamadas-gh
import { contarLlamadas, rutaDeRegistroGh } from './lib/registro-gh.mjs';

console.log(JSON.stringify({ registro: rutaDeRegistroGh(), llamadas: contarLlamadas() }, null, 2));
