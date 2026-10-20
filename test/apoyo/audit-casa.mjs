// A throwaway home for the tests that run scripts/audit.mjs as a process: the real entry records its pass in ~/.fabrica (passesPath), and a
// test must never write there (a pass recorded by a test would reset the days that the goals debt counts).
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { passesPath } from '../../scripts/lib/goals-debt.mjs';

// { env, file }: `env` makes os.homedir() the throwaway folder (USERPROFILE on Windows, HOME elsewhere); `file` is where the pass lands.
export function casaDeAudit(t) {
  const casa = mkdtempSync(path.join(tmpdir(), 'fabrica-audit-casa-'));
  t.after(() => rmSync(casa, { recursive: true, force: true }));
  return { env: { ...process.env, USERPROFILE: casa, HOME: casa }, file: passesPath(() => casa), casa };
}

// The real file, to prove a test did not touch it.
export const realPassesFile = () => passesPath(homedir);
