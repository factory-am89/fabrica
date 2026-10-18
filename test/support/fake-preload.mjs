// Preload for end-to-end runs of scripts/token.mjs with no real `op` and no network: every `op` call is
// counted (one line appended to FALSO_CONTADOR) and answered with the throwaway key in FALSO_PEM (or, if FALSO_STDERR is set, with a failure whose stderr is that text), and
// fetch answers like GitHub would. Any other command runs for real.
import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const real = childProcess.spawnSync;
childProcess.spawnSync = (cmd, ...resto) => {
  if (cmd !== 'op') return real(cmd, ...resto);
  appendFileSync(process.env.FALSO_CONTADOR, 'op\n');
  if (process.env.FALSO_STDERR) return { status: 1, stdout: '', stderr: process.env.FALSO_STDERR };
  return { status: 0, stdout: process.env.FALSO_PEM, stderr: '' };
};
syncBuiltinESMExports();

globalThis.fetch = async (url) => {
  const cuerpo = String(url).endsWith('/installation')
    ? { id: 77 }
    : { token: `ghs_${'a1B2c3D4'.repeat(5)}`, expires_at: new Date(Date.now() + 3600_000).toISOString() };
  return { ok: true, status: 200, json: async () => cuerpo };
};
