// The ruleset window (scripts/ventana.mjs) against a simulated GitHub (test/fixtures/github-ventana.mjs): no network,
// no token. The state file is in a temp directory. Each rule has a test that fails if the rule is removed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../scripts/ventana.mjs';
import { EXIT } from '../scripts/lib/ventana.mjs';
import { makeGithub, REPO } from './fixtures/github-ventana.mjs';

function go(argv, sim, path) {
  const out = [];
  const err = [];
  const code = main(argv, { run: sim.run, repo: REPO, path, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

function withState(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ventana-'));
  try {
    return fn(join(dir, 'ventana.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const saved = (path) => JSON.parse(readFileSync(path, 'utf8')).prs;

test('abrir disarms every armed PR, saves the list outside the repo, and prints armed: 0 and the Madrid time', () => withState((path) => {
  const sim = makeGithub({ prs: [{ number: 5, armed: true }, { number: 7, armed: true }, { number: 9 }] });
  const r = go(['abrir'], sim, path);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(sim.armed(), []);
  assert.deepEqual(saved(path), [5, 7]);
  assert.match(r.out, /armed: 0/);
  assert.match(r.out, /time \(Madrid\): /);
}));

test('abrir never touches the ruleset (not even a read) and uses one REST list, no GraphQL', () => withState((path) => {
  const sim = makeGithub({ prs: [{ number: 5, armed: true }] });
  go(['abrir'], sim, path);
  assert.deepEqual(sim.calls.filter((c) => /ruleset|graphql/.test(c)), []);
  assert.equal(sim.calls.filter((c) => c.startsWith('api ')).length, 2, 'one list before and one after');
}));

test('abrir is repeatable: the second run joins the list instead of replacing it', () => withState((path) => {
  const sim = makeGithub({ prs: [{ number: 5, armed: true }, { number: 7 }] });
  go(['abrir'], sim, path);
  sim.prs.get(7).armed = true;
  const r = go(['abrir'], sim, path);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(saved(path), [5, 7]);
  assert.deepEqual(sim.armed(), []);
}));

test('abrir fails loud, with the number, if a PR stays armed', () => withState((path) => {
  const sim = makeGithub({ prs: [{ number: 5, armed: true }], failDisarm: [5] });
  const r = go(['abrir'], sim, path);
  assert.equal(r.code, EXIT['still-armed']);
  assert.match(r.out, /PROBLEM \[still-armed\].*#5/);
  assert.match(r.out, /armed: 1/);
}));

test('abrir detects a PR armed between the list and the check (born armed inside the window)', () => withState((path) => {
  const sim = makeGithub({
    prs: [{ number: 5, armed: true }, { number: 8 }],
    onCall: (line, s) => { if (line === 'pr merge 5 --repo factory-am89/fabrica --disable-auto') s.prs.get(8).armed = true; },
  });
  const r = go(['abrir'], sim, path);
  assert.equal(r.code, EXIT['still-armed']);
  assert.match(r.out, /#8/);
}));

test('a broken state file stops both commands, says so, and is left as it was', () => withState((path) => {
  for (const content of ['{not json', '{"version":1,"repo":"x/y","prs":["a"]}', '[]']) {
    writeFileSync(path, content);
    const sim = makeGithub({ prs: [{ number: 5, armed: true }] });
    for (const cmd of ['abrir', 'cerrar']) {
      const r = go([cmd], sim, path);
      assert.equal(r.code, EXIT.state, `${cmd} with ${content}`);
      assert.match(r.err, /state file/);
    }
    assert.equal(readFileSync(path, 'utf8'), content);
    assert.deepEqual(sim.armed(), [5], 'nothing was disarmed or re-armed');
    assert.deepEqual(sim.calls, [], 'it does not even ask GitHub');
  }
}));

test('cerrar without a saved list fails (state)', () => withState((path) => {
  const r = go(['cerrar'], makeGithub(), path);
  assert.equal(r.code, EXIT.state);
  assert.match(r.err, /no saved list/);
}));

test('cerrar with the ruleset not active fails and re-arms nothing', () => withState((path) => {
  const sim = makeGithub({ prs: [{ number: 5, armed: true }] });
  go(['abrir'], sim, path);
  for (const enforcement of ['disabled', 'evaluate']) {
    sim.enforcement = enforcement;
    const r = go(['cerrar'], sim, path);
    assert.equal(r.code, EXIT['ruleset-not-active'], enforcement);
    assert.match(r.err, new RegExp(enforcement));
  }
  assert.deepEqual(sim.armed(), []);
  assert.equal(sim.calls.filter((c) => c.includes('--auto')).length, 0);
  assert.ok(existsSync(path), 'the list is kept for the next try');
}));

test('cerrar re-arms the saved PRs, skips merged, closed and revisor-red ones, and reports each', () => withState((path) => {
  const sim = makeGithub({
    prs: [{ number: 5, armed: true }, { number: 6, armed: true }, { number: 7, armed: true }, { number: 8, armed: true, revisor: 'failure' }, { number: 9, armed: true, revisor: 'success' }],
  });
  go(['abrir'], sim, path);
  sim.prs.get(6).merged = true;
  sim.prs.get(6).state = 'closed';
  sim.prs.get(7).state = 'closed';
  const r = go(['cerrar'], sim, path);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(sim.armed(), [5, 9]);
  assert.match(r.out, /rearmed #5/);
  assert.match(r.out, /rearmed #9/);
  assert.match(r.out, /skipped #6: already merged/);
  assert.match(r.out, /skipped #7: closed/);
  assert.match(r.out, /skipped #8: check revisor is red \(failure\)/);
  assert.ok(!existsSync(path), 'a clean close deletes the list');
}));

test('cerrar never re-arms a PR whose revisor is red, whatever the red conclusion', () => withState((path) => {
  for (const revisor of ['failure', 'cancelled', 'timed_out']) {
    const sim = makeGithub({ prs: [{ number: 5, armed: true, revisor }] });
    go(['abrir'], sim, path);
    go(['cerrar'], sim, path);
    assert.deepEqual(sim.armed(), [], revisor);
  }
}));

test('cerrar flags an armed PR that was not in the saved list, with its number', () => withState((path) => {
  const sim = makeGithub({ prs: [{ number: 5, armed: true }, { number: 12 }] });
  go(['abrir'], sim, path);
  sim.prs.get(12).armed = true;
  const r = go(['cerrar'], sim, path);
  assert.equal(r.code, EXIT['born-in-window']);
  assert.match(r.out, /PROBLEM \[born-in-window\].*#12/);
  assert.ok(existsSync(path), 'the list stays while there is a problem');
}));

test('cerrar only reads the ruleset (the one call to rulesets is a plain GET)', () => withState((path) => {
  const sim = makeGithub({ prs: [{ number: 5, armed: true }] });
  go(['abrir'], sim, path);
  go(['cerrar'], sim, path);
  assert.deepEqual(sim.calls.filter((c) => /ruleset/.test(c)), [`api repos/${REPO}/rulesets`]);
}));

test('usage: no command, an unknown one, or two give exit 2; --json prints one JSON object', () => withState((path) => {
  const sim = makeGithub({ prs: [{ number: 5, armed: true }] });
  for (const argv of [[], ['abrirr'], ['abrir', 'cerrar']]) assert.equal(go(argv, sim, path).code, EXIT.usage, argv.join(' '));
  const r = go(['abrir', '--json'], sim, path);
  const j = JSON.parse(r.out);
  assert.equal(j.ok, true);
  assert.equal(j.armed, 0);
  assert.deepEqual(j.saved, [5]);
}));

test('every exit class has its own distinct, non-zero code', () => {
  const codes = Object.values(EXIT);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(codes.every((c) => c >= 2));
});
