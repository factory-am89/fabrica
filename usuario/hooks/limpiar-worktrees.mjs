/**
 * limpiar-worktrees.mjs — borra los worktrees cuya rama ya está mergeada.
 *
 * Por qué: cada worktree es una copia entera del repo, y en OneDrive cada
 * lectura de los tests se multiplica (OneDrive la sincroniza y el antivirus la
 * vuelve a escanear). Un worktree mergeado no aporta nada y pesa en disco y en
 * memoria. Pablo (8 oct 2026): «worktree mergeado, se borra al toque».
 *
 * Qué borra: un worktree (nunca el principal) cuya rama
 *   - se subió alguna vez a GitHub con su nombre (`git push -u`), y
 *   - está contenida en origin/staging o en origin/main, o tiene la rama
 *     remota borrada tras un merge (GitHub la borra al mergear),
 * y que además está LIMPIO (sin cambios sin commitear ni commits sin subir).
 * Un worktree sucio no se toca: se avisa, porque puede ser trabajo de otra sesión.
 *
 * Lo de «se subió alguna vez»: una rama recién creada desde staging, sin
 * commits, también está «contenida en staging». El 8 oct 2026 esto borraba la
 * carpeta nueva de cualquier sesión en cuanto otra arrancaba o fusionaba. Los
 * desconectados (detached) tampoco se borran solos, por lo mismo.
 *
 * Ojo con node_modules: en muchos worktrees es una unión (junction) a otro
 * worktree. Se quita la unión ANTES de borrar el worktree; si no, borrar
 * recursivamente podría vaciar la carpeta de destino.
 *
 *   node usuario/hooks/limpiar-worktrees.mjs            # ensayo: dice qué borraría
 *   node usuario/hooks/limpiar-worktrees.mjs --si       # borra
 *   node usuario/hooks/limpiar-worktrees.mjs --si --silencio   # al empezar sesión
 *   node usuario/hooks/limpiar-worktrees.mjs --hook            # tras un `gh pr merge`
 *
 * Lo que NO pudo borrar se dice siempre, también con --silencio (#141: dejaba
 * carpetas a medias y, como al arrancar va en silencio, nadie se enteraba). Lo
 * imprime y además lo apunta en la carpeta común de git
 * (`.git/claude-limpieza.json`); el arranque de la sesión (arranque.mjs) lo
 * enseña mientras la carpeta siga en disco.
 *
 * Carpetas sin registro (#725): si git quita el worktree de su lista y la
 * carpeta no se borra, ya no se recorrería nunca. Cada pasada termina de
 * borrar lo apuntado en ese registro que ya no es un worktree vivo (con
 * reintentos y soltando antes la unión de node_modules), guarda el error real
 * de git en el motivo y no toca nada con un `.git` de carpeta.
 *
 * Dónde está enganchado: el hook de Claude Code en el settings.json de usuario
 * de cada máquina (PostToolUse tras un merge, y SessionStart para lo que se
 * mergeó desde la web), que llama a una copia de este fichero en
 * ~/.claude/hooks/. La fuente está versionada en usuario/hooks/ de Fábrica; tras
 * cambiarla, `node scripts/install-pc.mjs instalar` la copia allí. En un repo con ficha
 * (.fabrica.json) no hace nada: ese repo trae y limpia en su propio arranque.
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync, renameSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Cuánto del mensaje de git se copia a un aviso (LARGO_ERROR) o al motivo guardado en el registro (LARGO_MOTIVO).
const LARGO_ERROR = 200;
const LARGO_MOTIVO = 300;

/**
 * ¿Está terminada la rama de este worktree? Pura, para poder probarla.
 * `subida`: tiene upstream con su propio nombre. `contenida`: es ancestro de
 * origin/staging o origin/main. `remotaBorrada`: tuvo remota y ya no está.
 * `sinSubir`: commits que no están en ninguna remota.
 */
export function terminada({ rama, subida, contenida, remotaBorrada, sinSubir }) {
  if (!rama || !subida) return false;
  return Boolean(contenida || (remotaBorrada && !sinSubir));
}

// ── Lo que no se pudo borrar (#141) ────────────────────────────────────────
// Un registro en la carpeta común de git, que comparten todos los worktrees y
// que git no versiona (como el de sesiones).
export const ficheroPendientes = (comun) => join(comun, "claude-limpieza.json");

