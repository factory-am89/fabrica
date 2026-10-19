// One door to 1Password and to the Windows credential vault. Every `op` quota spent on 2026-10-16 came from
// code that opened the door from a place nobody was counting. This module lists who may open it (PUERTAS)
// and finds who does (escanear); test/op-door.test.js fails when the two differ.
// Paths are relative to the repo root, with `/`.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const PUERTAS = {
  // Code that really reads: it may spawn `op` or open the vault. Closed list; adding one needs a reason here.
  lectores: {
    'scripts/token.mjs': 'the only runtime reader of the App key (op) and of the service-account token (vault); it has the cache and the read budget',
    'apps/arranque.ps1': 'run by hand by Pablo: creates the vault, the service account and stores the key (op)',
    'apps/lib-gh.ps1': 'run by hand by Pablo, library of arranque.ps1: stores and reads the service-account token in the Windows vault',
    'apps/convertir.mjs': 'run by hand by Pablo: stores the .pem the App manifest returns (op document create)',
  },
  // Tests that exercise the door itself. They must inject a fake `op`/vault or read a resource that cannot exist.
  // A new test that needs the door is a conscious addition here, not an accident.
  pruebas: {
    'test/token-git.test.js': 'reads a vault entry that cannot exist, to see the failure path',
    'test/lib-gh.probe.ps1': 'reads a vault entry that cannot exist, to see the failure path of lib-gh.ps1',
    'test/token-service.test.js': 'tokenServicio with an injected vault',
    'test/token-cache.test.js': 'obtenerToken/clavePrivada with an injected op and a service-account token in the env',
    'test/op-log.test.js': 'clavePrivada with an injected op and read log',
    'test/read-budget.test.js': 'clavePrivada with an injected op and read log; the real process runs under the fake op preload',
    'scripts/lib/op-door.mjs': 'the guard itself: it spells out the names it looks for',
    'test/op-door.test.js': 'test of this guard: its fixtures are strings that spawn op on purpose',
  },
};

// Functions of token.mjs that end in a real `op` spawn or a vault read when not injected.
export const FUNCIONES_PUERTA = ['leerLlavero', 'tokenServicio', 'clavePrivada', 'ejecutarOp', 'obtenerToken', 'ordenLeerLlavero'];

const EXTENSIONES = {
  js: ['.js', '.mjs', '.cjs', '.ts', '.mts'],
  ps: ['.ps1', '.psm1'],
  sh: ['.sh', '.bash', '.cmd', '.bat', '.yml', '.yaml'],
};
const IGNORADOS = new Set(['node_modules', '.git', '.fabrica', 'fixtures']);

// ---- comment stripping: same length, so line numbers stay; an unterminated string or comment throws ----

