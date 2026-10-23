// El arranque entero: las órdenes SessionStart de .claude/settings.json (proyecto) y de usuario/settings.json (usuario)
// se lanzan a la vez, con cwd en un clon temporal con .fabrica.json, 10 rondas con un commit nuevo en el remoto.
// Exige 0 fallos y la principal en la punta del remoto. Sin red, sin token: remoto bare local, todo en carpetas temporales.
// Un hook de arranque que no está en CLASIFICADAS pone el test en rojo: nadie añade un hook de arranque sin que entre aquí.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOMBRE_FICHA } from '../scripts/lib/repo-card.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Dentro del repo y no en AppData/Local/Temp: limpiar-worktrees se salta lo que cuelga de Temp. El prefijo está en
// .gitignore y invariants.test.js salta lo que empieza por .tmp; solo se borra lo que el test creó.
const PREFIJO = '.tmp-arranque-a-la-vez-';
const RONDAS = 10;
const bases = [];
after(() => { for (const b of bases) rmSync(b, { recursive: true, force: true }); });
const leerJson = (...partes) => JSON.parse(readFileSync(path.join(RAIZ, ...partes), 'utf8'));

// Lista cerrada: la orden tal como está en el settings (con sus {{home}} y $CLAUDE_PROJECT_DIR) -> argumentos que
// la dejan sin red ni token. al-arrancar solo con su paso al-dia (limpiar y periodico piden GitHub); el resto, tal cual.
const CLASIFICADAS = new Map([
  ['node "$CLAUDE_PROJECT_DIR/scripts/al-arrancar.mjs"', ['--solo', 'al-dia']],
  ['node "{{home}}/.claude/hooks/limpiar-worktrees.mjs" --si --silencio', []],
]);

const ordenesDe = (settings) => (settings.hooks?.SessionStart ?? []).flatMap((g) => g.hooks.map((h) => h.command));

// «node "ruta" arg arg» -> argumentos de node. Un trozo entre comillas dobles es uno solo.
const trozos = (orden) => [...orden.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);

function aLanzar(ordenes) {
  return ordenes.map((orden) => {
    if (!CLASIFICADAS.has(orden)) throw new Error(`hook de arranque sin clasificar: ${orden}`);
    const [bin, ...resto] = trozos(orden);
    assert.equal(bin, 'node', orden);
    return { orden, args: [...resto, ...CLASIFICADAS.get(orden)] };
  });
}

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commit = (cwd, fichero, texto) => {
  writeFileSync(path.join(cwd, fichero), texto);
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', `${fichero} ${texto}`);
};

// Remoto bare, un clon que publica y una principal con ficha que se queda atrás. `casa` lleva copiados los hooks de usuario.
function montar() {
  const base = mkdtempSync(path.join(RAIZ, PREFIJO));
  bases.push(base);
  const remoto = path.join(base, 'remoto.git');
  const otro = path.join(base, 'otro');
  const principal = path.join(base, 'principal');
  const casa = path.join(base, 'casa');
  git(base, 'init', '-q', '--bare', '-b', 'main', remoto);
  git(base, 'clone', '-q', remoto, otro);
  git(otro, 'checkout', '-q', '-b', 'main');
  writeFileSync(path.join(otro, NOMBRE_FICHA), '{}');
  commit(otro, 'a.txt', 'a');
  git(otro, 'push', '-q', '-u', 'origin', 'main');
  git(base, 'clone', '-q', remoto, principal);
  mkdirSync(path.join(casa, '.claude'), { recursive: true });
  cpSync(path.join(RAIZ, 'usuario', 'hooks'), path.join(casa, '.claude', 'hooks'), { recursive: true });
  return { otro, principal, casa };
}

// Lanza una orden y espera a que acabe; un fallo es salida distinta de 0, algo en stderr o un «FALLÓ» en stdout.
const lanzar = ({ orden, args }, cwd, env) => new Promise((resolver) => {
  const p = spawn(process.execPath, args, { cwd, env });
  p.stdin.end(); // el arranque real da el JSON del gancho por stdin y lo cierra; sin cerrar, al-arrancar espera para siempre
  let out = '';
  let err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('close', (status) => {
    const fallo = status !== 0 || err.trim() !== '' || /FALLÓ/.test(out);
    resolver({ orden, fallo, detalle: fallo ? `${orden}: status ${status}; stdout ${out.trim()}; stderr ${err.trim()}` : '' });
  });
});

test('una orden SessionStart que no está clasificada pone el test en rojo', () => {
  assert.throws(() => aLanzar(['node "$CLAUDE_PROJECT_DIR/scripts/nuevo.mjs"']), /^Error: hook de arranque sin clasificar: node "\$CLAUDE_PROJECT_DIR\/scripts\/nuevo\.mjs"$/);
});

test('toda orden SessionStart de proyecto y de usuario está clasificada, y la lista no tiene órdenes que ya no existen', () => {
  const ordenes = [...ordenesDe(leerJson('.claude', 'settings.json')), ...ordenesDe(leerJson('usuario', 'settings.json'))];
  assert.ok(ordenes.length > 0);
  assert.equal(aLanzar(ordenes).length, ordenes.length);
  assert.deepEqual([...CLASIFICADAS.keys()].sort(), [...ordenes].sort());
});

test(`el arranque entero a la vez, ${RONDAS} rondas con un commit nuevo en el remoto: 0 fallos y la principal en la punta`, async () => {
  const ordenes = [...ordenesDe(leerJson('.claude', 'settings.json')), ...ordenesDe(leerJson('usuario', 'settings.json'))];
  const { otro, principal, casa } = montar();
  const sustituir = (l) => ({ ...l, args: l.args.map((a) => a.replaceAll('{{home}}', casa.replaceAll('\\', '/')).replaceAll('$CLAUDE_PROJECT_DIR', RAIZ.replaceAll('\\', '/'))) });
  const lanzamientos = aLanzar(ordenes).map(sustituir);
  const env = { ...process.env, HOME: casa, USERPROFILE: casa, CLAUDE_PROJECT_DIR: RAIZ };
  const fallos = [];
  for (let ronda = 1; ronda <= RONDAS; ronda++) {
    commit(otro, 'a.txt', `ronda ${ronda}`);
    git(otro, 'push', '-q', 'origin', 'main');
    const resultados = await Promise.all(lanzamientos.map((l) => lanzar(l, principal, env)));
    for (const r of resultados) if (r.fallo) fallos.push(`ronda ${ronda}: ${r.detalle}`);
    if (git(principal, 'rev-parse', 'HEAD') !== git(otro, 'rev-parse', 'HEAD')) fallos.push(`ronda ${ronda}: la principal no está en la punta del remoto`);
  }
  assert.deepEqual(fallos, [], `${fallos.length} fallos en ${RONDAS} rondas`);
});