/** Rutas comparables en Windows y en Linux: barras, mayúsculas y la barra final. */
export const normaRuta = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** Las rutas de los worktrees que git tiene hoy, de `git worktree list --porcelain`. */
export function worktreesVivos(porcelana) {
  return new Set(
    String(porcelana ?? "")
      .split(/\r?\n/)
      .filter((l) => l.startsWith("worktree "))
      .map((l) => normaRuta(l.slice("worktree ".length))),
  );
}

/** El registro, o [] si no hay. Si está corrupto, lanza: quien lo lee avisa. */
export function leerPendientes(comun) {
  const f = ficheroPendientes(comun);
  if (!existsSync(f)) return [];
  const lista = JSON.parse(readFileSync(f, "utf8"));
  if (!Array.isArray(lista)) throw new Error("el registro no es una lista");
  return lista;
}

/**
 * Una entrada sigue pendiente si la carpeta sigue en disco y NO es hoy un
 * worktree de git. Lo segundo importa: si Pablo la borró a mano y `npm run
 * tarea` creó otra en la misma ruta, el aviso mandaría borrar un worktree vivo.
 * (Un remove que falló sin tocar nada deja el worktree en la lista: no se
 * apunta, pero la próxima limpieza lo reintenta y lo vuelve a decir.)
 */
const sigue = (p, existe, vivos) => existe(p.dir) && !vivos.has(normaRuta(p.dir));

/**
 * Junta lo que quedaba pendiente con lo nuevo de esta pasada. Se queda solo lo
 * que sigue pendiente; si una carpeta sale dos veces, vale la nueva.
 */
export function fusionarPendientes(previos, nuevos, existe, vivos = new Set()) {
  const porCarpeta = new Map();
  for (const p of [...previos, ...nuevos]) porCarpeta.set(normaRuta(p.dir), p);
  return [...porCarpeta.values()].filter((p) => sigue(p, existe, vivos));
}

/**
 * Apunta lo nuevo en el registro. Dos limpiezas pueden correr a la vez (dos
 * sesiones que arrancan): se vuelve a leer justo antes de escribir y se escribe
 * a un temporal que luego se renombra, para que nadie lea un fichero a medias.
 * Si el registro estaba corrupto, se reescribe: devuelve `corrupto` con el
 * error para que quien llama lo diga.
 */
export function guardarPendientes(comun, nuevos, { existe = existsSync, vivos = new Set() } = {}) {
  let previos = [];
  let corrupto = null;
  try {
    previos = leerPendientes(comun);
  } catch (e) {
    corrupto = String(e?.message ?? e);
  }
  const pendientes = fusionarPendientes(previos, nuevos, existe, vivos);
  const f = ficheroPendientes(comun);
  if (pendientes.length || previos.length || corrupto || existsSync(f)) {
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(pendientes, null, 2));
    renameSync(tmp, f);
  }
  return { pendientes, corrupto };
}

/**
 * Apunta lo que no se pudo borrar. `listar` da `git worktree list --porcelain` y
 * puede lanzar: sin esa lista no se apunta nada y se dice, porque un Set vacío
 * apuntaría como pendiente un worktree vivo y el arranque mandaría borrarlo.
 * Devuelve true si apuntó.
 */
export function apuntarPendientes(comun, problemas, listar, { avisar = console.error } = {}) {
  let vivos;
  try {
    vivos = worktreesVivos(listar());
  } catch (e) {
    avisar(`⚠ limpiar-worktrees: no pude listar los worktrees (${String(e?.message ?? e).slice(0, LARGO_ERROR)}); no apunto lo pendiente.`);
    return false;
  }
  try {
    const { corrupto } = guardarPendientes(comun, problemas, { existe: existsSync, vivos });
    if (corrupto) avisar(`⚠ limpiar-worktrees: ${ficheroPendientes(comun)} estaba corrupto (${corrupto}); lo he reescrito.`);
  } catch (e) {
    avisar(`⚠ limpiar-worktrees: no he podido apuntar lo pendiente (${e.message}).`);
    return false;
  }
  return true;
}

/**
 * ¿Quedó algo tras intentar borrar? Se mira el disco, no lo que dice git: git
 * puede quitar el worktree de su lista y dejar la carpeta (un fichero
 * bloqueado, rutas largas en node_modules), y el `worktree prune` del final
 * borra la entrada aunque el remove fallara. Eso fue #141.
 */
