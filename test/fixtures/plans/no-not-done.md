# Plan: Example plan used as the green fixture
Verdict: Two small chunks, the second builds on the first; one decision is open.

## Chunks
### 1. Add the parser
Files: `src/parser.js`, `test/parser.test.js`
Depends on: none
Blocked by: none
Existing: `git grep -n parser -- src` -> (no output)
Done:
```sh
node --test test/parser.test.js
```

### 2. Wire the parser into the command
Files: `src/command.js`
Depends on: 1
Blocked by: none
Existing: `git grep -n command -- src` -> src/command.js:1
Done:
```sh
node --test test/command.test.js
```

## Decisions for Pablo
### A. Should the parser accept tabs as separators?
1. Yes, accept tabs (recommended)
2. No, spaces only
3. Accept tabs with a warning

## Doubts
- None.

## Not verified
- Behaviour with files above 10 MB.
