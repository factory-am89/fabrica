// La capa de usuario: instalar copia usuario/ a ~/.claude/, la segunda vez no cambia nada y
// un cambio a mano hace salir a comprobar-pc con 1 nombrando el fichero. Siempre con un HOME temporal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AmpliaPermisos, HUELLA, ORIGEN, comprobar, confirmarEnTerminal, instalar } from '../scripts/instalar-pc.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'instalar-pc.mjs');

const nuevoHome = () => mkdtempSync(path.join(tmpdir(), 'instalar-pc-'));
// Estos tests prueban la mecánica con un usuario/ que solo tiene el CLAUDE.md de verdad; el settings.json de verdad
// (plantilla con huecos) se prueba en usuario-settings.test.js, con valores inventados.
const SOLO_CLAUDE = mkdtempSync(path.join(tmpdir(), 'usuario-'));
cpSync(path.join(ORIGEN, 'CLAUDE.md'), path.join(SOLO_CLAUDE, 'CLAUDE.md'));
const pc = (home, orden) =>
  spawnSync('node', [SCRIPT, orden], { env: { ...process.env, FABRICA_HOME: home, FABRICA_USUARIO: SOLO_CLAUDE }, encoding: 'utf8' });
const claude = (home, ...r) => path.join(home, '.claude', ...r);

test('instalar copia CLAUDE.md y apunta la huella', () => {
  const home = nuevoHome();
  const r = pc(home, 'instalar');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(claude(home, 'CLAUDE.md'), 'utf8'), readFileSync(path.join(ORIGEN, 'CLAUDE.md'), 'utf8'));
  const huella = JSON.parse(readFileSync(claude(home, HUELLA), 'utf8'));
  assert.deepEqual(Object.keys(huella), ['CLAUDE.md']);
  assert.equal(pc(home, 'comprobar').status, 0);
});

test('la segunda vez no cambia nada', () => {
  const home = nuevoHome();
  pc(home, 'instalar');
  const ficheros = ['CLAUDE.md', HUELLA];
  const mtimes = () => Object.fromEntries(ficheros.map((f) => [f, statSync(claude(home, f)).mtimeMs]));
  const antes = mtimes();
  const r = pc(home, 'instalar');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /sin cambios/);
  assert.deepEqual(mtimes(), antes);
});

test('un cambio a mano en destino hace salir a comprobar con 1 y el nombre del fichero', () => {
  const home = nuevoHome();
  pc(home, 'instalar');
  writeFileSync(claude(home, 'CLAUDE.md'), '# tocado a mano\n');
  const r = pc(home, 'comprobar');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /CLAUDE\.md editado-a-mano/);
});

test('un fichero que falta se nombra, y reinstalar sobrescribe lo editado y lo deja igual', () => {
  const home = nuevoHome();
  const r0 = pc(home, 'comprobar');
  assert.equal(r0.status, 1);
  assert.match(r0.stderr, /CLAUDE\.md falta/);
  pc(home, 'instalar');
  writeFileSync(claude(home, 'CLAUDE.md'), 'a mano\n');
  const r = pc(home, 'instalar');
  assert.match(r.stdout, /CLAUDE\.md \(editado-a-mano\)/);
  assert.equal(pc(home, 'comprobar').status, 0);
});

test('instalar no escribe nada fuera de lo que hay en usuario/ y la huella (ni settings.json ni memorias)', () => {
  const home = nuevoHome();
  pc(home, 'instalar');
  assert.deepEqual(readdirSync(claude(home)).sort(), ['CLAUDE.md', HUELLA]);
  assert.equal(existsSync(claude(home, 'settings.json')), false);
});

test('el mecanismo sirve para subcarpetas (hooks/) cuando usuario/ las tenga', () => {
  const home = nuevoHome();
  const origen = mkdtempSync(path.join(tmpdir(), 'origen-pc-'));
  mkdirSync(path.join(origen, 'hooks'));
  writeFileSync(path.join(origen, 'hooks', 'h.mjs'), 'a\n');
  assert.deepEqual(instalar({ home, origen }).map((c) => c.fichero), ['hooks/h.mjs']);
  assert.deepEqual(comprobar({ home, origen }), []);
  writeFileSync(claude(home, 'hooks', 'h.mjs'), 'b\n');
  assert.deepEqual(comprobar({ home, origen }).map((c) => `${c.fichero} ${c.estado}`), ['hooks/h.mjs editado-a-mano']);
});

// --- settings.json: solo se aplica si NO amplía permisos (la regla de qué es ampliar, en ampliacion-settings.test.js) ---

const base = () => JSON.parse(readFileSync(path.join(RAIZ, 'test', 'fixtures', 'settings-base.json'), 'utf8'));
const ajustes = (home) => claude(home, 'settings.json');
const leer = (f) => JSON.parse(readFileSync(f, 'utf8'));
const tecleando = (palabra) => confirmarEnTerminal({ tty: true, leerLinea: () => palabra, escribir: () => {} });