export function problemaDelBorrado({ dir, rama, quitado, sigue, detalle }, ahora = new Date()) {
  if (!sigue) return null;
  const base = quitado ? "git la quitó de su lista, pero la carpeta sigue en disco" : "falló `git worktree remove`";
  return {
    dir,
    rama,
    // El error real de git (o del borrado) va en el motivo: sin él, la causa solo se sabía reproduciendo (#725).
    motivo: detalle ? `${base}: ${String(detalle).trim().split(/\r?\n/)[0].slice(0, LARGO_MOTIVO)}` : base,
    cuando: ahora.toISOString(),
  };
}

/**
 * Quita node_modules si es una unión o un enlace, sin tocar su destino. Si es
 * una carpeta de verdad no hace nada. Devuelve true si quitó una unión.
 * En Windows una junction se quita con rmdir (no recursivo); en otros, unlink.
 * Si no se sabe si es una unión (un error de readlink que no es EINVAL), lanza:
 * borrar en recursivo a ciegas podría vaciar el destino.
 */
export function soltarUnion(dir) {
  const nm = join(dir, "node_modules");
  let st;
  try {
    st = lstatSync(nm);
  } catch (e) {
    if (e?.code === "ENOENT") return false; // sin node_modules no hay unión que soltar; otro error (EACCES, EBUSY) sube
    throw e;
  }
  const esUnion = st.isSymbolicLink() || leerUnion(nm) !== null;
  if (!esUnion) return false;
  try {
    rmdirSync(nm);
  } catch {
    unlinkSync(nm); // a propósito: fuera de Windows el enlace se quita con unlink; si también falla, su error sube
  }
  return true;
}

/**
 * El destino de una unión o enlace, o null si `ruta` no existe (ENOENT) o no es
 * un enlace (EINVAL, lo que da readlink en una carpeta o un fichero normal).
 * Cualquier otro error (EACCES, EBUSY) sube: no se sabe si es una unión.
 */
export function leerUnion(ruta, leer = readlinkSync) {
  try {
    return leer(ruta);
  } catch (e) {
    if (e?.code === "ENOENT" || e?.code === "EINVAL") return null;
    throw e;
  }
}

/**
 * Una pregunta a git: su salida, o null si git dijo «no» saliendo con 1 (una
 * ref que no existe con `rev-parse --verify --quiet`, una clave de `config` sin
 * valor, `merge-base --is-ancestor` que no lo es). Otro fallo (128, git que no
 * está) sube: no se toma por un «no».
 */
export function siNo(preguntar) {
  try {
    return preguntar();
  } catch (e) {
    if (e?.status === 1) return null;
    throw e;
  }
}

/** ¿Tiene un `.git` que es una CARPETA? Es un clon con su propia historia, no un worktree (p. ej. MenuPlan-panel-lectura). */
export function tieneGitPropio(dir) {
  try {
    return lstatSync(join(dir, ".git")).isDirectory();
  } catch (e) {
    if (e?.code === "ENOENT") return false; // sin .git no es un clon; cualquier otro error (EACCES, EBUSY) sube: no se adivina
    throw e;
  }
}

/**
 * Termina de borrar una carpeta que quedó sin registro de git (#725): suelta
 * antes la unión de node_modules (borrar en recursivo a través de ella vaciaría
 * el destino, 8 oct 2026), borra con reintentos (Windows suelta tarde un
 * fichero en uso) y nunca toca una carpeta con `.git` de carpeta. Si el
 * proceso tiene dentro su directorio de trabajo, el borrado falla en Windows:
 * quien llama debe haber hecho antes `process.chdir` a la raíz del repo.
 * Devuelve { ok, motivo? }.
 */
export function terminarCarpeta(dir, { reintentos = 5, espera = 200 } = {}) {
  if (!existsSync(dir)) return { ok: true };
  try {
    if (tieneGitPropio(dir)) return { ok: false, motivo: "tiene un .git de carpeta (un clon, no un worktree): no se toca" };
    soltarUnion(dir);
    rmSync(dir, { recursive: true, force: true, maxRetries: reintentos, retryDelay: espera });
  } catch (e) {
    return { ok: false, motivo: `no pude borrar la carpeta: ${String(e?.code ?? "")} ${String(e?.message ?? e).split("\n")[0]}`.trim() };
  }
  return existsSync(dir) ? { ok: false, motivo: "la carpeta sigue en disco tras borrarla" } : { ok: true };
}

