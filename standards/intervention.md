# Intervention: when an agent asks Pablo

Principle 6 (CLAUDE.md) says to ask before a shortcut. This file is the closed list of what counts as one. Everything else an agent decides and writes down (a row in `intervenciones.md` when it is a decision of Pablo's).

This file decides when an agent asks before it starts. It does not decide merges: the `revisor` check decides every PR, also those that change the gate (Pablo's decision of 2026-10-15 in `intervenciones.md`), with one exception since 2026-10-16: when the revisor rejects by mistake, Pablo's **Approve** in GitHub on the head commit of the PR overrides the «no». That is the only way out; pausing the ruleset of `main` is forbidden (the entries of 2026-10-16 in `intervenciones.md` give the reasons).

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
