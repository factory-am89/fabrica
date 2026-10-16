// Log of human interventions: closed vocabulary, `!` commands from a fake transcript, permission prompts from a fake hook
// input, the hitl count. Injected disk (temp dir) and clock; the CLI tests run the real scripts with a fake HOME.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CAMPOS, CLASES, ORIGENES, contarIntervenciones, registrarIntervencion, rutaDeRegistroIntervenciones } from '../scripts/lib/intervention-log.mjs';
import { anotarBangs, anotarPermiso, bangsDe } from '../scripts/intervenciones.mjs';
import { informe } from '../scripts/hitl.mjs';

const AQUI = import.meta.dirname;
const AHORA = new Date(Date.UTC(2026, 9, 16, 10, 30, 0));
const SECRETO = 'rm -rf /home/pablo/secretos/clave-privada';

function conCasa(fn) {
  const casa = mkdtempSync(join(tmpdir(), 'fabrica-interv-'));
  try {
    return fn(casa, () => casa, join(casa, '.fabrica', 'intervenciones.jsonl'));
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
}

const lineas = (ruta) => readFileSync(ruta, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l));
const fila = (contenido, extra = {}) => `${JSON.stringify({ type: 'user', timestamp: '2026-10-16T10:29:00.000Z', message: { role: 'user', content: contenido }, ...extra })}\n`;
const bang = (cmd, extra) => fila(`<bash-input>${cmd}</bash-input>`, extra);

test('vocabulary: closed lists, exported once, in the shape of the other logs', () => {
  assert.equal(rutaDeRegistroIntervenciones(() => '/home/x'), join('/home/x', '.fabrica', 'intervenciones.jsonl'));
  assert.deepEqual(CAMPOS, ['t', 'clase', 'origen']);
  assert.deepEqual(ORIGENES, ['bang', 'permiso', 'bang-sin-hora']);
  assert.equal(CLASES.length, 10);
  assert.equal(new Set(CLASES).size, 10);
  for (const c of ['aviso-de-permiso', 'sin-clasificar', 'aprobar-puerta', 'desatasco']) assert.ok(CLASES.includes(c), c);
});

test('registrarIntervencion: a class or origin outside the vocabulary is refused and nothing is written', () => conCasa((_c, _h, ruta) => {
  for (const [clase, origen] of [[SECRETO, 'bang'], ['aviso-de-permiso', 'Bash'], ['otra', 'permiso'], [undefined, undefined]]) {
    assert.throws(() => registrarIntervencion({ clase, origen, ruta }), /outside the vocabulary/);
  }
  assert.equal(existsSync(ruta), false);
}));

test('a permission prompt gives one line of class aviso-de-permiso, with no field outside the vocabulary', () => conCasa((_c, casa, ruta) => {
  assert.equal(anotarPermiso({ casa, reloj: () => AHORA.getTime() }), 1);
  const l = lineas(ruta);
  assert.equal(l.length, 1);
  assert.deepEqual(l[0], { t: '2026-10-16T10:30:00.000Z', clase: 'aviso-de-permiso', origen: 'permiso' });
  assert.deepEqual(Object.keys(l[0]), CAMPOS);
}));

test('the permiso hook end to end: hook JSON with a command on stdin gives one line and the command is nowhere in the log', () => conCasa((casa, _h, ruta) => {
  const entrada = JSON.stringify({ session_id: 'abc123', cwd: 'C:/dev/x', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: SECRETO } });
  const r = spawnSync(process.execPath, [join(AQUI, '..', 'scripts', 'intervenciones.mjs'), 'permiso'], { input: entrada, encoding: 'utf8', env: { ...process.env, HOME: casa, USERPROFILE: casa } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '', 'it must not print a decision: the prompt is shown as usual');
  const crudo = readFileSync(ruta, 'utf8');
  assert.equal(lineas(ruta).length, 1);
  assert.equal(lineas(ruta)[0].clase, 'aviso-de-permiso');
  assert.ok(!crudo.includes('rm -rf') && !crudo.includes('clave-privada') && !crudo.includes('Bash') && !crudo.includes('C:/dev'), crudo);
}));

test('a hook that cannot log says it and exits 1 (non-blocking), it does not stay silent', () => conCasa((casa) => {
  const ejecutar = (args, input) => spawnSync(process.execPath, [join(AQUI, '..', 'scripts', 'intervenciones.mjs'), ...args], { input, encoding: 'utf8', env: { ...process.env, HOME: casa, USERPROFILE: casa } });
  for (const [args, input] of [[['permiso'], 'no es json'], [['otro'], '{}'], [['bang'], '{}']]) {
    const r = ejecutar(args, input);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /^intervenciones: /);
  }
}));

