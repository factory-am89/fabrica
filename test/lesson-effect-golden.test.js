// audit --data (chunk 17): the questions the judge answers differently between trials of a golden-run pass, and how they reach the false-«no» indicator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliAudit } from '../scripts/audit.mjs';
import { CORPUS, STANDARD } from '../scripts/golden.mjs';
import { DATA_IDS } from '../scripts/lib/audit-data.mjs';
import { EXIT } from '../scripts/lib/exit.mjs';
import { unstableQuestions } from '../scripts/lib/lesson-effect.mjs';
import { CHECKED_BY } from '../scripts/lib/questions.mjs';
import { ANSWER } from '../scripts/lib/record.mjs';
import { cargarPreguntas } from '../scripts/veredicto.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECORDS = path.join(RAIZ, 'test', 'fixtures', 'audit', 'records.json');
const Q = 'C5';
const OTHER_Q = 'C1';
const reviewerIds = () => cargarPreguntas(STANDARD, RAIZ).filter((q) => q.quien === CHECKED_BY.reviewer).map((q) => q.id);
// The outputs of a golden pass (DIR/<case>/<n>.json) for the real corpus: every reviewer question yes, and `noOn` = [question, trial] says no.
function goldenOutputs(t, trials, noOn = []) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fabrica-golden-out-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ids = reviewerIds();
  for (const c of readdirSync(CORPUS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    mkdirSync(path.join(dir, c));
    for (let n = 1; n <= trials; n++) {
      const respuestas = ids.map((id) => ({ id, respuesta: noOn.some(([q, k]) => q === id && k === n) ? ANSWER.no : ANSWER.yes, prueba: 'x' }));
      writeFileSync(path.join(dir, c, `${n}.json`), JSON.stringify({ respuestas }));
    }
  }
  return dir;
}

const REVIEWED = reviewerIds().find((id) => id !== Q);
test('unstable questions: those whose answer changes between trials of the golden pass; one trial cannot show it', (t) => {
  assert.deepEqual(unstableQuestions(goldenOutputs(t, 2, [[Q, 2], [REVIEWED, 1]]), RAIZ), [Q, REVIEWED].sort());
  assert.deepEqual(unstableQuestions(goldenOutputs(t, 3), RAIZ), []);
  assert.throws(() => unstableQuestions(goldenOutputs(t, 1), RAIZ), /at least 2 are needed/);
});

test('false «no»: with --golden each question says if it is unstable, and the list is kept; the flag needs --records', (t) => {
  const dir = goldenOutputs(t, 2, [[Q, 2]]);
  const out = JSON.parse(cliAudit(['--json', '--data', '--records', RECORDS, '--golden', dir]).stdout)[DATA_IDS.falseNo];
  assert.deepEqual(out.unstableQuestions, [Q]);
  assert.deepEqual([out.byQuestion[Q].unstable, out.byQuestion[OTHER_Q].unstable], [true, false]);
  assert.equal(JSON.parse(cliAudit(['--json', '--data', '--records', RECORDS]).stdout)[DATA_IDS.falseNo].unstableQuestions, null);
  for (const argv of [['--data', '--repo', 'o/r', '--golden', dir], ['--golden', dir], ['--data', '--records', RECORDS, '--golden']]) assert.equal(cliAudit(argv).code, EXIT.USAGE, argv.join(' '));
});

