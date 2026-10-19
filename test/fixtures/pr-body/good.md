## What changes

Adds a check for the PR body.

## Evidence

Produced by `npm run evidence`. HEAD 1234567; merge-base with origin/main 89abcde.

```
$ node --test test/pr-body.test.js
# fail 0
```

## Red before

```
$ node --test test/pr-body.test.js
# fail 15
```

## Decisions

- principio 5 | eligió: una comprobación de máquina | descartó: una frase en la plantilla | motivo: decidido

## Not verified

Nothing.
