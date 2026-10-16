// La capa de usuario: instalar copia usuario/ a ~/.claude/, la segunda vez no cambia nada y
// un cambio a mano hace salir a comprobar-pc con 1 nombrando el fichero. Siempre con un HOME temporal.
// settings.json solo se aplica si no amplía permisos (ver scripts/lib/ampliacion-settings.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AmpliaPermisos, ORIGEN, confirmarEnTerminal, instalar } from '../scripts/instalar-pc.mjs';
import { rellenar } from '../scripts/lib/plantilla.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'instalar-pc.mjs');
const ORIGEN_REAL = ORIGEN;
// Lo que se instala: todo usuario/ menos los motivos (que se queden en el repo). No depende de qué hooks haya.
const INSTALABLES = readdirSync(ORIGEN_REAL, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && e.name !== 'settings.motivos.json')
  .map((e) => path.relative(ORIGEN_REAL, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
  .sort();

// usuario/settings.json es una plantilla pública. Estos valores son INVENTADOS, solo para los tests: los reales
// viven en un repo privado y no se leen aquí. Los huecos que pide la plantilla son estos cuatro.
const VALORES_PRUEBA = {
  home: 'C:/Users/prueba',
  'autoMode.environment': ['Frontera de prueba uno', 'Frontera de prueba dos'],
  'autoMode.soft_deny': ['$defaults', 'Bash(taskkill:*)'],
  enabledPlugins: { 'plugin-de-prueba@mercado': true },
};
const nuevoHome = () => mkdtempSync(path.join(tmpdir(), 'instalar-pc-'));
// Fichero de valores temporal con el contenido que se pida (por defecto, los de prueba).
const ficheroValores = (valores = VALORES_PRUEBA) => {
  const f = path.join(mkdtempSync(path.join(tmpdir(), 'valores-')), 'valores.json');
  writeFileSync(f, JSON.stringify(valores));
  return f;
};
const VALORES_FICHERO = ficheroValores();
const pc = (home, orden, ...extra) =>
  spawnSync('node', [SCRIPT, orden, ...extra], {
    env: { ...process.env, FABRICA_HOME: home, FABRICA_VALORES: VALORES_FICHERO },
    encoding: 'utf8',
  });
// En un HOME vacío todo el settings.json es nuevo: solo lo instala Pablo, tecleando AMPLIAR en una terminal.
// Aquí se simula esa terminal inyectando el confirmador; el binario real sin terminal se prueba más abajo.
const instalarTodo = (home) => {
  instalar({
    home,
    valores: VALORES_PRUEBA,
    confirmar: confirmarEnTerminal({ tty: true, leerLinea: () => 'AMPLIAR', escribir: () => {} }),
  });
  return { status: 0 };
};
const claude = (home, ...r) => path.join(home, '.claude', ...r);
const leer = (f) => JSON.parse(readFileSync(f, 'utf8'));

test('instalar copia todo usuario/ (CLAUDE.md, settings.json...) y apunta la huella', () => {
  const home = nuevoHome();
  const r = instalarTodo(home);
  assert.equal(r.status, 0, r.stderr);
  for (const f of INSTALABLES) {
    const esperado = f === 'settings.json' ? `${JSON.stringify(base(), null, 2)}\n` : readFileSync(path.join(ORIGEN_REAL, f), 'utf8');
    assert.equal(readFileSync(claude(home, f), 'utf8'), esperado, f);
  }
  const huella = JSON.parse(readFileSync(claude(home, 'fabrica-huella.json'), 'utf8'));
  assert.deepEqual(Object.keys(huella), INSTALABLES);
  assert.equal(pc(home, 'comprobar').status, 0);
});

test('la segunda vez no cambia nada (ni pide --ampliar)', () => {
  const home = nuevoHome();
  instalarTodo(home);
  const ficheros = [...INSTALABLES, 'fabrica-huella.json'];
  const mtimes = () => Object.fromEntries(ficheros.map((f) => [f, statSync(claude(home, f)).mtimeMs]));
  const antes = mtimes();
  const r = pc(home, 'instalar');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /sin cambios/);
  assert.deepEqual(mtimes(), antes);
});

test('un cambio a mano en destino hace salir a comprobar con 1 y el nombre del fichero', () => {
  const home = nuevoHome();
  instalarTodo(home);
  writeFileSync(claude(home, 'CLAUDE.md'), '// tocado a mano\n');
  const r = pc(home, 'comprobar');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /CLAUDE\.md editado-a-mano/);
  assert.doesNotMatch(r.stderr, /settings\.json/);
});

