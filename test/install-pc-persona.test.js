// La capa de usuario en dos trozos: usuario/CLAUDE.md (común, sin nombre de nadie) y usuario/personas/<persona>.md.
// install-pc las une en ~/.claude/CLAUDE.md según la clave `persona` de los valores. Siempre con un HOME temporal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HUELLA, ORIGEN, instalar } from '../scripts/install-pc.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'install-pc.mjs');
const nuevoHome = () => mkdtempSync(path.join(tmpdir(), 'install-persona-'));
const claudeMd = (home) => path.join(home, '.claude', 'CLAUDE.md');
const comun = () => readFileSync(path.join(ORIGEN, 'CLAUDE.md'), 'utf8');

// Un usuario/ de juguete: común + dos personas.
function origenDeJuguete() {
  const o = mkdtempSync(path.join(tmpdir(), 'usuario-persona-'));
  writeFileSync(path.join(o, 'CLAUDE.md'), '# común\n');
  mkdirSync(path.join(o, 'personas'));
  writeFileSync(path.join(o, 'personas', 'ana.md'), '## capa de Ana\n');
  writeFileSync(path.join(o, 'personas', 'luis.md'), '## capa de Luis\n');
  return o;
}

test('instalar une la parte común y la capa de la persona, y personas/ no se copia sola', () => {
  const home = nuevoHome();
  const origen = origenDeJuguete();
  instalar({ home, origen, valores: { persona: 'ana' } });
  assert.equal(readFileSync(claudeMd(home), 'utf8'), '# común\n\n## capa de Ana\n');
  assert.deepEqual(readdirSync(path.join(home, '.claude')).sort(), ['CLAUDE.md', HUELLA]);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(home, '.claude', HUELLA), 'utf8'))), ['CLAUDE.md']);
});

test('dos personas, dos resultados distintos con la misma parte común', () => {
  const origen = origenDeJuguete();
  const [a, b] = ['ana', 'luis'].map((persona) => {
    const home = nuevoHome();
    instalar({ home, origen, valores: { persona } });
    return readFileSync(claudeMd(home), 'utf8');
  });
  assert.match(a, /capa de Ana/);
  assert.doesNotMatch(a, /Luis/);
  assert.match(b, /capa de Luis/);
  assert.doesNotMatch(b, /Ana/);
});

test('sin la clave persona, o con una que no existe o que sale de la carpeta, falla en alto y no escribe nada', () => {
  const origen = origenDeJuguete();
  for (const [valores, mensaje] of [
    [{}, /Falta la clave "persona"/],
    [{ persona: 'nadie' }, /No existe la capa personal/],
    [{ persona: '../CLAUDE' }, /no es un nombre válido/],
    [{ persona: 7 }, /no es un nombre válido/],
  ]) {
    const home = nuevoHome();
    assert.throws(() => instalar({ home, origen, valores }), mensaje, JSON.stringify(valores));
    assert.equal(existsSync(path.join(home, '.claude')), false, JSON.stringify(valores));
  }
});

test('desde la línea de órdenes: la persona sale del fichero de valores (FABRICA_VALORES)', () => {
  const home = nuevoHome();
  const valores = path.join(nuevoHome(), 'valores.json');
  writeFileSync(valores, JSON.stringify({ persona: 'luis' }));
  const env = { ...process.env, FABRICA_HOME: home, FABRICA_USUARIO: origenDeJuguete(), FABRICA_VALORES: valores };
  const r = spawnSync('node', [SCRIPT, 'instalar'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(claudeMd(home), 'utf8'), /capa de Luis/);
  assert.equal(spawnSync('node', [SCRIPT, 'comprobar'], { env, encoding: 'utf8' }).status, 0);
});

test('la parte común del repo no nombra a nadie ni lleva rutas de nadie', () => {
  const texto = comun();
  assert.doesNotMatch(texto, /Pablo|pabloam89|álvaro|algbarc/i);
  assert.doesNotMatch(texto, /[A-Za-z]:[\\/]+(Users|dev)/i);
});

test('la capa de Pablo conserva lo suyo y, instalada con persona pabloam89, llega a su ~/.claude/CLAUDE.md', () => {
  const home = nuevoHome();
  // El CLAUDE.md y personas/ de verdad; sin settings.json, que pide sus valores y se prueba en usuario-settings.test.js.
  const origen = mkdtempSync(path.join(tmpdir(), 'usuario-real-'));
  cpSync(path.join(ORIGEN, 'CLAUDE.md'), path.join(origen, 'CLAUDE.md'));
  cpSync(path.join(ORIGEN, 'personas'), path.join(origen, 'personas'), { recursive: true });
  instalar({ home, origen, valores: { persona: 'pabloam89' } });
  const instalado = readFileSync(claudeMd(home), 'utf8');
  const frases = [
    'C:\\dev\\MenuPlan', // dónde trabaja
    'C:\\dev\\MenuPlan-<tema>',
    'C:\\Users\\pablo\\.claude\\hooks\\limpiar-worktrees.mjs',
    "timeZone:'Europe/Madrid'", // la hora de Madrid
    'npm run hora',
    '## Cómo responder a Pablo',
    '**la idea raíz, en negrita**',
    'Cuatro ideas clave como mucho',
    'tres\n  opciones entendibles con la recomendada primero',
    'estilo-de-respuesta',
  ];
  for (const f of frases) assert.ok(instalado.includes(f), `falta en el CLAUDE.md instalado: ${f}`);
  assert.ok(instalado.startsWith(comun()), 'empieza por la parte común');
  assert.ok(instalado.endsWith(readFileSync(path.join(ORIGEN, 'personas', 'pabloam89.md'), 'utf8')));
});
