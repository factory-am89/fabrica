// Log of gh calls: closed vocabulary, classification of the gh subcommand, counting. Injected disk (temp dir) and clock;
// no real gh, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APIS, CAMPOS, RESULTADOS, SUBCOMANDOS, clasificarApi, contarLlamadas, registrarLlamada, resultadoDe, rutaDeRegistroGh } from '../scripts/lib/registro-gh.mjs';

const AHORA = Date.UTC(2026, 9, 16, 10, 30, 0);

function conRegistro(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'fabrica-gh-'));
  try {
    return fn(join(dir, '.fabrica', 'gh-calls.jsonl'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('rutaDeRegistroGh: ~/.fabrica/gh-calls.jsonl', () => {
  assert.equal(rutaDeRegistroGh(() => '/home/x'), join('/home/x', '.fabrica', 'gh-calls.jsonl'));
});

test('vocabulary: closed lists, exported once', () => {
  assert.deepEqual(APIS, ['rest', 'graphql', 'unknown']);
  assert.deepEqual(RESULTADOS, ['ok', 'limited', 'error']);
  assert.deepEqual(CAMPOS, ['t', 'caller', 'api', 'result']);
  for (const api of Object.values(SUBCOMANDOS)) assert.ok(APIS.includes(api), `${api} is outside APIS`);
});

test('clasificarApi: run/workflow/secret and api repos/... are rest; issue/pr/label and api graphql are graphql; the rest is unknown', () => {
  const casos = [
    [['run', 'view', '1'], 'rest'], [['workflow', 'run', 'x.yml'], 'rest'], [['secret', 'set', 'A'], 'rest'],
    [['api', 'repos/o/r/issues/3', '--jq', '.body'], 'rest'], [['api', '/repos/o/r/rules'], 'rest'],
    [['api', '-X', 'POST', 'repos/o/r/issues'], 'rest'],
    [['issue', 'list'], 'graphql'], [['pr', 'create', '--fill'], 'graphql'], [['label', 'list'], 'graphql'],
    [['api', 'graphql', '-f', 'query={ rateLimit { cost } }'], 'graphql'],
    [['-R', 'o/r', 'pr', 'view', '3'], 'graphql'], [['--repo', 'o/r', 'run', 'list'], 'rest'],
    [['api', 'rate_limit'], 'unknown'], [['api', 'user'], 'unknown'], [['auth', 'status'], 'unknown'], [['release', 'list'], 'unknown'],
    [['api'], 'unknown'], [[], 'unknown'], [['--version'], 'unknown'], [['constructor'], 'unknown'], [['__proto__'], 'unknown'],
  ];
  for (const [args, esperado] of casos) assert.equal(clasificarApi(args), esperado, args.join(' '));
});

test('resultadoDe: exit 0 is ok; a rate limit message is limited; any other failure is error', () => {
  assert.equal(resultadoDe(0, 'a warning'), 'ok');
  assert.equal(resultadoDe(1, 'GraphQL: API rate limit already exceeded for user ID 1.'), 'limited');
  assert.equal(resultadoDe(1, 'You have exceeded a secondary rate limit'), 'limited');
  assert.equal(resultadoDe(1, 'HTTP 404: Not Found'), 'error');
  assert.equal(resultadoDe(null, ''), 'error');
});

test('registrarLlamada: one line with exactly t, caller, api and result', () => conRegistro((ruta) => {
  registrarLlamada({ caller: 'token.mjs', api: 'graphql', resultado: 'ok', ruta, reloj: () => AHORA });
  const [linea] = readFileSync(ruta, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(linea, { t: '2026-10-16T10:30:00.000Z', caller: 'token.mjs', api: 'graphql', result: 'ok' });
  assert.deepEqual(Object.keys(linea), CAMPOS);
}));

test('registrarLlamada: nothing outside the vocabulary can be written (paths, names, tokens, free text)', () => conRegistro((ruta) => {
  const intentos = [
    { caller: 'C:\\Users\\pablo\\x.mjs', api: 'rest', resultado: 'ok' },
    { caller: '/home/pablo/x.mjs', api: 'rest', resultado: 'ok' },
    { caller: 'dos palabras', api: 'rest', resultado: 'ok' },
    { caller: 'ghs_aaaa bbbb', api: 'rest', resultado: 'ok' },
    { caller: '', api: 'rest', resultado: 'ok' },
    { caller: 'token.mjs', api: 'repos/o/r', resultado: 'ok' },
    { caller: 'token.mjs', api: 'GraphQL', resultado: 'ok' },
    { caller: 'token.mjs', api: 'rest', resultado: 'HTTP 404: Not Found' },
    { caller: 'token.mjs', api: 'rest', resultado: 'ghs_secreto' },
    { caller: 'token.mjs', api: undefined, resultado: undefined },
  ];
  for (const i of intentos) assert.throws(() => registrarLlamada({ ...i, ruta }), /outside the vocabulary/, JSON.stringify(i));
  assert.throws(() => readFileSync(ruta), { code: 'ENOENT' });
}));

test('contarLlamadas: per api and per hour; limited apart; no file is no calls', () => conRegistro((ruta) => {
  assert.deepEqual(contarLlamadas({ ruta }), { total: { rest: 0, graphql: 0, unknown: 0 }, limited: 0, porHora: {} });
  const reg = (api, resultado, ms) => registrarLlamada({ caller: 'token.mjs', api, resultado, ruta, reloj: () => AHORA + ms });
  reg('graphql', 'ok', 0); reg('graphql', 'limited', 60_000); reg('rest', 'ok', 120_000); reg('unknown', 'error', 130_000);
  reg('graphql', 'ok', 40 * 60_000); // 11:10 UTC, the next hour
  assert.deepEqual(contarLlamadas({ ruta }), {
    total: { rest: 1, graphql: 3, unknown: 1 },
    limited: 1,
    porHora: {
      '2026-10-16T10': { rest: 1, graphql: 2, unknown: 1 },
      '2026-10-16T11': { rest: 0, graphql: 1, unknown: 0 },
    },
  });
}));

test('contarLlamadas: a broken line or a value outside the vocabulary throws instead of giving a wrong number', () => conRegistro((ruta) => {
  registrarLlamada({ caller: 'token.mjs', api: 'rest', resultado: 'ok', ruta });
  const bueno = readFileSync(ruta, 'utf8');
  writeFileSync(ruta, `${bueno}{roto\n`);
  assert.throws(() => contarLlamadas({ ruta }), /line 2 is not JSON/);
  writeFileSync(ruta, `${bueno}${JSON.stringify({ t: '2026-10-16T10:00:00.000Z', caller: 'x', api: 'soap', result: 'ok' })}\n`);
  assert.throws(() => contarLlamadas({ ruta }), /line 2 has the wrong shape/);
}));
