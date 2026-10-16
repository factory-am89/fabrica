// La puerta de ampliación de permisos: qué cambios de settings.json cuentan como ampliar.
// Lista cerrada al revés: solo CLAVES_SEGURAS cambia sin aviso; cualquier otra clave cambiada amplía.
// Todo con test/fixtures/settings-base.json, un settings inventado: ningún dato real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ampliaciones, CLAVES_SEGURAS } from '../scripts/lib/ampliacion-settings.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = () => JSON.parse(readFileSync(path.join(RAIZ, 'test', 'fixtures', 'settings-base.json'), 'utf8'));
const con = (tocar) => {
  const s = base();
  tocar(s);
  return ampliaciones(base(), s);
};

test('igual a sí mismo no amplía nada', () => {
  assert.deepEqual(ampliaciones(base(), base()), []);
});

const casos = [
  ['regla allow nueva', (s) => { s.permissions.allow.push('Bash(rm -rf *)'); }, /regla allow nueva: Bash\(rm -rf \*\)/],
  ['additionalDirectories nuevo', (s) => { s.permissions.additionalDirectories = ['C:/otro']; }, /directorio adicional nuevo/],
  ['deny quitada', (s) => { s.permissions.deny = []; }, /regla deny quitada/],
  ['defaultMode más permisivo', (s) => { s.permissions.defaultMode = 'bypassPermissions'; }, /defaultMode más permisivo/],
  ['defaultMode desconocido', (s) => { s.permissions.defaultMode = 'inventado'; }, /defaultMode desconocido/],
  ['hook nuevo', (s) => { s.hooks.Stop = [{ hooks: [{ type: 'command', command: 'node x.mjs' }] }]; }, /hook nuevo: Stop/],
  ['hook cambiado', (s) => { s.hooks.SessionStart[0].hooks[0].command = 'node otro.mjs'; }, /hook nuevo: SessionStart/],
  ['autoMode.environment nuevo', (s) => { s.autoMode.environment.push('Frontera nueva'); }, /autoMode\.environment nuevo/],
  ['autoMode.allow nuevo', (s) => { s.autoMode.allow = ['Bash(*)']; }, /autoMode\.allow nuevo/],
  ['soft_deny quitado', (s) => { s.autoMode.soft_deny.pop(); }, /autoMode\.soft_deny quitado/],
  ['plugin activado', (s) => { s.enabledPlugins['otro@mercado'] = true; }, /plugin activado/],
];
for (const [nombre, tocar, patron] of casos) {
  test(`amplía: ${nombre}`, () => {
    const m = con(tocar);
    assert.ok(m.some((x) => patron.test(x)), JSON.stringify(m));
  });
}

test('restringir (modo plan, quitar hook, apagar plugin, más soft_deny y deny) no es ampliar', () => {
  const m = con((s) => {
    s.permissions.defaultMode = 'plan';
    delete s.hooks.PostToolUse;
    s.enabledPlugins['plugin-de-prueba@mercado'] = false;
    s.autoMode.soft_deny.push('Bash(curl:*)');
    s.permissions.deny.push('Bash(git stash*)');
  });
  assert.deepEqual(m, []);
});

// --- lista cerrada al revés: lo que no está en CLAVES_SEGURAS amplía ---

// Pone `valor` en la ruta (con «*» resuelto a un nombre que exista en el fixture).
function poner(s, ruta, valor) {
  let nodo = s;
  for (const p of ruta.slice(0, -1)) nodo = nodo[p === '*' ? Object.keys(nodo)[0] : p];
  nodo[ruta.at(-1)] = valor;
}

for (const { ruta, motivo } of CLAVES_SEGURAS) {
  test(`clave segura ${ruta.join('.')}: cambiarla no amplía, y tiene motivo`, () => {
    assert.ok(motivo.trim().length > 10);
    assert.deepEqual(con((s) => poner(s, ruta, 'valor-nuevo')), []);
  });
}

const fuera = [
  ['una clave desconocida nueva', (s) => { s.claveDesconocida = true; }, /claveDesconocida/],
  ['una clave desconocida cambiada', (s) => { s.claveDesconocida = true; }, /claveDesconocida/, (s) => { s.claveDesconocida = false; }],
  ['permissions.ask quitada', (s) => { delete s.permissions.ask; }, /permissions\.ask/],
  ['permissions.ask cambiada', (s) => { s.permissions.ask = []; }, /permissions\.ask/],
  ['statusLine de tipo command', (s) => { s.statusLine = { type: 'command', command: 'node x.mjs' }; }, /statusLine\.type|statusLine\.command/],
  ['otra variable de env', (s) => { s.env.ANTHROPIC_BASE_URL = 'http://otro'; }, /env\.ANTHROPIC_BASE_URL/],
  ['apiKeyHelper', (s) => { s.apiKeyHelper = 'node x.mjs'; }, /apiKeyHelper/],
  ['otra clave dentro de modelSettings', (s) => { s.modelSettings['modelo-de-prueba'].otra = 1; }, /modelSettings\.modelo-de-prueba\.otra/],
  ['otra clave dentro de autoMode', (s) => { s.autoMode.otra = ['x']; }, /autoMode\.otra/],
  ['una clave segura convertida en objeto', (s) => { s.model = { x: 1 }; }, /model\.x/],
];
for (const [nombre, tocar, patron, antes] of fuera) {
  test(`amplía (fuera de la lista cerrada): ${nombre}`, () => {
    const inicial = base();
    if (antes) antes(inicial);
    const s = base();
    tocar(s);
    const m = ampliaciones(inicial, s);
    assert.ok(m.some((x) => /fuera de la lista cerrada/.test(x) && patron.test(x)), JSON.stringify(m));
  });
}

test('una clave desconocida que desaparece también amplía (ante la duda, no se aplica)', () => {
  const inicial = base();
  inicial.claveDesconocida = true;
  const m = ampliaciones(inicial, base());
  assert.ok(m.some((x) => /claveDesconocida/.test(x)), JSON.stringify(m));
});

// --- un valor mal formado lanza, no se lee como vacío (es la puerta de seguridad) ---

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
    test(`mal formado: ${nombre} en ${lado} lanza`, () => {
      const roto = base();
      tocar(roto);
      const args = lado === 'nuevo' ? [base(), roto] : [roto, base()];
      assert.throws(() => ampliaciones(...args), patron);
    });
  }
}

test('ausente o null es vacío y no lanza', () => {
  assert.deepEqual(ampliaciones({}, {}), []);
  assert.deepEqual(ampliaciones({ permissions: { allow: null }, hooks: null }, { permissions: {} }), []);
  assert.deepEqual(ampliaciones({}, { permissions: { allow: ['Bash(ls *)'] } }), ['regla allow nueva: Bash(ls *)']);
});
