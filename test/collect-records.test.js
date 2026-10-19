import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collect, getWithToken, listPulls, parseArgs, writeOut } from '../scripts/collect-records.mjs';
import { REPO as FABRICA } from '../scripts/lib/repo.mjs';
import { aggregate, formatBlock, readCheckRuns, buildRecord } from '../scripts/lib/record.mjs';

const REPO = 'o/r';
const sha = (n) => String(n).repeat(40).slice(0, 40);
const record = (pr, n, ok) => buildRecord({ repo: REPO, pr, sha: sha(n), standard: 'standards/code.md', veredicto: { ok }, respuestas: { answers: { C5: ok ? 'sí' : 'no' }, invalid: 0 }, run: null });
const run = (id, pr, n, ok) => ({ id, output: { title: `Veredicto: ${ok ? 'sí' : 'no'}`, text: formatBlock(record(pr, n, ok)) } });
const pull = (number, created) => ({ number, state: 'open', created_at: created, merged_at: null, head: { ref: `fix/pr-${number}` } });
const FILES = { 1: ['a.js', 'b.js'], 2: ['c.js'], 3: [] };

// A fake GitHub: PR 1 has two commits (round 1 "no", round 2 "sí"), PR 2 has one, PR 3 is old and has no check-run.
function fakeGet(calls = []) {
  const runs = { [sha(1)]: [run(11, 1, 1, false)], [sha(2)]: [run(12, 1, 2, true)], [sha(3)]: [run(13, 2, 3, true)], [sha(4)]: [] };
  const commits = { 1: [sha(1), sha(2)], 2: [sha(3)], 3: [sha(4)] };
  return async (route) => {
    calls.push(route);
    if (route.startsWith(`repos/${REPO}/pulls?`)) return [pull(2, '2026-10-16T10:00:00Z'), pull(1, '2026-10-15T10:00:00Z'), pull(3, '2026-10-01T10:00:00Z')];
    const f = route.match(/pulls\/(\d)\/files/);
    if (f) return FILES[f[1]].map((filename) => ({ filename }));
    const m = route.match(/pulls\/(\d)\/commits/);
    if (m) return commits[m[1]].map((s) => ({ sha: s }));
    const c = route.match(/commits\/([0-9a-f]{40})\/check-runs\?check_name=revisor/);
    if (c) return { total_count: runs[c[1]].length, check_runs: runs[c[1]] };
    throw new Error(`unexpected route ${route}`);
  };
}

test('collect reads the revisor check-runs of every commit of each PR, so earlier rounds count', async () => {
  const { pulls, checkRuns } = await collect({ get: fakeGet(), repo: REPO });
  assert.deepEqual(pulls.map((p) => [p.number, p.commits.length]), [[2, 1], [1, 2], [3, 1]]);
  assert.equal(checkRuns.length, 3);
  const { records, unreadable } = readCheckRuns(checkRuns);
  assert.equal(unreadable.length, 0);
  const { porPr } = aggregate(records);
  assert.equal(porPr[`${REPO}#1`].rondas, 2);
  assert.equal(porPr[`${REPO}#1`].no, 1);
});

test('collect asks for one check-runs page per commit and only the revisor', async () => {
  const calls = [];
  await collect({ get: fakeGet(calls), repo: REPO });
  const checks = calls.filter((c) => c.includes('/check-runs'));
  assert.equal(checks.length, 4);
  assert.ok(checks.every((c) => c.includes('check_name=revisor')));
});

test('collect keeps the branch (head.ref) and the files of each PR, and does not touch the check-runs', async () => {
  const { pulls, checkRuns } = await collect({ get: fakeGet(), repo: REPO });
  assert.deepEqual(pulls.map((p) => [p.number, p.head_ref, p.files]), [[2, 'fix/pr-2', ['c.js']], [1, 'fix/pr-1', ['a.js', 'b.js']], [3, 'fix/pr-3', []]]);
  assert.equal(checkRuns.length, 3);
  assert.ok(checkRuns.every((c) => !('files' in c) && !('head_ref' in c)));
});

