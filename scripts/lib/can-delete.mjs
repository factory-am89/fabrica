// La regla «¿se puede borrar esta carpeta de trabajo?» y la consulta a GitHub que la alimenta.
// La usan retire.mjs (una carpeta, por nombre) y clean.mjs (todas); ninguna la repite.
import { lstatSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { gitOk, norm } from './folders.mjs';
import { REPO } from './repo.mjs';
import { TOKEN } from './identities.mjs';
import { ExitError } from './exit.mjs';

// Lanza una orden con token de App (token.mjs es la única puerta; gh a pelo no tiene sesión en este PC).
// `repo` (si se da) le dice a token.mjs para qué repo canjear el token (FABRICA_REPO).
export function conToken(token, orden, cwd, repo) {
  const env = repo ? { ...process.env, FABRICA_REPO: repo } : process.env;
  return spawnSync(process.execPath, [token, '--', ...orden], { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// Los PR fusionados por la punta de su rama: sha → número. Un PR cerrado sin fusionar no cuenta.
// Una sola consulta REST (los últimos 100 cerrados). Si GitHub no responde, lanza: fallar en alto.
// Con `base`, solo cuentan los fusionados en esa rama (uno fusionado en otra no está en la base).
export function prsFusionados(repo, token, cwd, base) {
  const r = conToken(token, ['gh', 'api', `repos/${repo}/pulls?state=closed&per_page=100`], cwd, repo);
  if (r.error || r.status !== 0) throw new ExitError('GH_FAILED', `GitHub no responde (${r.error?.message ?? r.stderr.trim().split('\n')[0]}); no se borra nada.`);
  let lista;
  try {
    lista = JSON.parse(r.stdout);
  } catch {
    throw new ExitError('GH_FAILED', 'GitHub no responde con una lista de PR legible; no se borra nada.');
  }
  if (!Array.isArray(lista)) throw new ExitError('GH_FAILED', 'GitHub no responde con una lista de PR; no se borra nada.');
  return new Map(lista.filter((p) => p.merged_at && p.head?.sha && (!base || p.base?.ref === base)).map((p) => [p.head.sha, p.number]));
}

// ¿Hay un PR fusionado con esta punta? Un commit posterior a la fusión no estaría en main.
export const prFusionado = (punta, { repo = REPO, token = TOKEN, cwd = process.cwd(), base } = {}) => prsFusionados(repo, token, cwd, base).has(punta);

const dentro = (hijo, padre) => {
  const rel = path.relative(norm(padre), norm(hijo));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// Las demás carpetas cuyo node_modules es una unión que acaba dentro de esta: borrarla se lo llevaría.
function dependientes(carpeta, todas) {
  const nombres = [];
  for (const w of todas) {
    if (norm(w.ruta) === norm(carpeta)) continue;
    const nm = path.join(w.ruta, 'node_modules');
    let destino;
    try {
      if (!lstatSync(nm).isSymbolicLink()) continue;
      destino = realpathSync(nm);
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw new Error(`no pude mirar ${nm}: ${e.message}`);
    }
    if (dentro(destino, carpeta)) nombres.push(path.basename(w.ruta));
  }
  return nombres;
}

// Por qué una carpeta NO se borra: { code, text } (code es una clave de EXIT, text el motivo para
// personas), o null si se puede. Lanza si no puede decidirlo.
// `fusionada(punta)` la pone quien llama: limpiar solo cree en un PR fusionado con esa punta (una
// rama recién creada es ancestro de main y no se puede borrar por eso); retirar, que se lanza por
// nombre y a propósito, acepta además la ascendencia.
export function motivoDeQuedarse(w, { todas, cwd, fusionada }) {
  if (!w.rama) return { code: 'DETACHED_HEAD', text: `${w.ruta} no tiene rama (cabeza suelta): decide a mano.` };
  if (dentro(cwd, w.ruta)) return { code: 'INSIDE_FOLDER', text: `Estás dentro de ${w.ruta}: sal de ella y vuelve a lanzarlo.` };
  const sucio = gitOk(['status', '--porcelain', '--', '.', ':(exclude)node_modules'], w.ruta);
  if (sucio) return { code: 'UNSAVED_CHANGES', text: `${w.ruta} tiene cambios sin guardar; no se borra:\n${sucio}` };
  if (!fusionada(gitOk(['rev-parse', w.rama], w.ruta))) {
    return { code: 'NOT_MERGED', text: `La rama ${w.rama} no está fusionada: ningún PR fusionado tiene la punta de esta rama (sin PR, o con commits tras la fusión).` };
  }
  const otras = dependientes(w.ruta, todas);
  if (otras.length > 0) return { code: 'NODE_MODULES_SHARED', text: `La unión de node_modules de ${otras.join(', ')} apunta aquí; borrarla se lo llevaría.` };
  return null;
}