/**
 * Qué entradas del registro se pueden terminar de borrar: la carpeta existe,
 * ya no es un worktree vivo, cuelga del mismo directorio que el repo y se llama
 * `MenuPlan-…`. Es la barrera contra borrar nada que no sea una carpeta de
 * trabajo de MenuPlan. Pura.
 */
export function porTerminar(pendientes, { raiz, existe = existsSync, vivos = new Set() }) {
  const padre = normaRuta(dirname(raiz));
  return pendientes.filter(
    (p) =>
      p?.dir &&
      existe(p.dir) &&
      !vivos.has(normaRuta(p.dir)) &&
      normaRuta(dirname(p.dir)) === padre &&
      /^MenuPlan-/i.test(basename(p.dir)) &&
      normaRuta(p.dir) !== normaRuta(raiz),
  );
}

/**
 * Lo que se imprime de lo que no se pudo borrar. No depende de --silencio: se
 * dice siempre. Tras un merge (PostToolUse, `hook`), lo que se imprime sin más
 * no llega a la sesión y va como contexto adicional; al arrancar
 * (SessionStart), el texto llano sí llega.
 */
export function salidaDeProblemas(problemas, { hook = false } = {}) {
  if (!problemas.length) return "";
  const texto = problemas.map((p) => `⚠ no pude borrar ${p.dir} (${p.rama}): ${p.motivo}`).join("\n");
  if (hook) return JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: texto } });
  return `${texto}\n`;
}

/** Las líneas de aviso para el arranque, una por carpeta que sigue pendiente. */
export function avisosDeLimpieza(pendientes, existe = existsSync, vivos = new Set()) {
  return pendientes
    .filter((p) => sigue(p, existe, vivos))
    .map(
      (p) =>
        `AVISO: la limpieza de carpetas no pudo borrar ${p.dir}${p.rama ? ` (${p.rama})` : ""}: ${p.motivo}. ` +
        "La borra Pablo (con `!`), tras mirar que su node_modules no es una unión; si lo es, se quita antes la unión.",
    );
}