test('a PR without head.ref throws instead of being recorded without a branch', async () => {
  const get = async (route) => (route.includes('/pulls?') ? [{ number: 1, state: 'open', created_at: '2026-10-15T10:00:00Z', merged_at: null }] : []);
  await assert.rejects(collect({ get, repo: REPO }), /head\.ref/);
});

test('--since leaves out the PRs created before it', async () => {
  const { pulls } = await collect({ get: fakeGet(), repo: REPO, since: '2026-10-15' });
  assert.deepEqual(pulls.map((p) => p.number), [2, 1]);
  await assert.rejects(listPulls(fakeGet(), REPO, '15/10/2026'), /YYYY-MM-DD/);
});

test('a check-run seen twice is kept once', async () => {
  const get = async (route) => {
    if (route.includes('/pulls?')) return [pull(1, '2026-10-15T10:00:00Z')];
    if (route.includes('/files?')) return [];
    if (route.includes('/commits?')) return [{ sha: sha(1) }, { sha: sha(2) }];
    return { total_count: 1, check_runs: [run(11, 1, 1, true)] };
  };
  assert.equal((await collect({ get, repo: REPO })).checkRuns.length, 1);
});

test('a cut check-runs answer throws instead of passing for the whole', async () => {
  const get = async (route) => {
    if (route.includes('/pulls?')) return [pull(1, '2026-10-15T10:00:00Z')];
    if (route.includes('/files?')) return [];
    if (route.includes('/commits?')) return [{ sha: sha(1) }];
    return { total_count: 150, check_runs: [run(11, 1, 1, true)] };
  };
  await assert.rejects(collect({ get, repo: REPO }), /cut or malformed/);
});

test('a failing GET stops the whole collection', async () => {
  const get = async () => {
    throw new Error('GET boom');
  };
  await assert.rejects(collect({ get, repo: REPO }), /boom/);
});

test('a full page asks for the next one; a list that never ends throws', async () => {
  const full = Array.from({ length: 100 }, (_, i) => pull(i + 1, '2026-10-15T10:00:00Z'));
  const calls = [];
  const two = async (route) => {
    calls.push(route);
    return route.endsWith('&page=1') ? full : [];
  };
  assert.equal((await listPulls(two, REPO, null)).length, 100);
  assert.equal(calls.length, 2);
  await assert.rejects(listPulls(async () => full, REPO, null), /refusing to cut/);
});

test('writeOut leaves pulls.json and check-runs.json that records.mjs can read', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'collect-records-'));
  try {
    const datos = await collect({ get: fakeGet(), repo: REPO });
    writeOut(path.join(dir, 'sub'), datos);
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'sub', 'pulls.json'), 'utf8')).length, 3);
    const runs = JSON.parse(readFileSync(path.join(dir, 'sub', 'check-runs.json'), 'utf8'));
    assert.equal(readCheckRuns(runs).records.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getWithToken goes through token.mjs, parses the JSON and reports a failure with its route', () => {
  let args;
  const ok = getWithToken('repos/o/r/pulls', (cmd, a) => {
    args = a;
    return { status: 0, stdout: '[1]', stderr: '' };
  });
  assert.deepEqual(ok, [1]);
  assert.deepEqual(args.slice(1), ['--', 'gh', 'api', 'repos/o/r/pulls']);
  assert.match(args[0], /token\.mjs$/);
  assert.throws(() => getWithToken('x', () => ({ status: 1, stdout: '', stderr: 'HTTP 403' })), /GET x failed \(exit 1\): HTTP 403/);
  assert.throws(() => getWithToken('x', () => ({ status: 0, stdout: 'no json', stderr: '' })), /not JSON/);
  assert.throws(() => getWithToken('x', () => ({ error: new Error('spawn'), status: null })), /spawn/);
});

test('parseArgs requires --out and rejects anything unknown', () => {
  assert.deepEqual(parseArgs(['--out', 'd', '--since', '2026-10-01']), { out: 'd', since: '2026-10-01', repo: FABRICA });
  assert.throws(() => parseArgs([]), /--out/);
  assert.throws(() => parseArgs(['--out', 'd', '--bad', 'x']), /usage/);
  assert.throws(() => parseArgs(['--out']), /usage/);
});