test('bangsDe: only user lines of the form <bash-input>...</bash-input> count; a subagent line and other messages do not; the command is not returned', () => {
  const texto = bang('npm run x') + fila('hola') + fila('<bash-stdout>ok</bash-stdout>') + bang('ls', { isSidechain: true })
    + JSON.stringify({ type: 'assistant', message: { content: '<bash-input>no</bash-input>' } }) + '\n';
  assert.deepEqual(bangsDe(texto), [{ ts: '2026-10-16T10:29:00.000Z' }]);
  assert.throws(() => bangsDe('{<bash-input> cortada\n'), SyntaxError);
});

test('a `!` gives one line, once: a second look at the same transcript adds none, a new `!` adds one; the command is not in the log', () => conCasa((casa, h, ruta) => {
  const transcript = join(casa, 'sesion.jsonl');
  writeFileSync(transcript, fila('hola') + bang(SECRETO) + fila('<bash-stdout>x</bash-stdout>'));
  const entrada = { session_id: 'sesion-1234', transcript_path: transcript };
  assert.equal(anotarBangs(entrada, { casa: h, ahora: AHORA }), 1);
  assert.deepEqual(lineas(ruta)[0], { t: '2026-10-16T10:29:00.000Z', clase: 'sin-clasificar', origen: 'bang' });
  assert.equal(anotarBangs(entrada, { casa: h, ahora: AHORA }), 0);
  appendFileSync(transcript, bang('git status'));
  assert.equal(anotarBangs(entrada, { casa: h, ahora: AHORA }), 1);
  assert.equal(lineas(ruta).length, 2);
  assert.ok(!readFileSync(ruta, 'utf8').includes('rm -rf'));
}));

test('a `!` without a readable time is logged anyway, marked bang-sin-hora with t null, and counted apart (never dropped, never given a time)', () => conCasa((casa, h, ruta) => {
  const transcript = join(casa, 'sesion.jsonl');
  const sinHora = JSON.stringify({ type: 'user', message: { role: 'user', content: '<bash-input>x</bash-input>' } });
  const ilegible = JSON.stringify({ type: 'user', timestamp: 'ayer por la tarde', message: { role: 'user', content: '<bash-input>y</bash-input>' } });
  writeFileSync(transcript, `${sinHora}
${ilegible}
`);
  assert.equal(anotarBangs({ session_id: 'sesion-1234', transcript_path: transcript }, { casa: h, ahora: AHORA }), 2);
  assert.deepEqual(lineas(ruta), [{ t: null, clase: 'sin-clasificar', origen: 'bang-sin-hora' }, { t: null, clase: 'sin-clasificar', origen: 'bang-sin-hora' }]);
  const c = contarIntervenciones({ ruta });
  assert.deepEqual(c.corruptas, []);
  assert.equal(c.porOrigen['bang-sin-hora'], 2);
  assert.equal(c.porClase['sin-clasificar'], 2);
  appendFileSync(ruta, `${JSON.stringify({ t: null, clase: 'sin-clasificar', origen: 'bang' })}
`);
  assert.deepEqual(contarIntervenciones({ ruta }).corruptas, [3], 't null is valid only for bang-sin-hora');
}));

test('the `!` format is pinned with lines cut from real Claude Code transcripts of this PC (MenuPlan sessions, v2.1.295 to 2.1.299, command replaced)', () => conCasa((casa, h, ruta) => {
  const real = join(AQUI, 'fixtures', 'transcript-bang-real.jsonl');
  assert.equal(bangsDe(readFileSync(real, 'utf8')).length, 3);
  assert.ok(bangsDe(readFileSync(real, 'utf8')).every((b) => !Number.isNaN(Date.parse(b.ts))));
  assert.equal(anotarBangs({ session_id: 'sesion-1234', transcript_path: real }, { casa: h, ahora: new Date('2026-10-14T14:00:00.000Z') }), 1, 'only the last one is within 6 h');
  assert.equal(lineas(ruta)[0].origen, 'bang');
}));

test('a `!` of a subagent, an old `!` and an input without session do not log; a missing transcript throws', () => conCasa((casa, h, ruta) => {
  const transcript = join(casa, 'sesion.jsonl');
  writeFileSync(transcript, bang('viejo', { timestamp: '2026-10-15T01:00:00.000Z' }));
  assert.equal(anotarBangs({ session_id: 'sesion-1234', transcript_path: transcript }, { casa: h, ahora: AHORA }), 0, 'old');
  const reciente = join(casa, 'reciente.jsonl');
  writeFileSync(reciente, bang('nuevo'));
  assert.equal(anotarBangs({ session_id: 'sesion-5678', agent_id: 'a1', transcript_path: reciente }, { casa: h, ahora: AHORA }), 0, 'subagent input with a recent `!`');
  const lateral = join(casa, 'lateral.jsonl');
  writeFileSync(lateral, bang('lateral', { isSidechain: true }));
  assert.equal(anotarBangs({ session_id: 'sesion-9012', transcript_path: lateral }, { casa: h, ahora: AHORA }), 0, 'sidechain line');
  assert.equal(existsSync(ruta), false);
  assert.throws(() => anotarBangs({ transcript_path: transcript }, { casa: h }), /session_id/);
  assert.throws(() => anotarBangs({ session_id: 'sesion-1234', transcript_path: join(casa, 'no-existe') }, { casa: h }), /transcript_path/);
}));

