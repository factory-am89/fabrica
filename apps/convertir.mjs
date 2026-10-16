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
import { REPO as REPO_FABRICA } from '../scripts/lib/repo.mjs';

const REPO = process.env.REPO ?? REPO_FABRICA;
export const ENTORNO = 'revisor'; // los secretos del revisor viven en este environment (solo main), no en el repo

// Argumentos de `gh secret set` para un secreto del revisor: siempre en su environment.
export const ENTORNO_ADMIN = 'administrador'; // solo lo lee administrar.yml (plan-app-admin, punto 2)

// Argumentos de `gh secret set` para un secreto: siempre en un environment, nunca en el repo.
export const argsSecreto = (nombre, repo = REPO, entorno = ENTORNO) => ['secret', 'set', nombre, '--repo', repo, '--env', entorno];

// El environment limitado a main lo crea y COMPRUEBA apps/entorno.ps1 (misma función que usa el revisor, en lib-gh.ps1):
// la regla vive en un solo sitio. Argumentos de PowerShell para llamarlo.
export const argsEntornoPs = (repo, entorno) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
  fileURLToPath(new URL('./entorno.ps1', import.meta.url)), '-Repo', repo, '-Nombre', entorno];

export function destino(slug) {
  if (slug.startsWith('fabrica-constructor')) return 'constructor';
  if (slug.startsWith('fabrica-revisor')) return 'revisor';
  if (slug.startsWith('fabrica-administrador')) return 'administrador';
  throw new Error(`App inesperada: «${slug}». Solo se guardan fabrica-constructor, fabrica-revisor y fabrica-administrador.`);
}

// Ejecuta un programa pasando el secreto por la entrada estándar, nunca por argumentos.
function conStdin(programa, args, secreto) {
  const r = spawnSync(programa, args, { input: secreto, encoding: 'utf8', shell: process.platform === 'win32' });
  return { ok: r.status === 0, error: r.error?.message ?? r.stderr?.trim() };
}

function guardarEnFichero(slug, pem, motivo) {
  const carpeta = mkdtempSync(join(tmpdir(), 'fabrica-'));
  const ruta = join(carpeta, `${slug}.pem`);
  writeFileSync(ruta, pem, { mode: 0o600 });
  chmodSync(ruta, 0o600); // en Windows no restringe de verdad: muévela y bórrala enseguida
  console.log(`AVISO: ${motivo}. La clave está en ${ruta}. Guárdala donde toque y borra el fichero.`);
}

function guardarAdmin(app) {
  // Sin environment comprobado y limitado a main no se escribe ningún secreto.
  const r = spawnSync(process.platform === 'win32' ? 'powershell.exe' : 'pwsh', argsEntornoPs(REPO, ENTORNO_ADMIN), { encoding: 'utf8' });
  if (r.status !== 0) {
    return guardarEnFichero(app.slug, app.pem, `el environment ${ENTORNO_ADMIN} no quedó limitado a main, no escribo secretos (${r.error?.message ?? (r.stdout + r.stderr).trim()})`);
  }
  const clave = conStdin('gh', argsSecreto('ADMIN_APP_KEY', REPO, ENTORNO_ADMIN), app.pem);
  const id = conStdin('gh', argsSecreto('ADMIN_CLIENT_ID', REPO, ENTORNO_ADMIN), String(app.client_id));
  if (clave.ok && id.ok) return console.log(`Secretos ADMIN_APP_KEY y ADMIN_CLIENT_ID guardados en el environment ${ENTORNO_ADMIN} de ${REPO}.`);
  guardarEnFichero(app.slug, app.pem, `no pude escribir los secretos de ${REPO} (${clave.error ?? id.error})`);
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
  guardarEnFichero(app.slug, app.pem, `no pude escribir los secretos de ${REPO} (${clave.error ?? id.error})`);
  console.log(`Cuando puedas: gh secret set REVISOR_CLIENT_ID --repo ${REPO} --env ${ENTORNO} (el client id es ${app.client_id}, no es secreto). ¿Existe el environment ${ENTORNO}? Es el paso 2 de PASOS-PABLO.md.`);
}

async function main() {
  const code = process.argv[2];
  if (!code) throw new Error('Uso: node apps/convertir.mjs <code>');
  const res = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST',
    headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}: el código vale una sola vez y caduca en una hora.`);
  const app = await res.json();
  const quien = destino(app.slug);
  console.log(`App creada: ${app.slug} (id ${app.id}, client id ${app.client_id}). Falta instalarla en ${REPO}: ${app.html_url}/installations/new`);
  guardar(app, quien);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
