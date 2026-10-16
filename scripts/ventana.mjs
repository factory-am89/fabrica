// The ruleset window around Pablo's pause of `main`. Usage: node scripts/ventana.mjs abrir|cerrar [--json]
//   abrir   BEFORE pausing: saves the PRs with auto-merge armed, disarms them all, and fails if any stays armed.
//   cerrar  AFTER the ruleset is back: only if it is «active», re-arms the saved PRs (never one with `revisor` red).
// It never lifts or edits the ruleset. Exit codes per class: EXIT in lib/ventana.mjs. Needs the App session (scripts/token.mjs).
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { TOKEN } from './lib/identidades.mjs';
import { REPO } from './lib/repo.mjs';
import { abrir, cerrar, EXIT, VentanaError } from './lib/ventana.mjs';

const COMMANDS = { abrir, cerrar };

export const tokenRun = (args) => {
  const r = spawnSync(process.execPath, [TOKEN, '--', 'gh', ...args], { encoding: 'utf8' });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.error ? r.error.message : (r.stderr ?? '') };
};

function render(result) {
  const lines = [];
  if (result.command === 'abrir') {
    lines.push(`saved: ${result.saved.map((n) => `#${n}`).join(' ') || 'none'}`, `disarmed: ${result.disarmed.length}`, `armed: ${result.armed}`);
  } else {
    lines.push(...result.rearmed.map((n) => `rearmed #${n}`), ...result.skipped.map((s) => `skipped #${s.pr}: ${s.reason}`), `rearmed: ${result.rearmed.length}`);
  }
  lines.push(`time (Madrid): ${result.time}`, ...result.problems.map((p) => `PROBLEM [${p.clase}] ${p.message}`));
  return lines.join('\n');
}

export function main(argv, { run = tokenRun, repo = process.env.FABRICA_REPO ?? REPO, out = (s) => console.log(s), err = (s) => console.error(s), ...rest } = {}) {
  const json = argv.includes('--json');
  const words = argv.filter((a) => a !== '--json');
  if (words.length !== 1 || !Object.hasOwn(COMMANDS, words[0])) {
    err('usage: node scripts/ventana.mjs abrir|cerrar [--json]');
    return EXIT.usage;
  }
  try {
    const result = COMMANDS[words[0]]({ run, repo, ...rest });
    out(json ? JSON.stringify({ ok: !result.problems.length, ...result }) : render(result));
    return result.problems.length ? EXIT[result.problems[0].clase] : 0;
  } catch (e) {
    if (!(e instanceof VentanaError)) throw e;
    if (json) out(JSON.stringify({ ok: false, command: words[0], clase: e.clase, message: e.message }));
    else err(`ventana ${words[0]}: [${e.clase}] ${e.message}`);
    return EXIT[e.clase];
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