test('un fichero que falta se nombra, y reinstalar sobrescribe lo editado y lo deja igual', () => {
  const home = nuevoHome();
  const r0 = pc(home, 'comprobar');
  assert.equal(r0.status, 1);
  assert.match(r0.stderr, /CLAUDE\.md falta/);
  assert.match(r0.stderr, /settings\.json falta/);
  instalarTodo(home);
  writeFileSync(claude(home, 'CLAUDE.md'), 'a mano\n');
  const r = pc(home, 'instalar');
  assert.match(r.stdout, /CLAUDE\.md \(editado-a-mano\)/);
  assert.equal(pc(home, 'comprobar').status, 0);
});

test('instalar no escribe nada fuera de lo de usuario/ y la huella (ni memorias ni los motivos)', () => {
  const home = nuevoHome();
  instalarTodo(home);
  assert.deepEqual(readdirSync(claude(home)).sort(), [...new Set([...INSTALABLES.map((f) => f.split('/')[0]), 'fabrica-huella.json'])].sort());
  assert.equal(existsSync(claude(home, 'settings.motivos.json')), false);
});

// --- settings.json: solo se aplica si NO amplía permisos ---

// Un usuario/ temporal con el settings.json (y, si se pide, otro CLAUDE.md) que se indique.
function origenCon(settings, claudeMd) {
  const o = mkdtempSync(path.join(tmpdir(), 'usuario-'));
  cpSync(ORIGEN_REAL, o, { recursive: true });
  writeFileSync(path.join(o, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
  if (claudeMd) writeFileSync(path.join(o, 'CLAUDE.md'), claudeMd);
  return o;
}
const pcCon = (home, origen, orden, ...extra) =>
  spawnSync('node', [SCRIPT, orden, ...extra], {
    env: { ...process.env, FABRICA_HOME: home, FABRICA_USUARIO: origen, FABRICA_VALORES: VALORES_FICHERO },
    encoding: 'utf8',
  });
const ajustes = (home) => claude(home, 'settings.json');
// La plantilla de usuario/ rellena con los valores de prueba: el settings.json que se instala en los tests.
const plantilla = () => leer(path.join(ORIGEN_REAL, 'settings.json'));
const base = () => rellenar(plantilla(), VALORES_PRUEBA);

// Un PC ya instalado con el settings.json real; devuelve su HOME.
function pcInstalado() {
  const home = nuevoHome();
  assert.equal(instalarTodo(home).status, 0);
  return home;
}

test('settings: una regla allow nueva hace salir a instalar con 1, la nombra y no escribe nada', () => {
  const home = pcInstalado();
  const antes = readFileSync(ajustes(home), 'utf8');
  const huellaAntes = readFileSync(claude(home, 'fabrica-huella.json'), 'utf8');
  const claudeAntes = readFileSync(claude(home, 'CLAUDE.md'), 'utf8');
  const nuevo = base();
  nuevo.permissions.allow.push('Bash(rm -rf *)');
  // También cambia CLAUDE.md: tampoco debe llegar, porque no se escribe NADA.
  const r = pcCon(home, origenCon(nuevo, 'otro texto\n'), 'instalar');
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /regla allow nueva: Bash\(rm -rf \*\)/);
  assert.match(r.stderr, /Pablo/);
  assert.equal(readFileSync(ajustes(home), 'utf8'), antes);
  assert.equal(readFileSync(claude(home, 'fabrica-huella.json'), 'utf8'), huellaAntes);
  assert.equal(readFileSync(claude(home, 'CLAUDE.md'), 'utf8'), claudeAntes);
});

// Una ampliación (regla allow nueva) sobre un PC ya instalado, y lo que hay en destino antes de intentarla.
function ampliacionPendiente() {
  const home = pcInstalado();
  const nuevo = base();
  nuevo.permissions.allow.push('Bash(rm -rf *)');
  const origen = origenCon(nuevo, 'otro texto\n');
  const foto = () => ['settings.json', 'CLAUDE.md', 'fabrica-huella.json'].map((f) => readFileSync(claude(home, f), 'utf8'));
  return { home, origen, foto, antes: foto() };
}

test('settings: --ampliar SIN terminal (como una sesión de Claude) sale con 1 y no escribe nada', () => {
  const { home, origen, foto, antes } = ampliacionPendiente();
  // spawnSync con stdio por tuberías: ni stdin ni stdout son una terminal, igual que en una sesión.
  const r = pcCon(home, origen, 'instalar', '--ampliar');
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /sin terminal interactiva/);
  assert.match(r.stderr, /Pablo/);
  assert.deepEqual(foto(), antes);
});

