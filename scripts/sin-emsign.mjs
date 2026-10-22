// Node trae su propia lista de autoridades (CA) y no mira revocaciones. Tras el incidente de eMudhra (oct 2026: las claves
// de 8 certificados intermedios se podían calcular; Mozilla, bug 2083449) Node 24.12 confiaba en las 4 raíces emSign y
// el parche, 24.22.1, aún confía en la G1. usuario/tls/sin-emsign.cjs las quita en cada proceso Node del PC; install-pc lo copia a
// ~/.claude/tls/ y este script hace que Node lo cargue siempre (NODE_OPTIONS del usuario de Windows).
//   node scripts/sin-emsign.mjs instalar    añade --require <~/.claude/tls/sin-emsign.cjs> a NODE_OPTIONS del usuario (terminal nueva)
//   node scripts/sin-emsign.mjs comprobar   sale con 1 si este proceso Node confía aún en alguna raíz emSign
// El arranque lo comprueba en cada sesión (paso «tls»). Windows (git y curl, con schannel) ya rechaza esas cadenas por revocación.
import { spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

// La precarga vive en usuario/<RELATIVA> del repo y install-pc la copia a ~/.claude/<RELATIVA>.
export const RELATIVA = path.join('tls', 'sin-emsign.cjs');
export const FUENTE = fileURLToPath(new URL(`../usuario/${RELATIVA.split(path.sep).join('/')}`, import.meta.url));
export const PRECARGA = (casa = homedir()) => path.join(casa, '.claude', RELATIVA);
export const OPCION = (precarga) => `--require ${precarga}`;

export const raicesEmSign = (pems = tls.getCACertificates('default')) =>
  pems.map((pem) => new X509Certificate(pem).subject.replace(/\n/g, ', ')).filter((s) => /emSign/.test(s));

// Fuera de Windows el paso falla igual (el riesgo es el mismo), pero el remedio es a mano: instalar solo sabe de Windows.
const remedio = (plataforma) => (plataforma === 'win32'
  ? 'npm run install-pc, luego npm run sin-emsign -- instalar, y abre una terminal nueva'
  : `npm run install-pc y añade «${OPCION(PRECARGA())}» a NODE_OPTIONS en tu shell (instalar solo lo hace en Windows)`);

export const pasoTls = (raices = raicesEmSign, plataforma = process.platform) => ({
  nombre: 'tls',
  ejecutar: (escribir) => {
    const quedan = raices();
    if (quedan.length) {
      throw new Error(`Node confía aún en ${quedan.length} raíces emSign (eMudhra, claves comprometidas): ${remedio(plataforma)}`);
    }
    escribir('tls: Node no confía en ninguna raíz emSign');
  },
});

// NODE_OPTIONS guardada para el usuario de Windows (no la de este proceso). '' solo si no existe; si la lectura falla,
// lanza: tomar un fallo por «no hay nada» haría que la escritura pisara lo que había.
const powershell = (orden, env = process.env) =>
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', orden], { encoding: 'utf8', env });
const fallo = (r) => r.error?.message ?? (r.stderr.trim() || `salió con ${r.status}`);

function leerDelUsuario() {
  const r = powershell("[Environment]::GetEnvironmentVariable('NODE_OPTIONS', 'User')");
  if (r.error || r.status !== 0) throw new Error(`no pude leer NODE_OPTIONS del usuario: ${fallo(r)}`);
  return r.stdout.trim();
}

// El valor va por una variable de entorno, no dentro de la orden: así no hay que escapar nada.
function escribirDelUsuario(valor) {
  const r = powershell("[Environment]::SetEnvironmentVariable('NODE_OPTIONS', $env:FABRICA_NODE_OPTIONS, 'User')", { ...process.env, FABRICA_NODE_OPTIONS: valor });
  if (r.error || r.status !== 0) throw new Error(`no pude guardar NODE_OPTIONS del usuario: ${fallo(r)}`);
}

// Valor nuevo de NODE_OPTIONS: el que había más la opción, sin repetirla. null si ya estaba.
export function nuevoValor(actual, precarga) {
  if (/\s/.test(precarga)) throw new Error(`la ruta ${precarga} tiene espacios y NODE_OPTIONS no la leería bien`);
  const opcion = OPCION(precarga);
  if (actual.includes(opcion)) return null;
  return actual ? `${actual} ${opcion}` : opcion;
}

// Escribe y vuelve a leer: si lo leído no es lo escrito, falla.
export function instalar({ precarga = PRECARGA(), plataforma = process.platform, leer = leerDelUsuario, escribir = escribirDelUsuario } = {}) {
  if (plataforma !== 'win32') throw new Error(`instalar solo sabe hacerlo en Windows (esto es ${plataforma})`);
  if (!existsSync(precarga)) throw new Error(`falta ${precarga}: corre antes npm run install-pc`);
  const valor = nuevoValor(leer(), precarga);
  if (valor === null) return `sin-emsign: NODE_OPTIONS ya carga ${precarga}`;
  escribir(valor);
  const leido = leer();
  if (leido !== valor) throw new Error(`NODE_OPTIONS no quedó guardada: escribí «${valor}» y leo «${leido}»`);
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
