// Imprime (solo imprime) el cuerpo del ruleset de una rama buena, para aplicarlo a mano con un PUT
// (plans/puente-1, trozo 8; paso 6 de Pablo). No habla con GitHub ni toca el disco: el cuerpo sale de rulesetBody.
// Uso: la constante USO de abajo. Lo que valen las opciones que se omiten lo decide rulesetBody, no este fichero.
// This file is a gate file (scripts/lib/gate.mjs, folder scripts/admin/); the machine guard of the key scans it.
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { rulesetBody } from './proyecto.mjs';

const USO = 'uso: node scripts/admin/cuerpo-ruleset.mjs --app-id <numero> [--name <nombre>] [--strict] [--tests-context <check>]';

// De los argumentos a la cadena JSON del cuerpo. Lanza con un texto claro si falta algo o no se entiende.
export function cuerpoDesdeArgumentos(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'app-id': { type: 'string' },
      name: { type: 'string' },
      strict: { type: 'boolean' },
      'tests-context': { type: 'string' },
    },
    strict: true,
  });
  if (values['app-id'] === undefined || !/^[0-9]+$/.test(values['app-id'])) throw new Error(`falta --app-id con el numero de la App revisora. ${USO}`);
  const opciones = { revisorAppId: Number(values['app-id']) };
  if (values.strict !== undefined) opciones.strict = values.strict;
  if (values.name !== undefined) opciones.name = values.name;
  if (values['tests-context'] !== undefined) opciones.testsContext = values['tests-context'];
  return `${JSON.stringify(rulesetBody(opciones), null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(cuerpoDesdeArgumentos(process.argv.slice(2)));
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
}