test('settings: --ampliar con terminal y la confirmación correcta aplica la ampliación', () => {
  const { home, origen, foto, antes } = ampliacionPendiente();
  const salida = [];
  const confirmar = confirmarEnTerminal({ tty: true, leerLinea: () => ' AMPLIAR ', escribir: (t) => salida.push(t) });
  const cambios = instalar({ home, origen, confirmar });
  assert.ok(cambios.some((c) => c.fichero === 'settings.json'));
  assert.ok(leer(ajustes(home)).permissions.allow.includes('Bash(rm -rf *)'));
  assert.notDeepEqual(foto(), antes);
  assert.match(salida.join('\n'), /regla allow nueva: Bash\(rm -rf \*\)/,'muestra la lista antes de pedir la confirmación');
});

test('settings: con terminal pero confirmación incorrecta, 1 y nada escrito', () => {
  for (const tecleado of ['', 'ampliar', 'si', 'AMPLIAR ya']) {
    const { home, origen, foto, antes } = ampliacionPendiente();
    const confirmar = confirmarEnTerminal({ tty: true, leerLinea: () => tecleado, escribir: () => {} });
    assert.throws(() => instalar({ home, origen, confirmar }), (e) => e instanceof AmpliaPermisos && /confirmación incorrecta/.test(e.message), tecleado);
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

test('settings: si es igual, sin cambios', () => {
  const home = pcInstalado();
  const r = pcCon(home, ORIGEN_REAL, 'instalar');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /sin cambios/);
});

test('settings: comprobar incluye settings.json', () => {
  const home = pcInstalado();
  writeFileSync(ajustes(home), '{}\n');
  const r = pc(home, 'comprobar');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /settings\.json editado-a-mano/);
});

test('settings: un PC sin settings.json es una ampliación (lo instala Pablo) y no crea nada', () => {
  const home = nuevoHome();
  const r = pc(home, 'instalar');
  assert.equal(r.status, 1);
  assert.equal(existsSync(claude(home)), false);
});

// --- qué cuenta como ampliar ---

const casos = [
  ['additionalDirectories nuevo', (s) => { s.permissions.additionalDirectories = ['C:/otro']; }, /directorio adicional nuevo/],
  ['deny quitada', (s) => { s.permissions.deny = []; }, /regla deny quitada/],
  ['defaultMode más permisivo', (s) => { s.permissions.defaultMode = 'bypassPermissions'; }, /defaultMode más permisivo/],
  ['defaultMode desconocido', (s) => { s.permissions.defaultMode = 'inventado'; }, /defaultMode desconocido/],
  ['hook nuevo', (s) => { s.hooks.Stop = [{ hooks: [{ type: 'command', command: 'node x.mjs' }] }]; }, /hook nuevo: Stop/],
  ['hook cambiado', (s) => { s.hooks.SessionStart[0].hooks[0].command = 'node otro.mjs'; }, /hook nuevo: SessionStart/],
  ['autoMode.environment nuevo', (s) => { s.autoMode.environment.push('Trusted repo: C:\\dev\\fabrica'); }, /autoMode\.environment nuevo/],
  ['soft_deny quitado', (s) => { s.autoMode.soft_deny.pop(); }, /autoMode\.soft_deny quitado/],
  ['plugin activado', (s) => { s.enabledPlugins['otro@mercado'] = true; }, /plugin activado/],
];
for (const [nombre, tocar, patron] of casos) {
  test(`ampliaciones: ${nombre}`, async () => {
    const { ampliaciones } = await import('../scripts/lib/ampliacion-settings.mjs');
    const s = base();
    tocar(s);
    const m = ampliaciones(base(), s);
    assert.ok(m.some((x) => patron.test(x)), JSON.stringify(m));
  });
}

test('ampliaciones: restringir (modo plan, quitar hook, apagar plugin, más soft_deny y deny) no es ampliar', async () => {
  const { ampliaciones } = await import('../scripts/lib/ampliacion-settings.mjs');
  const s = base();
  s.permissions.defaultMode = 'plan';
  delete s.hooks.PostToolUse;
  s.enabledPlugins['vercel@claude-plugins-official'] = false;
  s.autoMode.soft_deny.push('Bash(curl:*)');
  s.permissions.deny.push('Bash(git stash*)');
  assert.deepEqual(ampliaciones(base(), s), []);
});

// --- el motivo de cada clave y los secretos ---

test('motivos: cada clave de primer y segundo nivel de settings.json tiene motivo, y no sobra ninguno', () => {
  const motivos = leer(path.join(ORIGEN_REAL, 'settings.motivos.json'));
  const claves = [];
  for (const [k, v] of Object.entries(plantilla())) {
    claves.push(k);
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const k2 of Object.keys(v)) claves.push(`${k}.${k2}`);
  }
  assert.deepEqual(Object.keys(motivos).sort(), claves.sort());
  for (const [k, v] of Object.entries(motivos)) assert.ok(typeof v === 'string' && v.trim(), k);
});