const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (esPrincipal) {
  // --hook: lo llama Claude Code (PostToolUse de Bash/PowerShell). Lee la llamada
  // por stdin y solo actúa si el comando era un merge de PR; borra en silencio.
  const HOOK = process.argv.includes("--hook");
  if (HOOK) {
    let entrada = "";
    for await (const trozo of process.stdin) entrada += trozo;
    let comando = "";
    try {
      comando = JSON.parse(entrada)?.tool_input?.command ?? "";
    } catch (e) {
      console.error(`⚠ limpiar-worktrees: no entiendo la entrada del hook (${String(e?.message ?? e).slice(0, LARGO_ERROR)}); no limpio nada.`);
      process.exit(0);
    }
    if (!/\bgh\s+pr\s+merge\b|\bgit\s+(merge|pull)\b/.test(comando)) process.exit(0);
  }
  const SI = HOOK || process.argv.includes("--si");
  const SILENCIO = HOOK || process.argv.includes("--silencio");
  const log = (...a) => { if (!SILENCIO) console.log(...a); };

  const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  // Una pregunta a git cuyo «no» es salir con 1 (ref que no existe, clave sin valor, no es antecesor).
  const pregunta = (args, cwd = raiz) => siNo(() => git(args, cwd));
  const problemas = [];
  // Borrar la rama de un worktree ya quitado: si la rama existe y git no la borra, se dice (también con --silencio).
  const borrarRama = (rama, opcion) => {
    if (pregunta(["rev-parse", "--verify", "--quiet", `refs/heads/${rama}`], process.cwd()) === null) return;
    try {
      git(["branch", opcion, rama], process.cwd());
    } catch (e) {
      console.error(`⚠ limpiar-worktrees: no pude borrar la rama ${rama}: ${String(e?.message ?? e).slice(0, LARGO_ERROR)}`);
    }
  };

  // El hook es de usuario (vale en cualquier carpeta): fuera de un repo, nada.
  // Cualquier otro fallo de git (no está, está roto) se dice.
  let comun;
  try {
    comun = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], process.cwd());
  } catch (e) {
    if (/not a git repository/i.test(String(e?.stderr ?? ""))) process.exit(0);
    console.error(`⚠ limpiar-worktrees: git rev-parse falló (${String(e?.stderr || e?.message || e).slice(0, LARGO_ERROR)}); no limpio nada.`);
    process.exit(0);
  }
  const raiz = comun.replace(/[\\/]\.git$/, "");
  // Este proceso no puede tener dentro la carpeta que va a borrar: en el hook
  // hereda el directorio de la sesión que acaba de fusionar, y en Windows eso
  // bloquea el borrado (#725). Se mueve a la raíz del repo antes de nada.
  process.chdir(raiz);
  // Un repo con ficha (.fabrica.json) ya trae y limpia en su propio arranque (al-dia y limpiar de
  // scripts/al-arrancar.mjs): aquí no se toca git, para no pisar su FETCH_HEAD ni sus refs (#147).
  if (existsSync(join(raiz, ".fabrica.json"))) process.exit(0);
  // Un fetch fallido se dice (también con --silencio): sin él, `origin/main` queda viejo y nadie se entera.
  try {
    git(["fetch", "-q", "--prune", "origin"], raiz);
  } catch (e) {
    console.error(`⚠ limpiar-worktrees: git fetch --prune origin falló (${String(e?.message ?? e).slice(0, LARGO_ERROR)}); sigo con lo que hay en local.`);
  }

  // git worktree list --porcelain: bloques separados por línea vacía.
  const bloques = git(["worktree", "list", "--porcelain"], raiz).split(/\r?\n\r?\n/).map((b) => {
    const o = {};
    for (const l of b.split(/\r?\n/)) {
      const [k, ...v] = l.split(" ");
      o[k] = v.join(" ") || true;
    }
    return o;
  });
  const principal = resolve(bloques[0].worktree);
  const objetivos = ["origin/staging", "origin/main"].filter((r) => pregunta(["rev-parse", "--verify", "--quiet", r]) !== null);

  const contenidaEn = (rama) =>
    objetivos.some((o) => pregunta(["merge-base", "--is-ancestor", rama, o]) !== null);
  const subidaConSuNombre = (rama) =>
    pregunta(["config", `branch.${rama}.merge`]) === `refs/heads/${rama}`;
  const remotaBorradaDe = (rama) =>
    Boolean(pregunta(["config", `branch.${rama}.remote`])) &&
    pregunta(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${rama}`]) === null;

  // Worktrees que prestan su node_modules a otros por una unión: no se borran
  // mientras alguien cuelgue de ellos.
  // Si no se puede leer una de esas uniones no se sabe a quién presta: no se borra ningún worktree en esta pasada.
  const anfitriones = new Set();
  let sinAnfitriones = null;
  for (const w of bloques) {
    const nm = join(resolve(w.worktree), "node_modules");
    try {
      const destino = leerUnion(nm);
      if (destino) anfitriones.add(resolve(destino, "..").toLowerCase());
    } catch (e) {
      sinAnfitriones = `no pude leer ${nm} (${String(e?.code ?? e?.message ?? e)})`;
    }
  }
  if (sinAnfitriones) console.error(`⚠ limpiar-worktrees: ${sinAnfitriones}; no borro ningún worktree en esta pasada.`);

  let borrados = 0;
  for (const w of sinAnfitriones ? [] : bloques.slice(1)) {
    const dir = resolve(w.worktree);
    if (dir === principal || !existsSync(dir)) continue;
    // Los de un scratchpad (AppData\Local\Temp\claude\…) son de una sesión que
    // puede estar usándolos ahora mismo para comparar: no se tocan.
    if (/[\\/]AppData[\\/]Local[\\/]Temp[\\/]/i.test(dir)) continue;
    const rama = typeof w.branch === "string" ? w.branch.replace("refs/heads/", "") : null;
    // Si git falla al decidir, ese worktree se deja y se dice: no se borra a ciegas.
    let lista;
    let sucio;
    try {
      lista = rama && terminada({
        rama,
        subida: subidaConSuNombre(rama),
        contenida: contenidaEn(rama),
        remotaBorrada: remotaBorradaDe(rama),
        sinSubir: git(["log", "--oneline", rama, "--not", "--remotes"], raiz),
      });
      if (lista) sucio = git(["status", "--porcelain"], dir);
    } catch (e) {
      console.error(`⚠ limpiar-worktrees: dejo ${dir}: git falló al mirarlo (${String(e?.stderr || e?.message || e).slice(0, LARGO_ERROR)}).`);
      continue;
    }
    if (!lista) continue;
    if (anfitriones.has(dir.toLowerCase())) {
      log(`· dejo ${dir}: otros worktrees usan su node_modules`);
      continue;
    }
    // El snapshot que vitest reescribe solo por fin de línea no cuenta como trabajo.
    const cambios = sucio.split(/\r?\n/).filter((l) => l && !/fichas\.test\.js\.snap$/.test(l));
    if (cambios.length) {
      log(`· dejo ${dir} (${rama}): tiene cambios sin guardar`);
      continue;
    }
    log(`${SI ? "✓ borro" : "· borraría"} ${dir} (${rama})`);
    if (!SI) continue;
    // Sin saber si node_modules es una unión no se borra: en recursivo podría vaciar el destino.
    try {
      soltarUnion(dir);
    } catch (e) {
      problemas.push({ dir, rama, motivo: `no sé si su node_modules es una unión: ${String(e?.code ?? "")} ${String(e?.message ?? e).split("\n")[0]}`.trim(), cuando: new Date().toISOString() });
      continue;
    }
    // Si falla no se para: `worktree remove --force` borra igual, y si no puede, su error va a `problemas`.
    try {
      git(["checkout", "--", "."], dir);
    } catch (e) {
      console.error(`⚠ limpiar-worktrees: git checkout en ${dir} falló (${String(e?.message ?? e).slice(0, LARGO_ERROR)}); sigo con el borrado.`);
    }
    // El error de git se guarda (antes iba a `ignore` y el motivo era genérico).
    let errorGit = "";
    let quitado = false;
    try {
      git(["worktree", "remove", "--force", dir], raiz);
      quitado = true;
    } catch (e) {
      errorGit = String(e?.stderr || e?.message || ""); // va a `problemas` por problemaDelBorrado
    }
    const problema = problemaDelBorrado({ dir, rama, quitado, sigue: existsSync(dir), detalle: errorGit });
    if (problema) problemas.push(problema);
    else {
      borrados++;
      borrarRama(rama, "-D");
    }
  }
  // Aquí un error es un fallo, no un «no» de git: se dice.
  try {
    git(["worktree", "prune"], raiz);
  } catch (e) {
    console.error(`⚠ limpiar-worktrees: git worktree prune falló (${String(e?.message ?? e).slice(0, LARGO_ERROR)}).`);
  }

  // Lo que una pasada anterior dejó apuntado y ya no es un worktree vivo se
  // termina de borrar ahora (#725): sin esto, una carpeta sin registro no volvía
  // a entrar nunca, porque arriba solo se recorren los worktrees que git lista.
  let rematadas = 0;
  {
    // Sin la lista de worktrees vivos no se remata nada: un Set vacío haría pasar por muerto un worktree vivo.
    let vivosAhora = null;
    try {
      vivosAhora = worktreesVivos(git(["worktree", "list", "--porcelain"], raiz));
    } catch (e) {
      console.error(`⚠ limpiar-worktrees: no pude listar los worktrees (${String(e?.message ?? e).slice(0, LARGO_ERROR)}); no remato nada.`);
    }
    let previos = [];
    try {
      previos = leerPendientes(comun);
    } catch (e) {
      console.error(`⚠ limpiar-worktrees: no pude leer lo pendiente para rematarlo (${e.message}).`);
    }
    for (const p of vivosAhora ? porTerminar(previos, { raiz: principal, vivos: vivosAhora }) : []) {
      log(`${SI ? "✓ remato" : "· remataría"} ${p.dir}${p.rama ? ` (${p.rama})` : ""}`);
      if (!SI) continue;
      const r = terminarCarpeta(p.dir);
      if (r.ok) {
        rematadas++;
        // Solo se fuerza si la rama ya está en staging/main; si no, `-d`, que git rechaza si hay commits sin fusionar.
        if (p.rama) borrarRama(p.rama, contenidaEn(p.rama) ? "-D" : "-d");
      } else if (!problemas.some((x) => normaRuta(x.dir) === normaRuta(p.dir))) {
        problemas.push({ ...p, motivo: r.motivo, cuando: new Date().toISOString() });
      }
    }
  }
  if (rematadas) log(`${rematadas} carpetas pendientes rematadas.`);
  log(SI ? `${borrados} worktrees borrados.` : "Ensayo: repite con --si para borrar.");

  // Lo que no se pudo borrar se dice SIEMPRE, también en silencio, y se apunta
  // para que el arranque lo siga enseñando mientras la carpeta exista.
  // Los vivos se leen DESPUÉS del prune: una ruta que hoy es worktree no se apunta.
  apuntarPendientes(comun, problemas, () => git(["worktree", "list", "--porcelain"], raiz));
  process.stdout.write(salidaDeProblemas(problemas, { hook: HOOK }));
}
