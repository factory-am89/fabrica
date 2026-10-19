## What changes

Adds a check for the PR body.

## Evidence

Produced by `npm run evidence`. HEAD 0000000; merge-base with origin/main 89abcde.

```
$ node --test test/pr-body.test.js
ℹ tests 999
# fail 0
```

## Red before

```
$ node --test test/pr-body.test.js
# fail 15
```

## Decisions

None

## Not verified

Nothing.