test('settings.json versionado no contiene nada con forma de secreto', () => {
  const texto = readFileSync(path.join(ORIGEN_REAL, 'settings.json'), 'utf8');
  assert.doesNotMatch(texto, /(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_|ops_[A-Za-z0-9]{20,}|-----BEGIN)/);
});

// --- un settings mal formado lanza, no se lee como vacío (es la puerta de seguridad) ---

const malformados = [
  ['allow que es un texto', (s) => { s.permissions.allow = 'Bash(*)'; }, /permissions\.allow debe ser una lista/],
  ['allow que es un objeto', (s) => { s.permissions.allow = { 0: 'Bash(*)' }; }, /permissions\.allow debe ser una lista/],
  ['additionalDirectories que es un texto', (s) => { s.permissions.additionalDirectories = 'C:/'; }, /additionalDirectories debe ser una lista/],
  ['deny que es un texto', (s) => { s.permissions.deny = 'Bash(gh repo delete*)'; }, /permissions\.deny debe ser una lista/],
  ['autoMode.environment que es un texto', (s) => { s.autoMode.environment = 'confía en todo'; }, /autoMode\.environment debe ser una lista/],
  ['soft_deny que es un número', (s) => { s.autoMode.soft_deny = 3; }, /autoMode\.soft_deny debe ser una lista/],
  ['hooks de un evento que no es lista', (s) => { s.hooks.Stop = { hooks: [] }; }, /hooks\.Stop debe ser una lista/],
  ['grupo de hooks sin lista', (s) => { s.hooks.SessionStart[0].hooks = 'node x.mjs'; }, /hooks debe ser una lista/],
  ['permissions que es una lista', (s) => { s.permissions = ['allow']; }, /permissions debe ser un objeto/],
  ['enabledPlugins que es una lista', (s) => { s.enabledPlugins = ['otro@mercado']; }, /enabledPlugins debe ser un objeto/],
];
for (const [nombre, tocar, patron] of malformados) {
  for (const lado of ['nuevo', 'actual']) {
    test(`ampliaciones: ${nombre} en ${lado} lanza`, async () => {
      const { ampliaciones } = await import('../scripts/lib/ampliacion-settings.mjs');
      const roto = base();
      tocar(roto);
      const args = lado === 'nuevo' ? [base(), roto] : [roto, base()];
      assert.throws(() => ampliaciones(...args), patron);
    });
  }
}

test('ampliaciones: ausente o null es vacío y no lanza', async () => {
  const { ampliaciones } = await import('../scripts/lib/ampliacion-settings.mjs');
  assert.deepEqual(ampliaciones({}, {}), []);
  assert.deepEqual(ampliaciones({ permissions: { allow: null }, hooks: null }, { permissions: {} }), []);
  assert.deepEqual(ampliaciones({}, { permissions: { allow: ['Bash(ls *)'] } }), ['regla allow nueva: Bash(ls *)']);
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

// --- plantilla pública + valores privados ---

test('la plantilla pública y sus motivos no llevan datos personales ni de infraestructura (fuera de los huecos)', () => {
  const prohibidos = [/[A-Za-z]:[\\/]+Users/i, /pabloam89/i, /menuplan/i, /vercel/i, /supabase/i, /\.env\b/i, /blob/i, /\.cursor/i, /deploy-prod/i, /bedca/i, /\.com\b/i];
  for (const nombre of ['settings.json', 'settings.motivos.json']) {
    const texto = readFileSync(path.join(ORIGEN_REAL, nombre), 'utf8').replace(/\{\{[^}]+\}\}/g, '');
    for (const p of prohibidos) assert.doesNotMatch(texto, p, `${nombre} contiene ${p}`);
  }
});

test('la plantilla pide exactamente los huecos esperados', async () => {
  const { huecos } = await import('../scripts/lib/plantilla.mjs');
  assert.deepEqual(huecos(plantilla()), Object.keys(VALORES_PRUEBA).sort());
});

// Instala con un fichero de valores dado y devuelve el resultado del proceso y el HOME.
function instalarConValores(valores, { ruta } = {}) {
  const home = nuevoHome();
  const r = spawnSync('node', [SCRIPT, 'instalar', '--ampliar'], {
    env: { ...process.env, FABRICA_HOME: home, FABRICA_VALORES: ruta ?? ficheroValores(valores) },
    encoding: 'utf8',
  });
  return { r, home };
}

test('valores: sin fichero de valores, error claro y nada escrito', () => {
  const { r, home } = instalarConValores(null, { ruta: path.join(tmpdir(), 'no-existe-valores.json') });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /Falta el fichero de valores privados/);
  assert.equal(existsSync(claude(home)), false);
});

