// The no-per-kind indicator of scripts/audit.mjs, measured from the throwaway root of test/apoyo/audit-raiz.mjs (three rows:
// a lesson made by its PR, a relapse on the same lesson, and a pending one of kind otro). Own file: test/audit.test.js is at the limit of lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { INDICATORS, audit, humanLocal } from '../scripts/audit.mjs';
import { fixture } from './apoyo/audit-raiz.mjs';
import { KINDS, OUTCOME_GROUPS, OUTCOME_PENDING, REVIEWER_NO_FILE } from '../scripts/lib/reviewer-no.mjs';

const run = (root) => audit(root, { logPath: path.join(root, 'no-such-log.jsonl') });

test('no-per-kind: the rows of reviewer-no.json come by kind, outcome, kind x question, notes and relapses, in JSON and in text', (t) => {
  const r = run(fixture(t));
  const n = r[INDICATORS.noPerKind];
  assert.equal(n.total, 3);
  assert.equal(n.byKind[KINDS[0]], 2);
  assert.deepEqual([n.byOutcome[OUTCOME_GROUPS.lessonNew], n.byOutcome[OUTCOME_GROUPS.lessonExisting], n.byOutcome[OUTCOME_PENDING]], [1, 1, 1]);
  assert.deepEqual(n.byKindQuestion[KINDS[0]], { C1: 1, C2: 1 });
  assert.deepEqual(n.relapses.map((x) => [x.pr, x.lesson]), [[2, 'a']]);
  assert.deepEqual(n.otherNotes.map((x) => x.note), ['nueva clase']);
  const lines = humanLocal(r).split('\n');
  assert.ok(lines.includes(`${INDICATORS.noPerKind}: 3 rows, ${n.relapses.length} relapses, ${n.otherNotes.length} notes of otro`));
});

test('no-per-kind: a root without reviewer-no.json stops the audit, it is never read as «no cases»', (t) => {
  const root = fixture(t);
  rmSync(path.join(root, REVIEWER_NO_FILE));
  assert.throws(() => run(root), /not found/);
});
