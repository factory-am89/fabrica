// scripts/reviewer-no.mjs --debt: the command line of the debt of «no». The fixture is test/fixtures/reviewer-no/records.json
// (--records) and a temp repo root (copy of the vocabulary sources plus a reviewer-no.json), removed in t.after.
// No network (--repo takes a fake download), no process spawned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from '../scripts/lib/exit.mjs';
import { DEBT_SINCE, KINDS, OUTCOME_NOISE, OUTCOME_PENDING, REVIEWER_NO_FILE, REVIEWER_NO_KEYS, REVIEWER_NO_VERSION } from '../scripts/lib/reviewer-no.mjs';
import { REPO } from '../scripts/lib/repo.mjs';
import { cliReviewerNo, downloadWithToken, mainReviewerNo } from '../scripts/reviewer-no.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECORDS = path.join(RAIZ, 'test', 'fixtures', 'reviewer-no', 'records.json');
const { source: SOURCE, question: QUESTION, kind: KIND, outcome: OUTCOME } = REVIEWER_NO_KEYS;
const row = (n, question, outcome = OUTCOME_PENDING) => ({ [SOURCE]: `#${n}`, [QUESTION]: question, [KIND]: KINDS[0], [OUTCOME]: outcome });
const debtArgs = (...more) => ['--debt', '--records', RECORDS, ...more];

