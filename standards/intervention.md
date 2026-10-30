# Intervention: when an agent asks the owner

Principle 6 (CLAUDE.md) says to ask before a shortcut. This file is the closed list of what counts as one. Everything else an agent decides and writes down (a row in `intervenciones.md` when it is a decision of Pablo's).

This file decides when an agent asks before it starts. It does not decide merges: the `revisor` check keeps deciding every PR, also those that change the gate (Pablo's decision of 2026-10-15 in `intervenciones.md`).

## Who decides a merge

One source for this rule; the skill `github`, `PASOS-PABLO.md`, C13 of `standards/code.md` and `intervenciones.md` point here.

- The `revisor` check decides every merge, also of the gate (Pablo, 2026-10-15). Pausing, relaxing or deleting the ruleset of `main` is **prohibited, with no emergency exception** (decided by the coordinating session under Pablo's delegation, row of 2026-10-17 in `intervenciones.md`): pausing lets every armed PR in without the check, and the key of the administrator App (a key that can delete repos) would be one pushed workflow away. A machine enforces it: `test/ruleset-never-paused.test.js` fails if code under `apps/`, `scripts/` or `.github/` writes a ruleset whose `enforcement` is not `active` or sends DELETE to a rulesets endpoint.
- The only ways out of a wrong «no» are an owner's **Approve** on the PR (Files changed tab) or a fix PR that the current judge can pass; nothing else, and never a pause. In the Fábrica the only owner is Pablo; in another repo, the owners it passes (next point). A machine checks it, not a sentence: `anulacion.yml` (runs from `main`; `senal-review.yml` only wakes it) calls `aprobacionDe` in `scripts/veredicto.mjs`, which counts a review only if its author is `OWNER_LOGIN` (`scripts/lib/repo.mjs`), his latest decisive review (approved, changes requested, dismissed) is an approval, and its `commit_id` is the current head. A push after it, another author or a dismissed review do not override.
- Another repo that calls `anulacion.yml` may pass its owners with the input `duenos` (each login with the Apps its sessions use; Pablo's decision B, option 1, row of 2026-10-29 in `intervenciones.md`). Then `aprobacionDeDueno` counts the approval of any of them with the same three conditions, and never on their own work: not if the PR was opened by that owner or by one of their Apps (four eyes). Without the input, as in the Fábrica itself, only `OWNER_LOGIN` overrides. In another repo the judgment (`revisor.yml`) does not apply an approval given before its verdict, because it does not get `duenos`: the owner approves again after the «no».
- The result is the `revisor` check in green titled «override by <login>» (`overrideTitle` in `scripts/lib/record.mjs`; before 2026-10-30, «override by Pablo»), listing the findings it overrides. `node scripts/records.mjs` counts both as `overrides`.
- `OWNER_LOGIN` is `pabloam89`, the owner account. Checked on 2026-10-16: `gh api repos/factory-am89/fabrica/collaborators/pabloam89/permission --jq .permission` printed `admin`.
- Why the reviewer may accept this widening (C13): Pablo decided it (the rows of 2026-10-16 in `intervenciones.md`, PR #63: «Decidida, pendiente de implementar en el PR #61»), and the machine limits it to his login, the current head and his latest decisive review; `test/anulacion.test.js` goes red if any of the three is removed. The widening to several owners in another repo is Pablo's decision B1 (2026-10-29); it keeps the three conditions, adds the four-eyes one, and `test/anulacion-duenos.test.js` goes red if it is removed.

## Who answers

Who answers the residue depends on the repo the session works on (Pablo's decision B, option 1, row of 2026-10-29 in `intervenciones.md`; `plans/puente-2-alvaro.md`).

- In the Fábrica (`factory-am89/fabrica`: its gate, its Apps, its vault, its permissions) only Pablo (`OWNER_LOGIN`) answers.
- In HoMenu (`pabloam89/MenuPlan`) either of its two owners answers: Pablo (`pabloam89`) or Álvaro (`algbarc-design`). What only the GitHub admin of the repo can do (rulesets, App installations, collaborators, secrets) stays Pablo's.
- How to phrase a question for each one is in their personal layer, `usuario/personas/<login>.md`; each question is a row in `intervenciones.md`.
- This section says who answers before work starts. Who overrides a «no» is «Who decides a merge», above, and it does not change here.

## Classes

An agent stops and asks the owner who answers (above), in the terminal, before it does any of these:

- **Weaken a check**: lower a threshold, delete or relax a test, turn a «no» into a warning.
- **Bypass the gate**: the «Prohibido» line of `CLAUDE.md` says what is forbidden; here the agent asks the owner instead of doing it.
- **Change permissions or secrets**: same pointer, «Prohibido» in `CLAUDE.md`.
- **Do something irreversible**: delete data or history that cannot be recovered from git.

The «Qué requiere el OK de Pablo» sections of the skills are these four classes applied to each tool; they add none. How to phrase a question is in «Who answers», above.

## Closed paths

A plan chunk that changes a file matching one of these globs is marked as needing Pablo before it is built. `*` matches within one folder, `**` across folders. This block is read by `scripts/lib/intervention.mjs`; keep one glob per line and nothing else in it.

```closed-paths
apps/**
.github/workflows/**
CLAUDE.md
.claude/hooks/**
.claude/settings*.json
```

Not in the list on purpose: the rest of `.claude/` (skills and roles), which agents edit every day and the reviewer already judges. Only what runs by itself or grants permissions needs Pablo first.

This list says who decides before work starts. `GATE_FILES` (`scripts/lib/gate.mjs`) says which files make the gate, and C13 of `standards/code.md` says what the reviewer reads closely. They overlap on purpose and are not merged here.
