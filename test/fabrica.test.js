// Lo que la Fábrica se exige a sí misma, comprobado por máquina (principio 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';
import { decidir, leerPreguntas } from '../scripts/veredicto.mjs';
import { destino } from '../apps/convertir.mjs';

const leer = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');
const preguntas = leerPreguntas(leer('estandares/codigo.md'));

test('CLAUDE.md es corto y empieza por la conducta', () => {
  const lineas = leer('CLAUDE.md').split('\n').filter((l) => l.trim());
  assert.ok(lineas.length <= 20, `tiene ${lineas.length} líneas con texto`);
  assert.match(lineas[1], /^Entiende lo que Pablo quiere decir, no lo que pone/);
});

test('los tres roles tienen su modelo y el revisor no escribe', () => {
  const modelos = { arquitecto: 'opus', constructor: 'sonnet', revisor: 'opus' };
  for (const [rol, modelo] of Object.entries(modelos)) {
    const cabecera = leer(`.claude/agents/${rol}.md`).split('---')[1];
    assert.match(cabecera, new RegExp(`^name: ${rol}$`, 'm'));
    assert.match(cabecera, new RegExp(`^model: ${modelo}$`, 'm'));
    if (rol !== 'constructor') assert.doesNotMatch(cabecera, /Edit|Write/);
  }
});

test('el estándar tiene de 10 a 12 preguntas, cada una con bien y mal', () => {
  assert.ok(preguntas.length >= 10 && preguntas.length <= 12, `hay ${preguntas.length}`);
  const bloques = leer('estandares/codigo.md').split(/^### /m).slice(1);
  for (const b of bloques) {
    assert.match(b, /^Bien: /m, b.split('\n')[0]);
    assert.match(b, /^Mal: /m, b.split('\n')[0]);
  }
});

const workflows = readdirSync(new URL('../.github/workflows/', import.meta.url));

test('los workflows son YAML, declaran permisos y fijan cada acción por SHA (C4)', () => {
  assert.ok(workflows.length > 0);
  for (const f of workflows) {
    const texto = leer(`.github/workflows/${f}`);
    const doc = parse(texto);
    assert.ok('permissions' in doc, `${f} sin permissions`);
    assert.notEqual(doc.permissions, 'write-all', `${f} con write-all`);
    for (const [, accion] of texto.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
      assert.match(accion, /@[0-9a-f]{40}$/, `${f}: ${accion} sin SHA`);
    }
  }
});

test('revisor.yml usa pull_request_target y no baja el código del PR', () => {
  const texto = leer('.github/workflows/revisor.yml');
  assert.ok('pull_request_target' in parse(texto).on);
  assert.doesNotMatch(texto, /^\s*ref:/m, 'un checkout con ref: traería el código del PR');
});

function manifests() {
  const html = leer('apps/crear-apps.html');
  const valores = [...html.matchAll(/name="manifest" value="([^"]*)"/g)].map((m) => m[1]);
  return valores.map((v) => JSON.parse(v.replaceAll('&quot;', '"').replaceAll('&amp;', '&')));
}

test('las dos Apps piden solo los permisos acordados', () => {
  const [constructor, revisor] = manifests();
  assert.deepEqual(constructor.default_permissions, {
    contents: 'write', pull_requests: 'write', issues: 'write', workflows: 'write', checks: 'read', actions: 'read',
  });
  assert.deepEqual(revisor.default_permissions, { pull_requests: 'write', checks: 'write', contents: 'read' });
  for (const m of [constructor, revisor]) {
    for (const prohibido of ['administration', 'secrets', 'environments']) {
      assert.ok(!(prohibido in m.default_permissions), `${m.name} pide ${prohibido}`);
    }
  }
});

test('convertir.mjs solo reconoce las dos Apps', () => {
  assert.equal(destino('fabrica-constructor'), 'constructor');
  assert.equal(destino('fabrica-revisor-1'), 'revisor');
  assert.throws(() => destino('otra'));
});

const buenas = () => preguntas.filter((p) => p.quien === 'revisor').map((p) => ({ id: p.id, respuesta: 'sí', prueba: 'x.js:1' }));

test('veredicto: sí solo si todo lo del revisor es sí o no aplica con prueba', () => {
  assert.equal(decidir(JSON.stringify({ respuestas: buenas(), resumen: 'ok' }), preguntas).ok, true);
});

test('veredicto: un no, un hueco, una respuesta sin prueba o una salida rota son no', () => {
  const r = buenas();
  const con = (cambio) => decidir(JSON.stringify({ respuestas: cambio, resumen: '' }), preguntas).ok;
  assert.equal(con([{ ...r[0], respuesta: 'no' }, ...r.slice(1)]), false);
  assert.equal(con(r.slice(1)), false);
  assert.equal(con([{ ...r[0], prueba: ' ' }, ...r.slice(1)]), false);
  assert.equal(con([{ ...r[0], respuesta: 'tal vez' }, ...r.slice(1)]), false);
  assert.equal(decidir('', preguntas).ok, false);
  assert.equal(decidir('{no json', preguntas).ok, false);
});
