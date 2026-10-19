// Writes the machine contract of the commands: scripts/lib/exit-codes.json, generated from the
// constants in scripts/lib/exit.mjs (EXIT and RETIRE_RESULT). Run it after changing either:
//   npm run contract
// A test compares the file with the constants, so a stale file turns the suite red.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXIT, RETIRE_RESULT, RECOVERY, RETRY } from './lib/exit.mjs';

export const CONTRACT_FILE = fileURLToPath(new URL('./lib/exit-codes.json', import.meta.url));

// Exact text of the file; the test compares it byte for byte with what is committed.
export const contractText = () => `${JSON.stringify({ EXIT, RETIRE_RESULT, RETRY, RECOVERY }, null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(CONTRACT_FILE, contractText());
  console.log(`contract written: ${CONTRACT_FILE}`);
}
