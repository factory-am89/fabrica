// What this list covers: the gate workflows (revisor.yml, tests.yml, anulacion.yml and its trigger senal-review.yml), everything they take from
// .fabrica/ (scripts, the standard, the reviewer role, the lint config, package files; run, env, with,
// claude_args and prompt), and the relative imports of those scripts. test/gate-files.test.js derives
// that set from the workflows and requires this list to equal it plus ADMIN_GATE_FILES below.
// What it does NOT cover: the test files that `npm test` runs in this repo (only test/workflows.test.js,
// which tests.yml runs from .fabrica/, is listed), nor paths built at run time or under a relative
// `working-directory`. Paths are relative to the repo root.
//
// Readers: the brake against changes to the gate (next piece: a PR must not fetch questions or tests
// of the gate from its own branch) and piece 5. Nothing reads it yet.
//
// Note: revisor.yml runs on pull_request_target, so it always runs as it is on main; tests.yml runs
// on pull_request, so in this repo it runs as the PR has it. Both are listed because both define a check.
const BASE = [
  '.github/workflows/revisor.yml', // defines the `revisor` check and downloads the judge
  '.github/workflows/anulacion.yml', // the owner override: publishes the `revisor` check from main when Pablo approves the head
  '.github/workflows/senal-review.yml', // wakes anulacion.yml on a review; inert, no secrets
  '.github/workflows/tests.yml', // defines the `tests` check (also reusable by other repos)
  'scripts/veredicto.mjs', // turns the reviewer output into the verdict; run from .fabrica/
  'scripts/lib/questions.mjs', // imported by scripts/veredicto.mjs: the only reader of the questions
  'scripts/lib/record.mjs', // imported by scripts/veredicto.mjs: the verdict record schema and its writer
  'scripts/lib/golden-guard.mjs', // imported by scripts/veredicto.mjs: the brake on a PR that weakens the golden corpus
  'standards/code.md', // the questions the verdict is built from (read by veredicto.mjs)
  '.claude/agents/revisor.md', // the reviewer role the revisor.yml prompt tells Claude to follow
  'eslint.config.js', // lint rules tests.yml applies from .fabrica/ (C1, C3)
  'test/workflows.test.js', // machine rules (C4) tests.yml runs from .fabrica/
  'scripts/lib/actions.mjs', // imported by test/workflows.test.js
  'scripts/lib/repo.mjs', // imported by scripts/lib/actions.mjs
  'scripts/pr-body.mjs', // PR body check tests.yml runs from .fabrica/
  'scripts/lib/pr-body.mjs', // imported by scripts/pr-body.mjs
  'scripts/lib/decision.mjs', // imported by scripts/lib/pr-body.mjs: the only reader of a decision line
  'scripts/check-plan.mjs', // plan PR check tests.yml runs from .fabrica/
  'scripts/lib/plan.mjs', // imported by scripts/check-plan.mjs
  'scripts/lib/intervention.mjs', // imported by scripts/check-plan.mjs: the closed list of paths
  'scripts/lib/gate.mjs', // imported by scripts/check-plan.mjs: this list
  'package.json', // tests.yml runs `npm ci --prefix .fabrica`
  'package-lock.json', // same: npm ci installs exactly this
];

// The administrator App key (plan-app-admin, piece 2): whoever can change these files can change what that key does,
// so they are gate files too. They are not used by the two gate workflows, so test/gate-files.test.js does not derive them;
// it requires them here by name. The workflow and scripts/admin/ do not exist yet: the guard (test/administrador.test.js)
// goes first on purpose. 'scripts/admin/' ends in '/': every file under that folder (the convention scripts/lib/plan.mjs matchesAny understands).
export const ADMIN_GATE_FILES = [
  '.github/workflows/administrar.yml', // the only workflow allowed to name the administrator secrets
  'scripts/admin/', // the code that runs with that key
  'test/administrador.test.js', // the machine guard on the two above
];

export const GATE_FILES = [...BASE, ...ADMIN_GATE_FILES];
