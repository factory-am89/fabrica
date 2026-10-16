## What changes

- `CLAUDE.md` principle 6 («Preguntar antes de un atajo», merged in #40) gets back the duties the old principle 6 had and the merged wording dropped: outside the closed list the agent does not guess and does not interrupt, decides with the evidence it has and writes it down, and **stops and writes it down when there is no evidence**.
- `.claude/agents/arquitecto.md`: the same on the architect's one line («no preguntes ni adivines»; blocks the chunk when there is no evidence or the closed list applies).
- `test/principles-and-roles.test.js`: a new test that fails if principle 6 or the architect line loses one of those duties.
- Why (C13): the standard asks whether any check stays equal or stricter. The old principle 6 said «no se adivina ni se interrumpe; se para y se deja escrito»; the merged one said «todo lo demás se decide y se apunta». This PR adds the missing duties back; nothing is removed. Old duty -> where it lives now: «no se adivina» -> principle 6; «no se interrumpe» -> principle 6; «se para y se deja escrito» -> principle 6 (case without evidence) and the architect line.
- Principles: Fail loudly, Ask before a shortcut
- Check: C13

## Evidence

Produced by `npm run evidence`. HEAD 55c3fc3; merge-base with origin/main 40b3d2d.

Filter, applied in code: for `node --test` (run with `--test-reporter=spec`) only lines starting with `ℹ tests`, `ℹ pass`, `ℹ fail` and `✖` are kept, and a duration at the end of a kept line, such as ` (12.3ms)`, is removed so the block is reproducible; every other command is raw. Output is stdout followed by stderr.

```
$ npm run lint

> lint
> eslint . --max-warnings 0
(exit 0)
```

```
$ node --test --test-reporter=spec
✖ proyecto-nuevo.ps1 contra un gh falso: privado, sin admin, Apps, secretos, PR, ruleset e idempotencia
ℹ tests 497
ℹ pass 496
ℹ fail 1
✖ failing tests:
✖ proyecto-nuevo.ps1 contra un gh falso: privado, sin admin, Apps, secretos, PR, ruleset e idempotencia
(exit 1)
```

```
$ node --test --test-reporter=spec test/principles-and-roles.test.js
ℹ tests 5
ℹ pass 5
ℹ fail 0
(exit 0)
```

```
$ git diff --shortstat origin/main...HEAD
 3 files changed, 14 insertions(+), 2 deletions(-)
(exit 0)
```

## Red before

The new test against the text of origin/main (before the wording change), `node --test --test-reporter=spec test/principles-and-roles.test.js`:

```
  AssertionError [ERR_ASSERTION]: el principio 6 perdió: no se adivina
ℹ fail 1
ℹ pass 4
ℹ tests 5
✖ el principio 6 conserva las obligaciones del viejo: no adivinar, no interrumpir, parar y apuntar sin evidencia (C13)
✖ failing tests:
```

## Not verified

- One test of the full suite fails in the block above: `proyecto-nuevo.ps1 contra un gh falso: ...` (`test/proyecto-nuevo.test.js`, from #52). It is not related to this change: I ran `node --test test/proyecto-nuevo.test.js` in a clean detached worktree of origin/main (5286130) and got `ℹ fail 1`, `ℹ pass 3` with `+ FALLO: repo ilegible: dice que no es JSON con la salida y no culpa a los permisos`. I did not find the cause (it may depend on this machine; I did not look at the CI result of main).
- This PR touches `CLAUDE.md` and a role, so C13 is asked on purpose; whether the CI revisor agrees is not known yet.
- Windows only.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
