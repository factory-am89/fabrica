// scripts/golden-run.mjs ejecuta al revisor sobre el corpus con un `claude -p` falso (GOLDEN_CLAUDE_BIN): no hay modelo ni red.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

const RAIZ = path.join(import.meta.dirname, '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'golden-run.mjs');
const FALSO = path.join(import.meta.dirname, 'fixtures', 'claude-falso.mjs');
const WORKFLOW = path.join(RAIZ, '.github', 'workflows', 'revisor.yml');
const temporales = [];
after(() => temporales.forEach((d) => rmSync(d, { recursive: true, force: true })));

// Un corpus de 3 casos (uno por pregunta mala, otro y un limpio) para los tests que no necesitan los 9: cada llamada cuesta ~0,7 s.
function corpusChico() {
  const dir = mkdtempSync(path.join(tmpdir(), 'golden-corpus-'));
  temporales.push(dir);
  const real = path.join(RAIZ, 'test', 'fixtures', 'golden', 'review');
  const esperado = JSON.parse(readFileSync(path.join(real, 'expected.json'), 'utf8'));
  const ids = ['caso-01', 'caso-02', 'caso-07'];
  for (const id of ids) cpSync(path.join(real, id), path.join(dir, id), { recursive: true });
  writeFileSync(path.join(dir, 'expected.json'), JSON.stringify(Object.fromEntries(ids.map((id) => [id, esperado[id]]))));
  return dir;
}
const CHICO = ['--corpus', corpusChico()];

// Una pasada con el claude falso. `tmp` es el directorio temporal que ve la pasada (TEMP/TMP/TMPDIR): al acabar debe estar vacío.
function pasada(args = [], env = {}) {
  const base = mkdtempSync(path.join(tmpdir(), 'golden-run-test-'));
  temporales.push(base);
  const p = { tmp: path.join(base, 'tmp'), out: path.join(base, 'out'), log: path.join(base, 'claude.log') };
  mkdirSync(p.tmp);
  const r = spawnSync(process.execPath, [SCRIPT, '--out', p.out, ...args], {
    encoding: 'utf8',
    cwd: RAIZ,
    env: { ...process.env, TEMP: p.tmp, TMP: p.tmp, TMPDIR: p.tmp, GOLDEN_CLAUDE_BIN: FALSO, CLAUDE_FALSO_LOG: p.log, ...env },
  });
  const llamadas = existsSync(p.log) ? readFileSync(p.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  return { ...p, r, llamadas, sobras: readdirSync(p.tmp) };
}

test('9 casos por 3 intentos son 27 llamadas; se anuncian antes de la primera y cada una imprime su coste', () => {
  const x = pasada();
  assert.equal(x.r.status, 0, x.r.stderr);
  assert.equal(x.llamadas.length, 27);
  const anuncio = x.r.stdout.indexOf('27 calls');
  const primerCoste = x.r.stdout.indexOf('cost');
  assert.ok(anuncio >= 0 && primerCoste > anuncio, x.r.stdout);
  assert.equal(x.r.stdout.match(/^caso-\d\d\/\d: cost \$0\.25$/gm).length, 27);
  assert.match(x.r.stdout, /total cost: \$6\.75/);
  assert.equal(readdirSync(path.join(x.out, 'caso-01')).length, 3);
});

test('el espacio de trabajo no contiene expected.json ni nada del corpus, y sí el juez y el caso', () => {
  const x = pasada(['--trials', '1']);
  assert.equal(x.r.status, 0, x.r.stderr);
  assert.equal(x.llamadas.length, 9);
  for (const l of x.llamadas) {
    assert.ok(!l.ficheros.some((f) => /expected\.json$/.test(f) || /test\/fixtures\/golden\//.test(f)), l.ficheros.filter((f) => /golden/.test(f)).join(', '));
    for (const f of ['pr.diff', 'body.md', '.fabrica/standards/code.md', '.fabrica/.claude/agents/revisor.md']) assert.ok(l.ficheros.includes(f), f);
  }
  assert.ok(x.llamadas.every((l) => !l.cwd.startsWith(RAIZ)), 'el claude no corre dentro del repo');
});

test('modelo, turnos y schema salen de revisor.yml: con otro workflow, otro valor (no hay copia)', () => {
  const real = yaml.load(readFileSync(WORKFLOW, 'utf8'));
  const paso = real.jobs.juzgar.steps.find((s) => s.id === 'claude');
  const otro = path.join(mkdtempSync(path.join(tmpdir(), 'golden-wf-')), 'otro.yml');
  temporales.push(path.dirname(otro));
  paso.with.claude_args = paso.with.claude_args.replace('--model opus', '--model sonnet').replace('--max-turns 20', '--max-turns 7').replace('"respuestas"]', '"respuestas","x"]');
  writeFileSync(otro, yaml.dump(real));
  const x = pasada(['--trials', '1', '--workflow', otro, ...CHICO]);
  assert.equal(x.r.status, 0, x.r.stderr);
  const a = x.llamadas[0].argv;
  assert.equal(a[a.indexOf('--model') + 1], 'sonnet');
  assert.equal(a[a.indexOf('--max-turns') + 1], '7');
  assert.deepEqual(JSON.parse(a[a.indexOf('--json-schema') + 1]).required, ['respuestas', 'x']);
  // y con el workflow real, el del workflow real
  const y = pasada(['--trials', '1', ...CHICO]);
  const b = y.llamadas[0].argv;
  assert.equal(b[b.indexOf('--model') + 1], 'opus');
  assert.equal(b[b.indexOf('--max-turns') + 1], '20');
  assert.ok(!b.some((t) => /Bash/.test(t)), 'sin Bash: no hay PR que leer con gh');
});

test('el prompt es el del workflow con solo el número, la ruta del diff y la frase de gh pr view cambiados', () => {
  const x = pasada(['--trials', '1', ...CHICO]);
  const { stdin } = x.llamadas[0];
  assert.match(stdin, /^Eres el revisor: sigue \.fabrica\/\.claude\/agents\/revisor\.md y juzga el PR número 0\b/);
  assert.match(stdin, /body\.md/);
  assert.doesNotMatch(stdin, /gh pr view|\$\{\{/);
  assert.match(stdin, /El diff exacto está en .*pr\.diff/);
});

test('más de 27 llamadas se rechaza antes de llamar a nadie', () => {
  const x = pasada(['--trials', '4']);
  assert.equal(x.r.status, 1);
  assert.match(x.r.stderr, /36 calls.*27/);
  assert.equal(x.llamadas.length, 0);
});

test('informe de varianza: un revisor inestable deja casos con veredicto inestable, uno estable ninguno; sin suelo', () => {
  const estable = pasada(['--trials', '2', ...CHICO]);
  assert.match(estable.r.stdout, /unstable verdict: 0\/3 cases/);
  const inestable = pasada(['--trials', '2', ...CHICO], { CLAUDE_FALSO_ALTERNA: '1' });
  assert.equal(inestable.r.status, 0, inestable.r.stderr);
  assert.match(inestable.r.stdout, /unstable verdict: 3\/3 cases/);
  assert.match(inestable.r.stdout, /unstable questions: C5 \(3 cases\)/);
  assert.doesNotMatch(inestable.r.stdout, /under the floor/);
});

test('si el claude falla, la pasada para con un error y no sigue llamando', () => {
  const x = pasada(CHICO, { CLAUDE_FALSO_FALLA: '1' });
  assert.equal(x.r.status, 1);
  assert.match(x.r.stderr, /golden-run: caso-01\/1: claude failed/);
  assert.equal(x.llamadas.length, 1);
});

test('los espacios de trabajo se borran: el directorio temporal queda vacío', () => {
  const x = pasada(['--trials', '1', ...CHICO]);
  assert.deepEqual(x.sobras, []);
});
