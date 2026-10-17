// Prints how many gh calls each API got (REST and GraphQL are separate quotas), per hour, from the gh log (rutaDeRegistroGh in scripts/lib/gh-log.mjs).
//   npm run gh-calls
import { contarLlamadas, rutaDeRegistroGh } from './lib/gh-log.mjs';

console.log(JSON.stringify({ registro: rutaDeRegistroGh(), llamadas: contarLlamadas() }, null, 2));
