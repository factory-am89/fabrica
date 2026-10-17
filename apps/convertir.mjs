// Canjea el código del manifest por las credenciales de la App y guarda la clave
// privada sin imprimirla: la del constructor, en 1Password; la del revisor, en
// los secretos del environment `revisor` del repo; la del administrador, en los del environment `administrador`
// (que crea limitado a `main` si falta). Si no puede, la deja en un fichero temporal protegido y lo dice.
// Uso: node apps/convertir.mjs <code>
// Variables opcionales: REPO (por defecto, el de scripts/lib/repo.mjs), OP_VAULT (bóveda de 1Password).
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO as REPO_FABRICA, ADMIN_APP_SLUG } from '../scripts/lib/repo.mjs';

const REPO = process.env.REPO ?? REPO_FABRICA;
export const ENTORNO = 'revisor'; // los secretos del revisor viven en este environment (solo main), no en el repo

// Argumentos de `gh secret set` para un secreto del revisor: siempre en su environment.
export const ENTORNO_ADMIN = 'administrador'; // solo lo lee administrar.yml (plans/app-admin.md, punto 2)

// Argumentos de `gh secret set` para un secreto: siempre en un environment, nunca en el repo.
export const argsSecreto = (nombre, repo = REPO, entorno = ENTORNO) => ['secret', 'set', nombre, '--repo', repo, '--env', entorno];

// El environment limitado a main lo crea y COMPRUEBA apps/entorno.ps1 (misma función que usa el revisor, en lib-gh.ps1):
// la regla vive en un solo sitio. Argumentos de PowerShell para llamarlo.
export const argsEntornoPs = (repo, entorno) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
  fileURLToPath(new URL('./entorno.ps1', import.meta.url)), '-Repo', repo, '-Nombre', entorno];

export function destino(slug) {
  if (slug.startsWith('fabrica-constructor')) return 'constructor';
  if (slug.startsWith('fabrica-revisor')) return 'revisor';
  if (slug.startsWith(ADMIN_APP_SLUG)) return 'administrador';
  throw new Error(`App inesperada: «${slug}». Solo se guardan fabrica-constructor, fabrica-revisor y fabrica-administrador.`);
}

// Ejecuta un programa pasando el secreto por la entrada estándar, nunca por argumentos.
function conStdin(programa, args, secreto) {
  const r = spawnSync(programa, args, { input: secreto, encoding: 'utf8', shell: process.platform === 'win32' });
  return { ok: r.status === 0, error: r.error?.message ?? r.stderr?.trim() };
}

// Exact commands to upload the key from the fallback file (the key itself is never printed).
function comandosSubida(slug, ruta, entorno) {
  if (!entorno) return `op document create "${ruta}" --title ${slug}.pem`;
  const nombre = entorno === ENTORNO_ADMIN ? 'ADMIN_APP_KEY' : 'REVISOR_APP_KEY';
  return `Get-Content -Raw "${ruta}" | gh secret set ${nombre} --repo ${REPO} --env ${entorno}`;
}

function guardarEnFichero(slug, pem, motivo, entorno) {
  const carpeta = mkdtempSync(join(tmpdir(), 'fabrica-'));
  const ruta = join(carpeta, `${slug}.pem`);
  writeFileSync(ruta, pem, { mode: 0o600 });
  chmodSync(ruta, 0o600); // on Windows this does not really restrict: upload and delete at once
  console.log(`WARNING: ${motivo}. The private key is in ${ruta} (GitHub cannot show it again; losing it means regenerating it).`);
  console.log(`1. Upload it: ${comandosSubida(slug, ruta, entorno)}`);
  console.log(`2. Delete the folder: Remove-Item -Recurse -Force "${carpeta}"`);
}

function guardarAdmin(app) {
  // Sin environment comprobado y limitado a main no se escribe ningún secreto.
  const r = spawnSync(POWERSHELL, argsEntornoPs(REPO, ENTORNO_ADMIN), { encoding: 'utf8' });
  if (r.status !== 0) {
    return guardarEnFichero(app.slug, app.pem, `el environment ${ENTORNO_ADMIN} no quedó limitado a main, no escribo secretos (${r.error?.message ?? (r.stdout + r.stderr).trim()})`, ENTORNO_ADMIN);
  }
  const clave = conStdin('gh', argsSecreto('ADMIN_APP_KEY', REPO, ENTORNO_ADMIN), app.pem);
  const id = conStdin('gh', argsSecreto('ADMIN_CLIENT_ID', REPO, ENTORNO_ADMIN), String(app.client_id));
  if (clave.ok && id.ok) return console.log(`Secretos ADMIN_APP_KEY y ADMIN_CLIENT_ID guardados en el environment ${ENTORNO_ADMIN} de ${REPO}.`);
  guardarEnFichero(app.slug, app.pem, `no pude escribir los secretos de ${REPO} (${clave.error ?? id.error})`, ENTORNO_ADMIN);
}