test('a mark file that is not an offset is an error, not a restart from zero', () => conCasa((casa, h) => {
  const transcript = join(casa, 'sesion.jsonl');
  writeFileSync(transcript, bang('x'));
  anotarBangs({ session_id: 'sesion-1234', transcript_path: transcript }, { casa: h, ahora: AHORA });
  writeFileSync(join(casa, '.fabrica', 'marcas', 'sesion-1234.bang'), 'basura');
  assert.throws(() => anotarBangs({ session_id: 'sesion-1234', transcript_path: transcript }, { casa: h, ahora: AHORA }), /byte offset/);
}));

test('contarIntervenciones: counts per class and origin, every class listed (also with 0); no file means zeros', () => conCasa((_c, _h, ruta) => {
  assert.equal(contarIntervenciones({ ruta }).total, 0);
  registrarIntervencion({ clase: 'aviso-de-permiso', origen: 'permiso', ruta });
  registrarIntervencion({ clase: 'aviso-de-permiso', origen: 'permiso', ruta });
  registrarIntervencion({ clase: 'sin-clasificar', origen: 'bang', ruta });
  const c = contarIntervenciones({ ruta });
  assert.equal(c.total, 3);
  assert.deepEqual(Object.keys(c.porClase), CLASES);
  assert.equal(c.porClase['aviso-de-permiso'], 2);
  assert.equal(c.porClase['sin-clasificar'], 1);
  assert.equal(c.porClase['desatasco'], 0);
  assert.deepEqual(c.porOrigen, { bang: 1, permiso: 2, 'bang-sin-hora': 0 });
  assert.deepEqual(c.corruptas, []);
}));

test('a broken log is counted and said, lines are not skipped: line numbers in corruptas, counted in total, in no class', () => conCasa((_c, _h, ruta) => {
  registrarIntervencion({ clase: 'aviso-de-permiso', origen: 'permiso', ruta });
  appendFileSync(ruta, 'esto no es json\n');
  appendFileSync(ruta, `${JSON.stringify({ t: '2026-10-16T10:00:00.000Z', clase: 'inventada', origen: 'bang' })}\n`);
  appendFileSync(ruta, `${JSON.stringify({ t: 'no-es-hora', clase: 'desatasco', origen: 'bang' })}\n`);
  registrarIntervencion({ clase: 'sin-clasificar', origen: 'bang', ruta });
  const c = contarIntervenciones({ ruta });
  assert.deepEqual(c.corruptas, [2, 3, 4]);
  assert.equal(c.total, 5);
  assert.equal(Object.values(c.porClase).reduce((a, x) => a + x, 0), 2);
  const { salida, corruptas } = informe({ json: true, ruta });
  assert.deepEqual(corruptas, [2, 3, 4]);
  assert.deepEqual(JSON.parse(salida).corruptas, [2, 3, 4]);
}));

test('npm run hitl -- --json: the JSON contract, and exit 1 with the lines named when the log is broken', () => conCasa((casa, _h, ruta) => {
  const hitl = (...args) => spawnSync(process.execPath, [join(AQUI, '..', 'scripts', 'hitl.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, HOME: casa, USERPROFILE: casa } });
  registrarIntervencion({ clase: 'aviso-de-permiso', origen: 'permiso', ruta });
  const bueno = hitl('--json');
  assert.equal(bueno.status, 0, bueno.stderr);
  const j = JSON.parse(bueno.stdout);
  assert.deepEqual(Object.keys(j), ['registro', 'total', 'porClase', 'porOrigen', 'corruptas']);
  assert.equal(j.registro, ruta);
  assert.equal(j.porClase['aviso-de-permiso'], 1);
  assert.match(hitl().stdout, /aviso-de-permiso: 1/);
  appendFileSync(ruta, '{roto\n');
  const roto = hitl('--json');
  assert.equal(roto.status, 1);
  assert.deepEqual(JSON.parse(roto.stdout).corruptas, [2]);
  assert.match(roto.stderr, /line numbers: 2/);
}));

test('.claude/settings.json: PermissionRequest, Stop and SessionEnd call intervenciones.mjs; the other hooks are still there', () => {
  const s = JSON.parse(readFileSync(join(AQUI, '..', '.claude', 'settings.json'), 'utf8'));
  const ordenes = (evento) => (s.hooks[evento] ?? []).flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(ordenes('PermissionRequest').some((c) => c.includes('scripts/intervenciones.mjs') && c.endsWith(' permiso')));
  for (const evento of ['Stop', 'SessionEnd']) assert.ok(ordenes(evento).some((c) => c.includes('scripts/intervenciones.mjs') && c.endsWith(' bang')), evento);
  assert.ok(ordenes('SessionStart').length > 0);
  assert.ok(ordenes('PreToolUse').some((c) => c.includes('carpeta-principal.mjs')));
});
