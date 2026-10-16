## What changes

`.gitattributes` gains `intervenciones.md merge=union`, so when two PRs each append a row to the end of `intervenciones.md`, git keeps both rows instead of marking a conflict. The "7 of 44 PRs touched that file in one day" figure comes from the request that ordered this change; I did not recount it here. New `test/gitattributes.test.js` proves the merge in a temporary git repo that uses the real `.gitattributes`.

Plainly: low risk, but it only avoids conflicts of appending at the end. It does not solve two PRs editing the same row. No other file uses union (it would corrupt `package.json`).

## Evidence

```
$ node --test test/gitattributes.test.js
✔ two branches appending a row to intervenciones.md merge without conflict
✔ only intervenciones.md uses merge=union (union would corrupt package.json or any JSON)
ℹ pass 2
ℹ fail 0

$ npx eslint . --max-warnings 0
(no output, exit 0)

$ npm test
ℹ tests 378
ℹ pass 378
ℹ fail 0

$ git --version
git version 2.52.0.windows.1
```

All run on Windows with that Git; `merge=union` worked in a local `git merge` with no extra setup.

## Red before

Test 1, with `.gitattributes` without the `intervenciones.md merge=union` line:

```
$ node --test test/gitattributes.test.js
✖ two branches appending a row to intervenciones.md merge without conflict
ℹ pass 1
ℹ fail 1
```

Test 2, appending another union line to `.gitattributes` (each case restored afterwards):

```
== extra: *.json merge=union
✖ only intervenciones.md uses merge=union (union would corrupt package.json or any JSON)
ℹ pass 1 / ℹ fail 1
== extra: package.json merge=union
✖ only intervenciones.md uses merge=union (union would corrupt package.json or any JSON)
ℹ pass 1 / ℹ fail 1
== no extra line
ℹ pass 2 / ℹ fail 0
```

The test is deterministic: no clock, network or repo data; the temporary repo is deleted afterwards and global git config is untouched.

## Not verified

- That the merge GitHub does on the server (squash, "update branch") respects `.gitattributes`: GitHub may not apply `merge=union` there. It is inferred from git documentation that it applies to local `git merge`/`rebase`; only the local `git merge` was tested.
- Two PRs editing the same row still conflict.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