// Un usuario/ temporal con el settings.json (y, si se pide, otro CLAUDE.md) que se indique.
function origenCon(settings, claudeMd) {
  const o = mkdtempSync(path.join(tmpdir(), 'usuario-'));
  cpSync(SOLO_CLAUDE, o, { recursive: true });
  writeFileSync(path.join(o, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
  if (claudeMd) writeFileSync(path.join(o, 'CLAUDE.md'), claudeMd);
  return o;
}
const pcCon = (home, origen, orden, ...extra) =>
  spawnSync('node', [SCRIPT, orden, ...extra], { env: { ...process.env, FABRICA_HOME: home, FABRICA_USUARIO: origen }, encoding: 'utf8' });

// Un PC ya instalado con el settings.json de prueba (la primera instalación es una ampliación: la confirma «Pablo»).
function pcInstalado() {
  const home = nuevoHome();
  instalar({ home, origen: origenCon(base()), confirmar: tecleando('AMPLIAR') });
  return home;
}

// Una ampliación (regla allow nueva) sobre un PC ya instalado, y lo que hay en destino antes de intentarla.
function ampliacionPendiente() {
  const home = pcInstalado();
  const nuevo = base();
  nuevo.permissions.allow.push('Bash(rm -rf *)');
  const origen = origenCon(nuevo, 'otro texto\n');
  const foto = () => ['settings.json', 'CLAUDE.md', HUELLA].map((f) => readFileSync(claude(home, f), 'utf8'));
  return { home, origen, foto, antes: foto() };
}

test('settings: una regla allow nueva hace salir a instalar con 1, la nombra y no escribe nada', () => {
  const { home, origen, foto, antes } = ampliacionPendiente();
  // También cambia CLAUDE.md: tampoco debe llegar, porque no se escribe NADA.
  const r = pcCon(home, origen, 'instalar');
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /regla allow nueva: Bash\(rm -rf \*\)/);
  assert.match(r.stderr, /Pablo/);
  assert.deepEqual(foto(), antes);
});

test('settings: --ampliar SIN terminal (como una sesión de Claude) sale con 1 y no escribe nada', () => {
  const { home, origen, foto, antes } = ampliacionPendiente();
  // spawnSync con stdio por tuberías: ni stdin ni stdout son una terminal, igual que en una sesión.
  const r = pcCon(home, origen, 'instalar', '--ampliar');
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /sin terminal interactiva/);
  assert.match(r.stderr, /Pablo/);
  assert.deepEqual(foto(), antes);
});

test('settings: con terminal y la confirmación correcta aplica la ampliación, tras mostrar la lista', () => {
  const { home, origen, foto, antes } = ampliacionPendiente();
  const salida = [];
  const confirmar = confirmarEnTerminal({ tty: true, leerLinea: () => ' AMPLIAR ', escribir: (t) => salida.push(t) });
  const cambios = instalar({ home, origen, confirmar });
  assert.ok(cambios.some((c) => c.fichero === 'settings.json'));
  assert.ok(leer(ajustes(home)).permissions.allow.includes('Bash(rm -rf *)'));
  assert.notDeepEqual(foto(), antes);
  assert.match(salida.join('\n'), /regla allow nueva: Bash\(rm -rf \*\)/);
});

test('settings: con terminal pero confirmación incorrecta, 1 y nada escrito', () => {
  for (const tecleado of ['', 'ampliar', 'si', 'AMPLIAR ya']) {
    const { home, origen, foto, antes } = ampliacionPendiente();
    assert.throws(
      () => instalar({ home, origen, confirmar: tecleando(tecleado) }),
      (e) => e instanceof AmpliaPermisos && /confirmación incorrecta/.test(e.message),
      tecleado,
    );
    assert.deepEqual(foto(), antes, tecleado);
  }
});

test('settings: sin terminal, la confirmación ni se lee y no se escribe nada', () => {
  const { home, origen, foto, antes } = ampliacionPendiente();
  const confirmar = confirmarEnTerminal({ tty: false, leerLinea: () => assert.fail('no debe leer'), escribir: () => {} });
  assert.throws(() => instalar({ home, origen, confirmar }), /sin terminal interactiva/);
  assert.deepEqual(foto(), antes);
});

test('settings: quitar una regla allow se aplica solo', () => {
  const home = pcInstalado();
  const nuevo = base();
  const quitada = nuevo.permissions.allow.pop();
  const r = pcCon(home, origenCon(nuevo), 'instalar');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /settings\.json \(desactualizado\)/);
  assert.equal(leer(ajustes(home)).permissions.allow.includes(quitada), false);
});

test('settings: una clave desconocida nueva exige AMPLIAR aunque sea otra cosa que permisos', () => {
  const home = pcInstalado();
  const nuevo = base();
  nuevo.statusLine = { type: 'command', command: 'node x.mjs' };
  const r = pcCon(home, origenCon(nuevo), 'instalar');
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /fuera de la lista cerrada cambiada: statusLine/);
});

test('settings: si es igual, sin cambios', () => {
  const home = pcInstalado();
  const r = pcCon(home, origenCon(base()), 'instalar');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /sin cambios/);
});

test('settings: comprobar incluye settings.json', () => {
  const home = pcInstalado();
  const origen = origenCon(base());
  assert.equal(pcCon(home, origen, 'comprobar').status, 0);
  writeFileSync(ajustes(home), '{}\n');
  const r = pcCon(home, origen, 'comprobar');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /settings\.json editado-a-mano/);
});

test('settings: un PC sin settings.json es una ampliación (lo instala Pablo) y no crea nada', () => {
  const home = nuevoHome();
  const r = pcCon(home, origenCon(base()), 'instalar');
  assert.equal(r.status, 1);
  assert.equal(existsSync(claude(home)), false);
});

test('settings: un settings.json mal formado en usuario/ hace salir a instalar con 2 y no escribe nada', () => {
  const home = pcInstalado();
  const nuevo = base();
  nuevo.permissions.allow = 'Bash(*)';
  const antes = readFileSync(ajustes(home), 'utf8');
  const r = pcCon(home, origenCon(nuevo), 'instalar');
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /permissions\.allow debe ser una lista/);
  assert.equal(readFileSync(ajustes(home), 'utf8'), antes);
});
