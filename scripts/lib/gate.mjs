// What this list covers: the two gate workflows (revisor.yml and tests.yml), everything they take from
// .fabrica/ (scripts, the standard, the reviewer role, the lint config, package files; run, env, with,
// claude_args and prompt), and the relative imports of those scripts. test/gate-files.test.js derives
// that set from the workflows and requires this list to equal it.
// What it does NOT cover: the test files that `npm test` runs in this repo (only test/workflows.test.js,
// which tests.yml runs from .fabrica/, is listed), nor paths built at run time or under a relative
// `working-directory`. Paths are relative to the repo root.
//
// Readers: the brake against changes to the gate (next piece: a PR must not fetch questions or tests
// of the gate from its own branch) and piece 5. Nothing reads it yet.
//
// Note: revisor.yml runs on pull_request_target, so it always runs as it is on main; tests.yml runs
// on pull_request, so in this repo it runs as the PR has it. Both are listed because both define a check.
export const GATE_FILES = [
  '.github/workflows/revisor.yml', // defines the `revisor` check and downloads the judge
  '.github/workflows/tests.yml', // defines the `tests` check (also reusable by other repos)
  'scripts/veredicto.mjs', // turns the reviewer output into the verdict; run from .fabrica/
  'standards/code.md', // the questions the verdict is built from (read by veredicto.mjs)
  '.claude/agents/revisor.md', // the reviewer role the revisor.yml prompt tells Claude to follow
  'eslint.config.js', // lint rules tests.yml applies from .fabrica/ (C1, C3)
  'test/workflows.test.js', // machine rules (C4) tests.yml runs from .fabrica/
  'scripts/lib/acciones.mjs', // imported by test/workflows.test.js
  'scripts/lib/repo.mjs', // imported by scripts/lib/acciones.mjs
  'scripts/pr-body.mjs', // PR body check tests.yml runs from .fabrica/
  'scripts/lib/pr-body.mjs', // imported by scripts/pr-body.mjs
  'package.json', // tests.yml runs `npm ci --prefix .fabrica`
  'package-lock.json', // same: npm ci installs exactly this
];
