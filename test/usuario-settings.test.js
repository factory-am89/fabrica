// El contenido de usuario/settings.json (plantilla pública) y de usuario/settings.motivos.json:
// sin datos personales ni de infraestructura, con los huecos esperados y con el motivo de cada clave.
// Los valores de estos tests son INVENTADOS: los reales viven en un repo privado y aquí no se leen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ORIGEN, confirmarEnTerminal, instalar } from '../scripts/install-pc.mjs';
import { ampliaciones } from '../scripts/lib/settings-widening.mjs';
import { huecos, rellenar } from '../scripts/lib/template.mjs';
import { FUENTE, PRECARGA } from '../scripts/sin-emsign.mjs';

const leer = (nombre) => JSON.parse(readFileSync(path.join(ORIGEN, nombre), 'utf8'));
const plantilla = () => leer('settings.json');
const VALORES_PRUEBA = {
  home: 'C:/Users/prueba',
  'autoMode.environment': ['Frontera de prueba uno', 'Frontera de prueba dos'],
  'autoMode.soft_deny': ['$defaults', 'Bash(taskkill:*)'],
  enabledPlugins: { 'plugin-de-prueba@mercado': true },
};

test('la plantilla pide exactamente los cuatro huecos acordados', () => {
  assert.deepEqual(huecos(plantilla()), ['autoMode.environment', 'autoMode.soft_deny', 'enabledPlugins', 'home']);
});

test('la plantilla y sus motivos no llevan datos personales ni de infraestructura (fuera de los huecos)', () => {
  const prohibidos = [
    /[A-Za-z]:[\\/]+Users/i, /pabloam89/i, /menuplan/i, /vercel/i, /supabase/i, /\.env\b/i, /blob/i,
    /\.cursor/i, /deploy-prod/i, /bedca/i, /\.com\b/i,
  ];
  for (const nombre of ['settings.json', 'settings.motivos.json']) {
    const texto = readFileSync(path.join(ORIGEN, nombre), 'utf8').replace(/\{\{[^}]+\}\}/g, '');
    for (const p of prohibidos) assert.doesNotMatch(texto, p, `${nombre} contiene ${p}`);
  }
});

test('ni la plantilla ni los motivos contienen nada con forma de secreto', () => {
  for (const nombre of ['settings.json', 'settings.motivos.json']) {
    const texto = readFileSync(path.join(ORIGEN, nombre), 'utf8');
    assert.doesNotMatch(texto, /(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_|ops_[A-Za-z0-9]{20,}|-----BEGIN)/, nombre);
  }
});

test('motivos: cada clave de primer y segundo nivel de la plantilla tiene motivo, y no sobra ninguno', () => {
  const motivos = leer('settings.motivos.json');
  const claves = [];
  for (const [k, v] of Object.entries(plantilla())) {
    claves.push(k);
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const k2 of Object.keys(v)) claves.push(`${k}.${k2}`);
  }
  assert.deepEqual(Object.keys(motivos).sort(), claves.sort());
  for (const [k, v] of Object.entries(motivos)) assert.ok(typeof v === 'string' && v.trim(), k);
});

test('toda clave de la plantilla rellena está en la lista cerrada o la miran las reglas de permisos', () => {
  // Si no, cada instalación pediría AMPLIAR por una clave que ya tenemos y solo falta clasificar.
  const motivos = ampliaciones({}, rellenar(plantilla(), VALORES_PRUEBA));
  assert.deepEqual(motivos.filter((m) => /fuera de la lista cerrada/.test(m)), []);
});

test('instalar con valores de prueba escribe CLAUDE.md, settings.json relleno, hooks/, la precarga tls/ y la huella, y no los motivos', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'install-pc-'));
  const confirmar = confirmarEnTerminal({ tty: true, leerLinea: () => 'AMPLIAR', escribir: () => {} });
  instalar({ home, valores: VALORES_PRUEBA, confirmar });
  assert.deepEqual(readdirSync(path.join(home, '.claude')).sort(), ['CLAUDE.md', 'fabrica-huella.json', 'hooks', 'settings.json', 'tls']);
  assert.equal(readFileSync(PRECARGA(home), 'utf8'), readFileSync(FUENTE, 'utf8')); // donde sin-emsign la busca
  const instalado = readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8');
  assert.doesNotMatch(instalado, /\{\{/);
  assert.equal(instalado, `${JSON.stringify(rellenar(plantilla(), VALORES_PRUEBA), null, 2)}\n`);
});