function guardar(app, quien) {
  if (quien === 'constructor') {
    const args = ['document', 'create', '-', '--title', `${app.slug}.pem`];
    if (process.env.OP_VAULT) args.push('--vault', process.env.OP_VAULT);
    const r = conStdin('op', args, app.pem);
    if (r.ok) return console.log(`Clave del constructor guardada en 1Password como «${app.slug}.pem».`);
    return guardarEnFichero(app.slug, app.pem, `no pude escribir en 1Password (${r.error})`);
  }
  if (quien === 'administrador') return guardarAdmin(app);
  const clave = conStdin('gh', argsSecreto('REVISOR_APP_KEY'), app.pem);
  const id = conStdin('gh', argsSecreto('REVISOR_CLIENT_ID'), String(app.client_id));
  if (clave.ok && id.ok) return console.log(`Secretos REVISOR_APP_KEY y REVISOR_CLIENT_ID guardados en el environment ${ENTORNO} de ${REPO}.`);
  guardarEnFichero(app.slug, app.pem, `no pude escribir los secretos de ${REPO} (${clave.error ?? id.error})`, ENTORNO);
  console.log(`Cuando puedas: gh secret set REVISOR_CLIENT_ID --repo ${REPO} --env ${ENTORNO} (el client id es ${app.client_id}, no es secreto). ¿Existe el environment ${ENTORNO}? Es el paso 2 de PASOS-PABLO.md.`);
}

const POWERSHELL = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const run = (programa, args) => spawnSync(programa, args, { encoding: 'utf8', shell: process.platform === 'win32' && programa === 'gh' });

// Everything the code exchange needs afterwards, checked BEFORE it: the code is single-use and the private key
// exists only in memory once it is exchanged. Returns the list of problems (empty = go ahead). Nothing is consumed.
export function previos(runner = run, repo = REPO) {
  const problemas = [];
  const auth = runner('gh', ['auth', 'status']);
  if (auth.error || auth.status !== 0) {
    problemas.push('gh is not logged in. Run `gh auth login`, then the same command again: the code is still valid for up to one hour.');
  } else {
    const api = runner('gh', ['api', `repos/${repo}`]);
    let admin = false;
    try { admin = api.status === 0 && JSON.parse(api.stdout).permissions?.admin === true; } catch { admin = false; }
    if (!admin) {
      problemas.push(`The gh account cannot administer ${repo}. Run \`gh auth login\` with an administrator account, then the same command again: the code is still valid for up to one hour.`);
    }
  }
  const ps = runner(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']);
  if (ps.error || ps.status !== 0) {
    problemas.push(`${POWERSHELL} is not available, so apps/entorno.ps1 cannot create the environment. Install it, then run the same command again: the code is still valid for up to one hour.`);
  }
  return problemas;
}

export async function convertir(code, { fetchFn = fetch, runner = run } = {}) {
  if (!code) throw new Error('Uso: node apps/convertir.mjs <code>');
  const problemas = previos(runner);
  if (problemas.length) throw new Error(`Code NOT exchanged (still unused):\n- ${problemas.join('\n- ')}`);
  const res = await fetchFn(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST',
    headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}: el código vale una sola vez y caduca en una hora.`);
  const app = await res.json();
  const quien = destino(app.slug);
  console.log(`App creada: ${app.slug} (id ${app.id}, client id ${app.client_id}). Falta instalarla en ${REPO}: ${app.html_url}/installations/new`);
  guardar(app, quien);
}

// Exit code of the command: 0 done, 1 any failure (message on stderr).
export async function cli(args, deps) {
  try {
    await convertir(args[0], deps);
    return 0;
  } catch (e) {
    console.error(e.message);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await cli(process.argv.slice(2)));
}