// Whether a `/` at this point starts a regular expression (after an operator or a keyword) or divides.
function empiezaRegex(codigo) {
  const previo = codigo.trimEnd();
  if (previo === '') return true;
  if (/[(,=:[!&|?{};+\-*%<>~^]$/.test(previo)) return true;
  return /(?:^|[^\w$.])(?:return|typeof|case|in|of|delete|void|throw|new|else|do)$/.test(previo);
}

// With `blanquearCadenas`, the inside of strings and regexes is blanked too (same length): a skeleton of the code only.
export function quitarComentariosJs(texto, { blanquearCadenas = false } = {}) {
  let salida = '';
  let i = 0;
  const n = texto.length;
  const copiar = (hasta) => { salida += texto.slice(i, hasta); i = hasta; };
  const blanquear = (hasta) => { salida += texto.slice(i, hasta).replace(/[^\n]/g, ' '); i = hasta; };
  while (i < n) {
    const c = texto[i];
    const d = texto[i + 1];
    if (c === '/' && d === '/') {
      const fin = texto.indexOf('\n', i);
      blanquear(fin === -1 ? n : fin);
    } else if (c === '/' && d === '*') {
      const fin = texto.indexOf('*/', i + 2);
      if (fin === -1) throw new Error('unterminated block comment');
      blanquear(fin + 2);
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && texto[j] !== c) j += texto[j] === '\\' ? 2 : 1;
      if (j >= n) throw new Error(`unterminated string starting at offset ${i}`);
      (blanquearCadenas ? blanquear : copiar)(j + 1); // template `${...}` bodies are kept as part of the string: good enough to find calls
    } else if (c === '/' && empiezaRegex(salida)) {
      let j = i + 1;
      let clase = false;
      while (j < n && (clase || texto[j] !== '/') && texto[j] !== '\n') {
        if (texto[j] === '\\') j++;
        else if (texto[j] === '[') clase = true;
        else if (texto[j] === ']') clase = false;
        j++;
      }
      if (texto[j] !== '/') throw new Error(`unterminated regular expression starting at offset ${i}`);
      (blanquearCadenas ? blanquear : copiar)(j + 1);
    } else {
      copiar(i + 1);
    }
  }
  return salida;
}

// Shell / PowerShell / YAML: `#` starts a comment when it is outside quotes and at a word start; `<# #>` blocks too.
export function quitarComentariosShell(texto, { bloques = false } = {}) {
  let t = texto;
  if (bloques) t = t.replace(/<#[\s\S]*?#>/g, (m) => m.replace(/[^\n]/g, ' '));
  return t.split('\n').map((linea) => {
    let comilla = null;
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i];
      if (comilla) {
        if (c === comilla) comilla = null;
        else if (c === '`' && comilla === '"') i++;
      } else if (c === '"' || c === "'") {
        comilla = c;
      } else if (c === '#' && (i === 0 || /\s|[;&|(]/.test(linea[i - 1]))) {
        return linea.slice(0, i);
      }
    }
    return linea;
  }).join('\n');
}

// ---- the rules ----

// A string that is exactly `op` (not compared to: `x === 'op'` only tells it apart), or an exec of a string starting with `op `.
const OP_JS = [
  { regla: 'spawns-op', re: /(?<![!=]=\s{0,3})(['"`])op(?:\.exe)?\1/ },
  { regla: 'spawns-op', re: /\bexec(?:Sync)?\s*\(\s*['"`]op(?:\.exe)?\s/ },
];
// `op <something>` where a command may start: line start, after | ; & ( ` { or a leading `&`.
const OP_SHELL = [{ regla: 'spawns-op', re: /(?:^|[|;&({`]|\$\(|\brun:|\bthen|\bdo)\s*&?\s*op(?:\.exe)?\s+[a-z-]/i }];
const BOVEDA = [{ regla: 'opens-vault', re: /\bPasswordVault\b|\bRetrieve(?:Password|All)?\b/ }];
const FUNCIONES = [{ regla: 'uses-door-function', re: new RegExp(`\\b(?:${FUNCIONES_PUERTA.join('|')})\\b`) }];

export function tipoDe(ruta) {
  const base = ruta.split('/').pop();
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')).toLowerCase() : '';
  if (EXTENSIONES.js.includes(ext)) return 'js';
  if (EXTENSIONES.ps.includes(ext)) return 'ps';
  if (EXTENSIONES.sh.includes(ext) || (ext === '' && ruta.startsWith('.githooks/'))) return 'sh';
  return null;
}

// Findings in one file's text: [{ regla, linea, texto }]. Throws if the file cannot be read as code.
export function escanearTexto(ruta, texto) {
  const tipo = tipoDe(ruta);
  if (!tipo) return [];
  const codigo = tipo === 'js' ? quitarComentariosJs(texto) : quitarComentariosShell(texto, { bloques: tipo === 'ps' });
  const reglas = [...(tipo === 'js' ? OP_JS : OP_SHELL), ...BOVEDA, ...FUNCIONES];
  const originales = texto.split('\n');
  const hallazgos = [];
  codigo.split('\n').forEach((linea, i) => {
    for (const { regla, re } of reglas) {
      if (re.test(linea)) hallazgos.push({ regla, linea: i + 1, texto: (originales[i] ?? '').trim().slice(0, 120) });
    }
  });
  return hallazgos;
}

export function ficheros(raiz, dir = raiz, salida = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORADOS.has(e.name)) continue;
    const completa = join(dir, e.name);
    if (e.isDirectory()) ficheros(raiz, completa, salida);
    else salida.push(relative(raiz, completa).split('\\').join('/'));
  }
  return salida;
}

// package.json scripts are shell commands.
export function textoDeScripts(texto) {
  return Object.values(JSON.parse(texto).scripts ?? {}).join('\n');
}

// Every finding in the repo at `raiz` outside the allow-list: [{ fichero, regla, linea, texto }]. A file that is
// code but cannot be read as code is a finding too (rule `unreadable`): a scanner that skips it would be a false guard.
export function escanear(raiz, puertas = PUERTAS) {
  const permitidos = new Set([...Object.keys(puertas.lectores), ...Object.keys(puertas.pruebas)]);
  const salida = [];
  for (const fichero of ficheros(raiz)) {
    if (permitidos.has(fichero)) continue;
    const esPaquete = fichero === 'package.json';
    if (!esPaquete && !tipoDe(fichero)) continue;
    try {
      const crudo = readFileSync(join(raiz, fichero), 'utf8');
      const hallazgos = esPaquete ? escanearTexto('package.sh', textoDeScripts(crudo)) : escanearTexto(fichero, crudo);
      for (const h of hallazgos) salida.push({ fichero, ...h });
    } catch (e) {
      salida.push({ fichero, regla: 'unreadable', linea: 0, texto: e.message });
    }
  }
  return salida;
}
