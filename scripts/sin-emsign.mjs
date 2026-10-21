// Node trae su propia lista de autoridades (CA) y no mira revocaciones. Tras el incidente de eMudhra (oct 2026: las claves
// de 8 certificados intermedios se podían calcular; Mozilla, bug 2083449) Node 24.12 seguía confiando en las 4 raíces
// emSign y no había parche. usuario/tls/sin-emsign.cjs las quita en cada proceso Node del PC; install-pc lo copia a
// ~/.claude/tls/ y este script hace que Node lo cargue siempre (NODE_OPTIONS del usuario de Windows).
//   node scripts/sin-emsign.mjs instalar    pone NODE_OPTIONS=--require <~/.claude/tls/sin-emsign.cjs> (setx; terminal nueva)
//   node scripts/sin-emsign.mjs comprobar   sale con 1 si este proceso Node confía aún en alguna raíz emSign
// El arranque lo comprueba en cada sesión (paso «tls»). Windows (git, curl) ya rechaza esas cadenas por revocación.
import { spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

export const PRECARGA = (casa = homedir()) => path.join(casa, '.claude', 'tls', 'sin-emsign.cjs');
export const OPCION = (precarga) => `--require ${precarga}`;

export const raicesEmSign = (pems = tls.getCACertificates('default')) =>
  pems.map((pem) => new X509Certificate(pem).subject.replace(/\n/g, ', ')).filter((s) => /emSign/.test(s));

export const pasoTls = (raices = raicesEmSign) => ({
  nombre: 'tls',
  ejecutar: (escribir) => {
    const quedan = raices();
    if (quedan.length) {
      throw new Error(`Node confía aún en ${quedan.length} raíces emSign (eMudhra, claves comprometidas): npm run install-pc, luego npm run sin-emsign -- instalar, y abre una terminal nueva`);
    }
    escribir('tls: Node no confía en ninguna raíz emSign');
  },
});

// NODE_OPTIONS del usuario tal como está guardado (no el de este proceso): '' si no hay.
function leerDelUsuario() {
  const r = spawnSync('reg', ['query', 'HKCU\\Environment', '/v', 'NODE_OPTIONS'], { encoding: 'utf8' });
  if (r.status !== 0) return '';
  const linea = r.stdout.split(/\r?\n/).find((l) => /^\s*NODE_OPTIONS\s+REG_/.test(l));
  return linea ? linea.replace(/^\s*NODE_OPTIONS\s+REG_\w+\s+/, '').trim() : '';
}

// Valor nuevo de NODE_OPTIONS: el que había más la opción, sin repetirla. null si ya estaba.
export function nuevoValor(actual, precarga) {
  if (/\s/.test(precarga)) throw new Error(`la ruta ${precarga} tiene espacios y NODE_OPTIONS no la leería bien`);
  const opcion = OPCION(precarga);
  if (actual.includes(opcion)) return null;
  return actual ? `${actual} ${opcion}` : opcion;
}

export function instalar({ precarga = PRECARGA(), plataforma = process.platform, leer = leerDelUsuario, setx = (v) => spawnSync('setx', ['NODE_OPTIONS', v], { encoding: 'utf8' }) } = {}) {
  if (plataforma !== 'win32') throw new Error(`instalar solo sabe hacerlo en Windows (esto es ${plataforma})`);
  if (!existsSync(precarga)) throw new Error(`falta ${precarga}: corre antes npm run install-pc`);
  const valor = nuevoValor(leer(), precarga);
  if (valor === null) return `sin-emsign: NODE_OPTIONS ya carga ${precarga}`;
  const r = setx(valor);
  if (r.status !== 0) throw new Error(`setx falló: ${(r.stderr || r.stdout || '').trim()}`);
  return `sin-emsign: NODE_OPTIONS=${valor} (vale en las terminales que abras a partir de ahora)`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const orden = process.argv[2];
  try {
    if (orden === 'instalar') console.log(instalar());
    else if (orden === 'comprobar') pasoTls().ejecutar(console.log);
    else throw new Error('Uso: sin-emsign.mjs instalar | comprobar');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
