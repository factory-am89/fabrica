// Prints the whole entity registry (entities.json) in one go, after checking it.
//   node scripts/entities.mjs [--json] [root]   (output rule and exit codes: scripts/lib/exit.mjs)
// A registry with faults fails loudly (exit UNEXPECTED, the faults on stderr): a broken registry is never printed as if good.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand, finish } from './lib/exit.mjs';
import { baseHoles, entityFaults, readEntities } from './lib/entities.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function readRegistry(root) {
  const registry = readEntities(root);
  const faults = entityFaults(registry, root);
  if (faults.length > 0) throw new Error(faults.map((f) => `${f.code} ${f.where}: ${f.message}`).join('\n'));
  return { entities: registry.entities, baseHoles: baseHoles(registry) };
}

export const humanText = (r) => [
  `entities: ${r.entities.length} (base holes: ${r.baseHoles.length})`,
  ...r.entities.map((e) => `  ${e.id} [${e.scope}] base=${e.base ?? '-'} forge=${e.forge ?? '-'}`),
].join('\n');

export const cliEntities = (argv) => runCommand(argv, { run: ([root = REPO]) => readRegistry(path.resolve(root)), human: humanText });

if (process.argv[1] === fileURLToPath(import.meta.url)) finish(cliEntities(process.argv.slice(2)));
