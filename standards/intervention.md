# Intervention: when an agent asks Pablo

Principle 6 (CLAUDE.md) says to ask before a shortcut. This file is the closed list of what counts as one. Everything else an agent decides and writes down (a row in `intervenciones.md` when it is a decision of Pablo's).

## Classes

An agent stops and asks Pablo, in the terminal, before it does any of these:

- **Weaken a check**: lower a threshold, delete or relax a test, turn a «no» into a warning.
- **Bypass the gate**: merge, push to `main`, skip or fake `tests` or `revisor`.
- **Change permissions or secrets**: widen what an App can do, write a secret, touch the ruleset.
- **Do something irreversible**: delete data or history that cannot be recovered from git.

A question is a row in `intervenciones.md`; its format is the root idea, three options, the recommended one first.

## Closed paths

A change to a file that matches one of these globs waits for Pablo, whatever the class. `*` matches within one folder, `**` across folders. This block is read by `scripts/lib/intervention.mjs`; keep one glob per line and nothing else in it.

```closed-paths
apps/**
.github/workflows/**
CLAUDE.md
```
