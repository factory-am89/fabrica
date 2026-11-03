// Prepara la ronda del juez con memoria (scripts/lib/ronda.mjs). Variables: REPO, PR, SHA, BASE, ANTES (opcional), LECTOR (token de
// solo lectura del workflow), REVISOR_APP_SLUG, RUNNER_TEMP y GITHUB_OUTPUT.
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOTIVO, ROUND_FILE, readPrevious } from './lib/ronda.mjs';
import { buscarRonda } from './veredicto.mjs';

// El paso `ronda` de juzgar (revisor.yml), antes de Claude, con el token de solo lectura del workflow y ningún token de la App: deja para Claude
// $RUNNER_TEMP/anterior.json (la ronda y, desde la 2, su veredicto anterior) y $RUNNER_TEMP/incremental.diff, y la misma ronda como
// salida del paso (`anterior`), que el veredicto lee de ahí: Claude no puede cambiar la salida de un paso ya terminado. Si no se puede
// leer el veredicto anterior, se juzga como ronda 1 (la más estricta) y se dice en el log y en el check, con un motivo cerrado.
export async function preparaRonda({ REPO, PR, SHA, BASE, ANTES, LECTOR, RUNNER_TEMP, GITHUB_OUTPUT }) {
  let hallada;
  try {
    hallada = await buscarRonda({ repo: REPO, pr: PR, sha: SHA, base: BASE, antes: ANTES, token: LECTOR });
  } catch (e) {
    console.log(`::warning::${MOTIVO.unreadable}: ${e.message}; se juzga como ronda 1`);
    hallada = { anterior: { ronda: 1, motivo: MOTIVO.unreadable }, diff: '' };
  }
  const linea = JSON.stringify(hallada.anterior);
  readPrevious(linea);
  writeFileSync(path.join(RUNNER_TEMP, ROUND_FILE.previous), `${linea}\n`);
  writeFileSync(path.join(RUNNER_TEMP, ROUND_FILE.incremental), hallada.diff);
  appendFileSync(GITHUB_OUTPUT, `anterior=${linea}\n`);
  console.log(hallada.anterior.ronda === 1 ? `ronda 1: ${hallada.anterior.motivo}` : `ronda ${hallada.anterior.ronda}: veredicto anterior sobre ${hallada.anterior.sha}; tocados: ${hallada.anterior.tocados.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const faltan = ['REPO', 'PR', 'SHA', 'BASE', 'LECTOR', 'RUNNER_TEMP', 'GITHUB_OUTPUT'].filter((k) => !process.env[k]);
  if (faltan.length) {
    console.error(`faltan las variables ${faltan.join(', ')}`);
    process.exit(1);
  }
  preparaRonda(process.env).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