test('valores: un hueco sin valor, error que lo nombra y nada escrito', () => {
  const sinHome = { ...VALORES_PRUEBA };
  delete sinHome.home;
  const { r, home } = instalarConValores(sinHome);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /faltan valores para: home/);
  assert.equal(existsSync(claude(home)), false);
});

test('valores: un valor sobrante, error que lo nombra y nada escrito', () => {
  const { r, home } = instalarConValores({ ...VALORES_PRUEBA, sobrante: 'x' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /sobran valores sin hueco: sobrante/);
  assert.equal(existsSync(claude(home)), false);
});

test('valores: un fichero que no es JSON o no es un objeto, error y nada escrito', () => {
  const malo = path.join(mkdtempSync(path.join(tmpdir(), 'valores-')), 'valores.json');
  writeFileSync(malo, '{no es json');
  const a = instalarConValores(null, { ruta: malo });
  assert.equal(a.r.status, 2);
  assert.match(a.r.stderr, /no es un JSON válido/);
  const b = instalarConValores([1, 2]);
  assert.equal(b.r.status, 2);
  assert.match(b.r.stderr, /objeto JSON/);
  assert.equal(existsSync(claude(a.home)) || existsSync(claude(b.home)), false);
});

test('valores: comprobar sin fichero de valores falla con 2 (no puede comparar) y no escribe', () => {
  const home = nuevoHome();
  const r = spawnSync('node', [SCRIPT, 'comprobar'], {
    env: { ...process.env, FABRICA_HOME: home, FABRICA_VALORES: path.join(tmpdir(), 'no-existe-valores.json') },
    encoding: 'utf8',
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Falta el fichero de valores privados/);
});

test('valores: el relleno correcto reproduce el settings.json esperado, sin huecos y con los valores en su sitio', () => {
  const casa = nuevoHome();
  instalarTodo(casa);
  const instalado = leer(ajustes(casa));
  assert.doesNotMatch(JSON.stringify(instalado), /\{\{/);
  assert.equal(instalado.hooks.SessionStart[0].hooks[0].command, 'node "C:/Users/prueba/.claude/hooks/limpiar-worktrees.mjs" --si --silencio');
  assert.deepEqual(instalado.autoMode.environment, VALORES_PRUEBA['autoMode.environment']);
  assert.deepEqual(instalado.enabledPlugins, VALORES_PRUEBA.enabledPlugins);
  assert.equal(pc(casa, 'comprobar').status, 0);
});

test('valores: comprobar compara contra el resultado RELLENO (otro valor, otro resultado)', () => {
  const home = pcInstalado();
  const otros = ficheroValores({ ...VALORES_PRUEBA, home: 'C:/Users/otro' });
  const r = spawnSync('node', [SCRIPT, 'comprobar'], { env: { ...process.env, FABRICA_HOME: home, FABRICA_VALORES: otros }, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /settings\.json desactualizado/);
});

test('plantilla: un hueco dentro de un texto exige un valor de texto', async () => {
  const { rellenar: rell } = await import('../scripts/lib/plantilla.mjs');
  assert.deepEqual(rell({ a: 'x {{n}} y' }, { n: 'z' }), { a: 'x z y' });
  assert.throws(() => rell({ a: 'x {{n}} y' }, { n: ['z'] }), /no es un texto/);
  assert.deepEqual(rell({ a: '{{n}}' }, { n: ['z'] }), { a: ['z'] });
  assert.deepEqual(rell({ a: '{{n}}' }, { n: '{{m}}' }), { a: '{{m}}' }, 'un valor no se vuelve a expandir');
});
