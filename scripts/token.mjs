// Token de instalación de fabrica-constructor, a demanda y de un solo uso.
//   node scripts/token.mjs -- gh pr create --fill
// Saca la clave privada de 1Password (bóveda Fabrica) en memoria, firma un JWT, canjea un
// token de instalación (dura una hora) y lanza la orden con GH_TOKEN puesto. El token y la
// clave no se imprimen, no van por argumentos y no se guardan en disco: cada uso, un token.
// Variables: FABRICA_CONSTRUCTOR_CLIENT_ID (el client id de la App, no es secreto; lo imprime
// convertir.mjs), FABRICA_REPO (por defecto, REPO de scripts/lib/repo.mjs), OP_VAULT (por defecto Fabrica).
import { createSign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO } from './lib/repo.mjs';

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

// JWT RS256 de la App: iss es el client id; iat 60 s atrás por si los relojes difieren.
export function jwt(clientId, pem, ahora = Math.floor(Date.now() / 1000)) {
  const cuerpo = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: ahora - 60, exp: ahora + 540, iss: clientId })}`;
  return `${cuerpo}.${createSign('RSA-SHA256').update(cuerpo).sign(pem, 'base64url')}`;
}

// Separa lo propio de la orden: todo lo que va detrás de `--`.
export function orden(argv) {
  const i = argv.indexOf('--');
  const cmd = i === -1 ? [] : argv.slice(i + 1);
  if (cmd.length === 0) throw new Error('Uso: node scripts/token.mjs -- <orden> [argumentos]');
  return cmd;
}

async function api(jwtApp, metodo, ruta) {
  const res = await fetch(`https://api.github.com${ruta}`, {
    method: metodo,
    headers: { authorization: `Bearer ${jwtApp}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`${metodo} ${ruta} → ${res.status}`);
  return res.json();
}

// Entrada del llavero de Windows donde el script de arranque de Pablo guarda el token.
// Su nombre vive solo en apps/llavero.json, que también lee apps/arranque.ps1.
const { recurso: LLAVERO_RECURSO, usuario: LLAVERO_USUARIO } = JSON.parse(
  readFileSync(new URL('../apps/llavero.json', import.meta.url), 'utf8'),
);

// Lee el token del llavero (PasswordVault) con powershell.exe 5.1. El valor vuelve por el
// stdout del proceso hijo: ni argumentos, ni ficheros, ni pantalla. Si falla, devuelve ''.
// Orden de PowerShell que lee la entrada. Con -Command, una excepción de un método .NET solo corta
// esa sentencia y el proceso sale con 0: el Stop del principio hace que, si la entrada no existe,
// el bloque pare y el proceso salga con 1 (mismo bloque que Llavero-Orden-Leer de apps/lib-gh.ps1).
export function ordenLeerLlavero(recurso, usuario) {
  return (
    "$ErrorActionPreference = 'Stop'; " +
    '[void][Windows.Security.Credentials.PasswordVault, Windows.Security.Credentials, ContentType = WindowsRuntime]; ' +
    '$v = New-Object Windows.Security.Credentials.PasswordVault; ' +
    `$c = $v.Retrieve('${recurso}', '${usuario}'); $c.RetrievePassword(); [Console]::Out.Write($c.Password)`
  );
}

export function leerLlavero(recurso = LLAVERO_RECURSO, usuario = LLAVERO_USUARIO) {
  const ps = ordenLeerLlavero(recurso, usuario);
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 15000,
  });
  return r.status === 0 ? (r.stdout ?? '') : '';
}

// El entorno manda; si no, el llavero (inyectable para los tests). El error no lleva valores.
export function tokenServicio(env = process.env, llavero = leerLlavero) {
  const delEntorno = (env.OP_SERVICE_ACCOUNT_TOKEN ?? '').trim();
  if (delEntorno) return delEntorno;
  let delLlavero = '';
  try {
    delLlavero = (llavero() ?? '').trim();
  } catch {
    delLlavero = '';
  }
  if (delLlavero) return delLlavero;
  throw new Error('Falta el token de la cuenta de servicio de 1Password (ni en el entorno ni en el llavero): lanza el script de arranque de Pablo.');
}

// Entorno del hijo: siempre GH_TOKEN. Si la orden es git, además un helper de credenciales que
// devuelve el token de la App y solo ese: git no lee GH_TOKEN y, con un helper de sistema (Windows
// trae «manager»), preguntaría por otra cuenta. Todo por variables de entorno (GIT_CONFIG_COUNT/KEY/VALUE,
// que git aplica después de la config de sistema, global y local), nunca por argumentos: el token solo
// está en GH_TOKEN; el helper lo lee de ahí.
export const HELPER_GIT = '!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f';
export function entornoHijo(cmd, token, env = process.env) {
  const hijo = { ...env, GH_TOKEN: token };
  if (!/^git(.exe)?$/i.test(win32.basename(cmd[0]))) return hijo;
  const n = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10) || 0;
  hijo[`GIT_CONFIG_KEY_${n}`] = 'credential.helper';
  hijo[`GIT_CONFIG_VALUE_${n}`] = '';
  hijo[`GIT_CONFIG_KEY_${n + 1}`] = 'credential.helper';
  hijo[`GIT_CONFIG_VALUE_${n + 1}`] = HELPER_GIT;
  hijo.GIT_CONFIG_COUNT = String(n + 2);
  hijo.GIT_TERMINAL_PROMPT = '0';
  return hijo;
}

function clavePrivada() {
  const args = ['document', 'get', 'fabrica-constructor.pem', '--vault', process.env.OP_VAULT ?? 'Fabrica'];
  const token = tokenServicio();
  const r = spawnSync('op', args, { encoding: 'utf8', env: { ...process.env, OP_SERVICE_ACCOUNT_TOKEN: token } });
  if (r.status !== 0 || !r.stdout.includes('PRIVATE KEY')) {
    throw new Error('No pude leer fabrica-constructor.pem de 1Password (bóveda Fabrica). Quizá el token de la cuenta de servicio no tiene acceso a la caja Fabrica.');
  }
  return r.stdout;
}

async function main() {
  const cmd = orden(process.argv.slice(2));
  const clientId = process.env.FABRICA_CONSTRUCTOR_CLIENT_ID;
  if (!clientId) throw new Error('Falta FABRICA_CONSTRUCTOR_CLIENT_ID (el client id de fabrica-constructor).');
  const repo = process.env.FABRICA_REPO ?? REPO;
  const firmado = jwt(clientId, clavePrivada());
  const { id } = await api(firmado, 'GET', `/repos/${repo}/installation`);
  const { token } = await api(firmado, 'POST', `/app/installations/${id}/access_tokens`);
  const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', env: entornoHijo(cmd, token) });
  if (r.error) throw new Error(`No pude lanzar «${cmd[0]}»: ${r.error.message}`);
  process.exit(r.status ?? 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
