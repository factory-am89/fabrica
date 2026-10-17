# Intervention: when an agent asks Pablo

Principle 6 (CLAUDE.md) says to ask before a shortcut. This file is the closed list of what counts as one. Everything else an agent decides and writes down (a row in `intervenciones.md` when it is a decision of Pablo's).

This file decides when an agent asks before it starts. It does not decide merges: the `revisor` check keeps deciding every PR, also those that change the gate (Pablo's decision of 2026-10-15 in `intervenciones.md`).

## Who decides a merge

One source for this rule; the skill `github`, `PASOS-PABLO.md`, C13 of `standards/code.md` and `intervenciones.md` point here.

- The `revisor` check decides every merge, also of the gate (Pablo, 2026-10-15). Pausing, relaxing or deleting the ruleset of `main` is **prohibited, with no emergency exception** (decided by the coordinating session under Pablo's delegation, row of 2026-10-17 in `intervenciones.md`): pausing lets every armed PR in without the check, and the key of the administrator App (a key that can delete repos) would be one pushed workflow away. A machine enforces it: `test/ruleset-never-paused.test.js` fails if code under `apps/`, `scripts/` or `.github/` writes a ruleset whose `enforcement` is not `active` or sends DELETE to a rulesets endpoint.
- The only ways out of a wrong «no» are Pablo's **Approve** on the PR (Files changed tab) or a fix PR that the current judge can pass; nothing else, and never a pause. A machine checks it, not a sentence: `anulacion.yml` (runs from `main`; `senal-review.yml` only wakes it) calls `aprobacionDePablo` in `scripts/veredicto.mjs`, which counts a review only if its author is `OWNER_LOGIN` (`scripts/lib/repo.mjs`), his latest decisive review (approved, changes requested, dismissed) is an approval, and its `commit_id` is the current head. A push after it, another author or a dismissed review do not override.
- The result is the `revisor` check in green titled «override by Pablo», listing the findings it overrides. `node scripts/records.mjs` counts them as `overrides`.
- `OWNER_LOGIN` is `pabloam89`, the owner account. Checked on 2026-10-16: `gh api repos/factory-am89/fabrica/collaborators/pabloam89/permission --jq .permission` printed `admin`.
- Why the reviewer may accept this widening (C13): Pablo decided it (the rows of 2026-10-16 in `intervenciones.md`, PR #63: «Decidida, pendiente de implementar en el PR #61»), and the machine limits it to his login, the current head and his latest decisive review; `test/anulacion.test.js` goes red if any of the three is removed.

## Classes

An agent stops and asks Pablo, in the terminal, before it does any of these:

- **Weaken a check**: lower a threshold, delete or relax a test, turn a «no» into a warning.
- **Bypass the gate**: the «Prohibido» line of `CLAUDE.md` says what is forbidden; here the agent asks Pablo instead of doing it.
- **Change permissions or secrets**: same pointer, «Prohibido» in `CLAUDE.md`.
- **Do something irreversible**: delete data or history that cannot be recovered from git.

The «Qué requiere el OK de Pablo» sections of the skills are these four classes applied to each tool; they add none. How to phrase a question for Pablo is in `usuario/CLAUDE.md`, «Cómo responder a Pablo»; each question is a row in `intervenciones.md`.

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
