// scripts/token.mjs falso para los tests de la limpieza: mismos argumentos (-- <orden>), sin red ni 1Password.
//   gh api <ruta>  -> imprime el fichero de FALSO_PRS (JSON) y anota la ruta en FALSO_LOG
//   git ...        -> lanza git tal cual (así el borrado de la rama remota va a un remoto local)
// FALSO_FALLA=1: la consulta a GitHub falla, como si no respondiera.
import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// `node --test` también ejecuta los ficheros de test/ sin argumentos: sin «--» no hace nada.
const i = process.argv.indexOf('--');
const [cmd, ...args] = process.argv.slice(i + 1);
if (i === -1) {
  // lanzado por node --test, no por limpiar
} else if (cmd === 'gh') {
  if (process.env.FALSO_LOG) appendFileSync(process.env.FALSO_LOG, `${args.join(' ')}\n`);
  if (process.env.FALSO_FALLA) {
    console.error('token-falso: sin respuesta');
    process.exit(1);
  }
  process.stdout.write(readFileSync(process.env.FALSO_PRS, 'utf8'));
} else if (cmd === 'git') {
  process.exit(spawnSync('git', args, { stdio: 'inherit' }).status ?? 1);
} else {
  console.error(`token-falso: orden no prevista: ${cmd}`);
  process.exit(2);
}