// A root with the files the validator reads and the given content for reviewer-no.json.
function fixtureRoot(t, content) {
  const root = mkdtempSync(path.join(tmpdir(), 'fabrica-reviewerno-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(path.join(RAIZ, 'standards'), path.join(root, 'standards'), { recursive: true });
  cpSync(path.join(RAIZ, '.claude', 'agents'), path.join(root, '.claude', 'agents'), { recursive: true });
  writeFileSync(path.join(root, 'intervenciones.md'), '# header\n2026-01-01 | clic | a | b | repetida: no\n');
  writeFileSync(path.join(root, REVIEWER_NO_FILE), typeof content === 'string' ? content : JSON.stringify({ version: REVIEWER_NO_VERSION, rows: content }));
  return root;
}

test('good case, --json: one object; the «no» of the merged PR since DEBT_SINCE is missing, the old, open and clean ones are not', (t) => {
  const r = cliReviewerNo(debtArgs('--json', fixtureRoot(t, []))); // an empty registry: the real reviewer-no.json grows and must not decide this test
  assert.equal(r.code, EXIT.OK);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  const d = JSON.parse(r.stdout);
  assert.equal(d.ok, true);
  assert.equal(d.since, DEBT_SINCE);
  assert.deepEqual(d.missing, [{ pr: 10, question: 'C5' }, { pr: 10, question: 'C9' }]);
  assert.deepEqual([d.pending, d.unmatched], [[], []]);
});

test('rows of the file cover the pairs, are listed as pending, and a row without a «no» is unmatched', (t) => {
  const root = fixtureRoot(t, [row(10, 'C5'), row(12, 'C2'), row(10, 'C1')]);
  const d = JSON.parse(cliReviewerNo(debtArgs('--json', root)).stdout);
  assert.deepEqual(d.missing, [{ pr: 10, question: 'C9' }]);
  assert.deepEqual(d.pending.map((p) => `${p.pr}${p.question}`), ['10C5', '12C2', '10C1']);
  assert.deepEqual(d.unmatched, [{ pr: 10, question: 'C1' }]);
});

test('human text says the date the debt counts from, the missing pairs and the PR', (t) => {
  const r = cliReviewerNo(debtArgs(fixtureRoot(t, [])));
  assert.equal(r.code, EXIT.OK);
  assert.match(r.stdout, new RegExp(DEBT_SINCE));
  assert.match(r.stdout, /missing: 2/);
  assert.match(r.stdout, /#10 C5/);
});

test('no debt: the human text says so', (t) => {
  const root = fixtureRoot(t, [row(10, 'C5')]);
  const none = fixtureRoot(t, [row(10, 'C5', OUTCOME_NOISE), row(10, 'C9', OUTCOME_NOISE)]);
  assert.match(cliReviewerNo(debtArgs(root)).stdout, /missing: 1/);
  assert.match(cliReviewerNo(debtArgs(none)).stdout, /sin deuda/);
});

test('a reviewer-no.json with faults: the dedicated exit code, the fault codes listed, human and json', (t) => {
  const root = fixtureRoot(t, '{"version": 1,');
  const h = cliReviewerNo(debtArgs(root));
  assert.equal(h.code, EXIT.REVIEWER_NO_FAULTS);
  assert.match(h.stderr, /REVIEWER_NO_NOT_JSON/);
  const j = cliReviewerNo(debtArgs('--json', root));
  assert.equal(j.code, EXIT.REVIEWER_NO_FAULTS);
  const d = JSON.parse(j.stdout);
  assert.equal(d.ok, false);
  assert.equal(d.error, 'REVIEWER_NO_FAULTS');
  assert.equal(d.exit, EXIT.REVIEWER_NO_FAULTS);
});

test('a round with an error is shown by the command, in human and json, and does not count as debt', (t) => {
  const records = JSON.parse(readFileSync(RECORDS, 'utf8'));
  const record = { v: 1, repo: 'o/r', pr: 13, sha: 'e'.repeat(40), standard: null, ok: false, answers: {}, invalid: 0, error: 'output-unreadable', run: null };
  records.checkRuns.push({ head_sha: record.sha, output: { title: 'x', summary: 'x', text: `\`\`\`json\n${JSON.stringify(record)}\n\`\`\`` } });
  const dir = mkdtempSync(path.join(tmpdir(), 'fabrica-reviewerno-recs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'records.json');
  writeFileSync(file, JSON.stringify(records));
  const j = cliReviewerNo(['--debt', '--records', file, '--json']);
  assert.deepEqual(JSON.parse(j.stdout).errored, [{ pr: 13, error: 'output-unreadable' }]);
  assert.match(cliReviewerNo(['--debt', '--records', file]).stdout, /errored: 1\n {2}#13 output-unreadable/);
  assert.match(cliReviewerNo(debtArgs()).stdout, /errored: 0/);
});

test('a check-run without a readable record stops the command with an error, no debt printed', (t) => {
  const records = JSON.parse(readFileSync(RECORDS, 'utf8'));
  records.checkRuns.push({ head_sha: 'f'.repeat(40), output: { title: 'x', summary: 'x', text: 'nothing' } });
  const dir = mkdtempSync(path.join(tmpdir(), 'fabrica-reviewerno-recs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'records.json');
  writeFileSync(file, JSON.stringify(records));
  const r = cliReviewerNo(['--debt', '--records', file, '--json']);
  assert.equal(r.code, EXIT.REVIEWER_NO_UNREADABLE);
  assert.match(r.stderr, /without a readable record/);
  const d = JSON.parse(r.stdout);
  assert.equal(d.ok, false);
  assert.equal(d.error, 'REVIEWER_NO_UNREADABLE');
});

test('an unreadable check-run of a PR the debt does not count is shown as ignored (human and json); one of a counted PR stops with its own code', (t) => {
  const withBroken = (sha) => {
    const records = JSON.parse(readFileSync(RECORDS, 'utf8'));
    records.checkRuns.push({ head_sha: sha, output: { title: 'x', summary: 'x', text: 'nothing' } });
    const dir = mkdtempSync(path.join(tmpdir(), 'fabrica-reviewerno-recs-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'records.json');
    writeFileSync(file, JSON.stringify(records));
    return file;
  };
  const old = withBroken('3'.repeat(40)); // PR 11, merged before DEBT_SINCE
  assert.deepEqual(JSON.parse(cliReviewerNo(['--debt', '--records', old, '--json']).stdout).ignored, [{ pr: 11, checkRuns: 1 }]);
  assert.match(cliReviewerNo(['--debt', '--records', old]).stdout, /ignored: 1 check-runs without a record, in 1 PRs the debt does not count \(#11\.\.#11\)/);
  assert.match(cliReviewerNo(debtArgs()).stdout, /ignored: 0 check-runs/);
  assert.equal(cliReviewerNo(['--debt', '--records', withBroken('1'.repeat(40)), '--json']).code, EXIT.REVIEWER_NO_UNREADABLE); // PR 10, counted
});

test('usage: --debt is required, and exactly one of --records or --repo; a flag without value is refused', async () => {
  for (const argv of [['--records', RECORDS], ['--debt'], ['--debt', '--records', RECORDS, '--repo', REPO], ['--debt', '--records']]) {
    assert.equal(cliReviewerNo(argv).code, EXIT.USAGE, argv.join(' '));
  }
  assert.equal((await mainReviewerNo(['--debt'], async () => { throw new Error('must not be called'); })).code, EXIT.USAGE);
});

test('the real download keeps a PR created long before DEBT_SINCE and merged after it (collect is called without --since)', async () => {
  const old = { number: 7, state: 'closed', created_at: '2026-09-01T10:00:00Z', merged_at: '2026-10-20T10:00:00Z', head: { ref: 'feat/old' } };
  const get = async (route) => {
    if (route.includes('/pulls?')) return [old];
    if (route.includes('/actions/workflows/')) return { workflow_runs: [], total_count: 0 };
    return [];
  };
  const data = await downloadWithToken(REPO, get);
  assert.deepEqual(data.pulls.map((p) => p.number), [7]);
});

test('--repo downloads that repo without --since (a PR created before and merged after must come), and a failed download is GH_FAILED', async () => {
  const calls = [];
  const data = JSON.parse(readFileSync(RECORDS, 'utf8'));
  const ok = await mainReviewerNo(['--debt', '--repo', REPO, '--json'], async (...args) => { calls.push(args); return data; });
  assert.equal(ok.code, EXIT.OK);
  assert.deepEqual(calls, [[REPO]]);
  assert.equal(JSON.parse(ok.stdout).missing.length, 2);
  const bad = await mainReviewerNo(['--debt', '--repo', REPO, '--json'], async () => { throw new Error('boom'); });
  assert.equal(bad.code, EXIT.GH_FAILED);
  assert.equal(JSON.parse(bad.stdout).error, 'GH_FAILED');
});
