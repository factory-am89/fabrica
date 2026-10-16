// Disk cache for the fabrica-constructor installation token, ported from MenuPlan's
// scripts/lib/cacheTokenSesion.mjs (same design, smaller scope).
//
// Why: token.mjs read fabrica-constructor.pem from 1Password on every gh/git call, and several
// agents in a loop exhausted the service-account quota ("Too many requests"; incident in the 1password skill).
// An installation token lives 1 hour: it is saved and reused until MARGEN_MS before it expires.
//
// One file per system user, outside the repo and OneDrive (see rutaDeCache for the path), readable only
// by that user (icacls ACL on Windows, mode 0600 on POSIX). It holds the token, its expiry and the App client id, and nothing else: NEVER the .pem.
// Disk and clock are injectable so tests use a temp directory.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fsReal from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// Shape of a GitHub installation token: read and write refuse anything else, so the file never holds arbitrary text.
export const FORMA_TOKEN = /^ghs_[A-Za-z0-9_.-]{20,}$/;
// Reused only while more than this is left: a served token always has at least this much life.
export const MARGEN_MS = 15 * 60 * 1000;
// An installation token lasts 1 hour; a little clock skew is accepted and nothing more.
export const VIDA_MAX_MS = 60 * 60 * 1000 + 2 * 60 * 1000;
export const ESPERA_BLOQUEO_MS = 6000;
export const SONDEO_MS = 100;
// A lock older than this was left by a dead process (a normal exchange takes far less).
export const BLOQUEO_VIEJO_MS = 20_000;
export const FORMA_FECHA = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const FORMA_APP = /^[A-Za-z0-9._-]{1,64}$/;
const VERSION = 1;
const CLAVES = ['v', 'token', 'expiraEn', 'appId'];

// Closed vocabulary of why the cache is not used (or not saved). Code refers to MOTIVO.<name>; `ok` means
// usable / saved. leerCache and escribirCache return these; token.mjs prints them as `cache: <reason>`.
//   ausente: no file (normal, silent) · corrupto / forma: unreadable or unexpected content · caducado: expired
//   otra-app: saved for another client id · permisos: not closed to the user alone
//   disco: the file system failed (cannot stat, read, create the lock or write)
//   sin-ruta: no valid cache folder · otro-dueno: FABRICA_REPO belongs to another owner
export const MOTIVO = Object.freeze({
  ok: 'ok', ausente: 'ausente', corrupto: 'corrupto', forma: 'forma', caducado: 'caducado', 'otra-app': 'otra-app',
  permisos: 'permisos', disco: 'disco', 'sin-ruta': 'sin-ruta', 'otro-dueno': 'otro-dueno',
});
export const MOTIVOS_CACHE = Object.values(MOTIVO);

const normaliza = (r) => String(r).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

// Where the cache lives: the same path for every session of the same system user. LOCALAPPDATA comes
// from the environment, so it only counts inside the user profile and outside OneDrive; otherwise
// ~/.fabrica. Returns null if neither is valid (the cache is then disabled).
export function rutaDeCache(env = process.env, casa = homedir) {
  const perfil = normaliza(casa());
  const vale = (dir) => {
    const d = normaliza(dir);
    return (d === perfil || d.startsWith(`${perfil}/`)) && !/onedrive/.test(d) && !d.split('/').includes('..');
  };
  if (env.LOCALAPPDATA && vale(env.LOCALAPPDATA)) return join(env.LOCALAPPDATA, 'Fabrica', 'token-cache.json');
  const respaldo = join(casa(), '.fabrica');
  return vale(respaldo) ? join(respaldo, 'token-cache.json') : null;
}

