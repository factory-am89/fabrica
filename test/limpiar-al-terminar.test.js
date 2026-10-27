// La limpieza al terminar un turno (gancho Stop): tope de frecuencia, candado, fallo en alto, y que el gancho está cableado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pasada, informe, ESTADO, TOPE_MS, rutaDeUltima, rutaDeCandado } from '../scripts/limpiar-al-terminar.mjs';
import { tomarTurno } from '../scripts/lib/turno.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const casaNueva = () => { const d = mkdtempSync(path.join(tmpdir(), 'limpieza-')); return () => d; };
const DOS = () => [{ ruta: 'p' }, { ruta: 'q' }];
const resumen = (extra = {}) => ({ ensayo: false, borraRemotas: true, repo: 'x/y', borradas: [], quedan: [], fallos: 0, ...extra });
const contador = (salida = resumen()) => { const f = () => { f.n += 1; return salida; }; f.n = 0; return f; };

test('limpiar-al-terminar: sin más carpetas que la principal no llama a limpiar ni apunta nada', () => {
  const casa = casaNueva();
  const limpiarFn = contador();
  const r = pasada({ casa, limpiarFn, listar: () => [{ ruta: 'p' }] });
  assert.equal(r.estado, ESTADO.nada);
  assert.equal(limpiarFn.n, 0);
  assert.equal(existsSync(rutaDeUltima(casa)), false);
});

test('limpiar-al-terminar: la primera pasada limpia y apunta la hora; la siguiente dentro del tope no vuelve a llamar', () => {
  const casa = casaNueva();
  const limpiarFn = contador();
  let t = Date.parse('2026-10-27T12:00:00Z');
  const args = { casa, limpiarFn, listar: DOS, reloj: () => t };
  assert.equal(pasada(args).estado, ESTADO.limpia);
  t += TOPE_MS - 1;
  assert.equal(pasada(args).estado, ESTADO.tope);
  assert.equal(limpiarFn.n, 1);
  t += 1; // exactamente el tope: ya toca
  assert.equal(pasada(args).estado, ESTADO.limpia);
  assert.equal(limpiarFn.n, 2);
});

test('limpiar-al-terminar: si limpiar lanza, el error sube y la pasada queda apuntada (no se reintenta cada turno)', () => {
  const casa = casaNueva();
  const roto = () => { throw new Error('GitHub no responde'); };
  assert.throws(() => pasada({ casa, limpiarFn: roto, listar: DOS }), /GitHub no responde/);
  assert.equal(pasada({ casa, limpiarFn: contador(), listar: DOS }).estado, ESTADO.tope);
});

test('limpiar-al-terminar: con el candado en manos de otra pasada viva se omite sin esperar y sin llamar a limpiar', () => {
  const casa = casaNueva();
  const otra = tomarTurno({ ruta: rutaDeCandado(casa), minLibre: 0, quien: 'otra' });
  const limpiarFn = contador();
  try {
    assert.equal(pasada({ casa, limpiarFn, listar: DOS }).estado, ESTADO.ocupada);
    assert.equal(limpiarFn.n, 0);
  } finally { otra.soltar(); }
  assert.equal(pasada({ casa, limpiarFn, listar: DOS }).estado, ESTADO.limpia); // el candado se suelta al acabar
  assert.equal(existsSync(rutaDeCandado(casa)), false);
});

test('limpiar-al-terminar: limpiar recibe el cwd de la sesión (para no borrar la carpeta en la que trabaja)', () => {
  let visto;
  pasada({ casa: casaNueva(), cwd: 'C:\\dev\\x', listar: DOS, limpiarFn: (o) => { visto = o; return resumen(); } });
  assert.deepEqual(visto, { cwd: 'C:\\dev\\x' });
});

test('limpiar-al-terminar: un fichero de última pasada ilegible falla en alto, no se toma por «nunca»', () => {
  const casa = casaNueva();
  mkdirSync(path.dirname(rutaDeUltima(casa)), { recursive: true });
  writeFileSync(rutaDeUltima(casa), 'no es json');
  assert.throws(() => pasada({ casa, limpiarFn: contador(), listar: DOS }));
  assert.equal(existsSync(rutaDeCandado(casa)), false, 'el candado se suelta aunque falle');
});

test('limpiar-al-terminar: informe: nada que decir no escribe; borradas por stdout; fallos por stderr con salida 1', () => {
  assert.deepEqual(informe({ estado: ESTADO.tope, salida: null }), { codigo: 0, stdout: [], stderr: [] });
  const sinNovedad = informe({ estado: ESTADO.limpia, salida: resumen({ quedan: [{ carpeta: 'c', rama: 'feat/a', motivo: 'no fusionada' }] }) });
  assert.equal(sinNovedad.codigo, 0);
  assert.deepEqual(sinNovedad.stdout, []);
  const borro = informe({ estado: ESTADO.limpia, salida: resumen({ borradas: [{ carpeta: 'c', rama: 'feat/a', remota: false, avisos: [] }] }) });
  assert.equal(borro.codigo, 0);
  assert.match(borro.stdout[0], /^limpiar borrada: c/);
  const falla = informe({ estado: ESTADO.limpia, salida: resumen({ fallos: 1, quedan: [{ carpeta: 'c', rama: 'feat/a', motivo: 'no pude borrarla: x' }] }) });
  assert.equal(falla.codigo, 1);
  assert.deepEqual(falla.stdout, []);
  assert.match(falla.stderr[0], /^FÁBRICA AL TERMINAR: la limpieza dejó 1 cosas sin borrar/);
  assert.ok(falla.stderr.some((l) => l.includes('no pude borrarla: x')));
});

test('limpiar-al-terminar: .claude/settings.json lanza este script en Stop, junto al de intervenciones', () => {
  const s = JSON.parse(readFileSync(path.join(RAIZ, '.claude', 'settings.json'), 'utf8'));
  const ordenes = s.hooks.Stop.flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(ordenes.includes('node "$CLAUDE_PROJECT_DIR/scripts/limpiar-al-terminar.mjs"'));
  assert.ok(ordenes.some((c) => c.includes('scripts/intervenciones.mjs')));
  assert.ok(existsSync(path.join(RAIZ, 'scripts', 'limpiar-al-terminar.mjs')));
});