// Windows tools by absolute path: in Git Bash the PATH carries a GNU `whoami` that rejects `/user`.
const SYS32 = (exe) => join(process.env.SystemRoot || 'C:\\Windows', 'System32', exe);
let identidadEnWindows = null;
// The system user, without reading the environment: { nombre: 'DOMAIN\\user', sid } (`whoami /user`).
export function identidadWindows() {
  if (identidadEnWindows) return identidadEnWindows;
  const salida = execFileSync(SYS32('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  const m = /^"([^"]+)","(S-1-[\d-]+)"/.exec(salida.trim());
  if (!m) throw new Error('whoami returned no SID');
  identidadEnWindows = { nombre: m[1], sid: m[2] };
  return identidadEnWindows;
}

// The users or groups with access listed by `icacls <path>`: everything before `:(` (names may hold
// spaces), dropping the path that opens the first line.
export function principalesDeIcacls(salida, ruta) {
  const fuera = [];
  for (const linea of String(salida).split(/\r?\n/)) {
    let t = linea.trim();
    if (t.toLowerCase().startsWith(String(ruta).toLowerCase())) t = t.slice(String(ruta).length).trim();
    const m = /^(.+?):\(/.exec(t);
    if (m) fuera.push(m[1]);
  }
  return fuera;
}

// Leaves the file for the user only: ACL without inheritance and a single grant (by SID) on Windows,
// 0600 on POSIX. Returns false if it could not (the cache is then not written).
export function protegerFichero(ruta) {
  try {
    if (process.platform === 'win32') {
      // `/reset` first: `/grant:r` only replaces the user's own entry and would keep a foreign one
      const opciones = { stdio: 'ignore', timeout: 5000, windowsHide: true };
      execFileSync(SYS32('icacls.exe'), [ruta, '/reset'], opciones);
      execFileSync(SYS32('icacls.exe'), [ruta, '/inheritance:r', '/grant:r', `*${identidadWindows().sid}:(F)`], opciones);
    } else {
      fsReal.chmodSync(ruta, 0o600);
    }
    return true;
  } catch {
    // on purpose: without closed permissions the token is not saved; the caller exchanges as before
    return false;
  }
}

// Can only the user touch the file? Any other permission (or not being able to look) is "no".
// On Windows the name must be the full `DOMAIN\user`: the same user of another domain does not count.
export function permisosDelUsuario(ruta, yo = null) {
  try {
    if (process.platform === 'win32') {
      const salida = execFileSync(SYS32('icacls.exe'), [ruta], { encoding: 'utf8', timeout: 5000, windowsHide: true });
      const principales = principalesDeIcacls(salida, ruta).map((p) => p.toLowerCase());
      const mio = (yo ?? identidadWindows().nombre).toLowerCase();
      return principales.length > 0 && principales.every((p) => p === mio);
    }
    const st = fsReal.statSync(ruta);
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return false;
    return (st.mode & 0o077) === 0;
  } catch {
    // on purpose: not being able to check the permissions is the same as not trusting them
    return false;
  }
}

// Reads and validates the cache. Returns { motivo, entrada?, restanteMs? }: `motivo` is one of
// MOTIVOS_CACHE and only with `ok` is there an `entrada` ({ token }).
// `ids`: { appId } (the App client id).
export function leerCache({ ruta, ids, reloj = Date.now, fs = fsReal, permisosBien = permisosDelUsuario }) {
  try {
    fs.statSync(ruta);
  } catch (e) {
    // no file is the normal first run; any other failure (permissions, disk) is reported by the caller
    return { motivo: e?.code === 'ENOENT' ? MOTIVO.ausente : MOTIVO.disco };
  }
  // Permissions are checked BEFORE reading the content: a file that is not the user's alone is not opened
  if (!permisosBien(ruta)) return { motivo: MOTIVO.permisos };
  let crudo;
  try {
    crudo = fs.readFileSync(ruta, 'utf8');
  } catch {
    // the reason is returned and the caller prints it
    return { motivo: MOTIVO.disco };
  }
  let d;
  try {
    d = JSON.parse(crudo);
  } catch {
    // the reason is returned and the caller prints it
    return { motivo: MOTIVO.corrupto };
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { motivo: MOTIVO.corrupto };
  const claves = Object.keys(d);
  if (claves.length !== CLAVES.length || !CLAVES.every((k) => claves.includes(k)) || d.v !== VERSION) return { motivo: MOTIVO.forma };
  if (typeof d.token !== 'string' || !FORMA_TOKEN.test(d.token)) return { motivo: MOTIVO.forma };
  if (typeof d.expiraEn !== 'string' || !FORMA_FECHA.test(d.expiraEn)) return { motivo: MOTIVO.forma };
  if (typeof d.appId !== 'string' || !FORMA_APP.test(d.appId)) return { motivo: MOTIVO.forma };
  const expira = Date.parse(d.expiraEn);
  if (!Number.isFinite(expira)) return { motivo: MOTIVO.forma };
  if (d.appId !== String(ids.appId)) return { motivo: MOTIVO['otra-app'] };
  const restanteMs = expira - reloj();
  if (restanteMs > VIDA_MAX_MS) return { motivo: MOTIVO.forma };
  if (restanteMs <= 0) return { motivo: MOTIVO.caducado };
  return { motivo: MOTIVO.ok, restanteMs, entrada: { token: d.token } };
}

// Saves the cache atomically: an empty temp file with its permissions closed BEFORE the token is
// written, then `rename` over the final one. Returns MOTIVO.ok if it was written, else the reason
// (permisos, forma or disco); the caller prints it, so a cache that cannot be saved is never silent.
export function escribirCache({ ruta, datos, fs = fsReal, proteger = protegerFichero }) {
  const tmp = `${ruta}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  let motivo = MOTIVO.disco;
  try {
    fs.mkdirSync(dirname(ruta), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, '', { flag: 'wx', mode: 0o600 });
    if (!proteger(tmp)) {
      motivo = MOTIVO.permisos;
      throw new Error('permissions');
    }
    const { token, expiraEn, appId } = datos;
    if (!FORMA_FECHA.test(String(expiraEn)) || !FORMA_TOKEN.test(String(token))) {
      motivo = MOTIVO.forma;
      throw new Error('shape');
    }
    fs.writeFileSync(tmp, JSON.stringify({ v: VERSION, token, expiraEn, appId }));
    fs.renameSync(tmp, ruta);
    return MOTIVO.ok;
  } catch {
    // not saving the cache only costs another exchange, so it does not break the call; the reason is returned
    try {
      fs.unlinkSync(tmp);
    } catch {
      // on purpose: the temp file may not have been created
    }
    return motivo;
  }
}

const dormirReal = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Runs `fn({ bloqueado, razon })` under an exclusive-create (`wx`) lock next to the cache. If another
// process holds it, polls until `esperaMs`; a lock older than BLOQUEO_VIEJO_MS is an orphan and is
// removed. If it cannot get the lock, runs `fn` with `bloqueado: false` and a `razon`: `ocupado`
// (someone else is exchanging: the caller must NOT exchange in parallel) or `error` (the lock cannot
// be created, e.g. permissions: exchanging without it is the only option).
export async function conBloqueo({ ruta, fn, fs = fsReal, reloj = Date.now, dormir = dormirReal, esperaMs = ESPERA_BLOQUEO_MS, sondeoMs = SONDEO_MS }) {
  const lock = `${ruta}.lock`;
  const limite = reloj() + esperaMs;
  let tengo = false;
  let razon = 'error';
  try {
    fs.mkdirSync(dirname(ruta), { recursive: true, mode: 0o700 });
  } catch {
    // on purpose: if not even the folder can be created, the lock attempt fails below and goes on without it
  }
  for (;;) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      tengo = true;
      break;
    } catch (e) {
      if (e?.code !== 'EEXIST') break;
    }
    try {
      if (reloj() - fs.statSync(lock).mtimeMs > BLOQUEO_VIEJO_MS) {
        fs.unlinkSync(lock);
        continue;
      }
    } catch (e) {
      if (e?.code === 'ENOENT') continue; // released in between
      break;
    }
    razon = 'ocupado';
    if (reloj() >= limite) break;
    await dormir(sondeoMs);
  }
  try {
    return await fn({ bloqueado: tengo, razon: tengo ? null : razon });
  } finally {
    if (tengo) {
      try {
        fs.unlinkSync(lock);
      } catch {
        // on purpose: if the lock is already gone, nobody needs it
      }
    }
  }
}
