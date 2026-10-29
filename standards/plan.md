# Plan standard

Yes-or-no questions about a plan (the product «plan»; the product «diff» is judged by `standards/code.md`). Each says who checks it: the **machine** (a command) or the **reviewer**. All must be `sí` (or `no aplica`) for a plan to be built.

## Shape

The machine-readable shape is defined once, in `PLAN_FIELDS` and `PLAN_FAULTS` of `scripts/lib/plan.mjs`; `node scripts/check-plan.mjs --file <plan>` is its reader. A plan has a title line, a verdict line, a `Chunks` section, a `Decisions taken` section, optional decisions for Pablo and a `Not verified` section. `Decisions taken` is required (`None` is valid) and its lines have the same form as the `Decisions` section of a PR body; they are read by `scripts/lib/decision.mjs`, the only reader of a decision line (the form is `FORMS` there), and a missing section or a line it rejects is `MISSING_DECISIONS_TAKEN` or `BAD_DECISION_LINE`. Plans written before this section existed (`plans/app-admin.md`) are not changed: the CI check only reads the plan a PR edits, so such a plan fails the first time someone edits it. Every chunk carries these fields, in this order:

- `Files:` the paths the chunk touches, in backticks.
- `Depends on:` chunk numbers, `#<n>` PRs, or `none`.
- `Blocked by:` decision letters, or `none`.
- `Existing:` what was searched to show the work does not exist yet, with command and output.
- `Not done:` the nearby work left out.
- `Done:` a closed code block with the command that proves the chunk.

The gate flag of a chunk and the «needs Pablo» flag are computed from `Files`; the plan never writes them.

## Where it comes from

| Question | Comes from |
|---|---|
| P1 | The form of a plan is checkable by code (`scripts/lib/plan.mjs`), so a machine checks it. |
| P2 | Rule 1 of the former `arquitecto.md` list: the chunk's definition of done is a command that can be pasted. |
| P3 | Rule 2 of that list: say what is not done; what the request does not cover is noted, not assumed. |
| P4 | Rule 3 of that list: a chunk fits in one PR. |
| P5 | An end-to-end verdict test already existed (`test/verdict-e2e.test.js`) and was commissioned a second time. |
| P6 | A figure «2,5 -> 1» in a plan was a hope, not a measurement. |
| P7 | Chunks on the same file run in parallel and collide; `SHARED_FILE` in `scripts/lib/plan.mjs`. |
| P8 | C13 of `standards/code.md`: nothing in the gate gets weaker. |
| P9 | The closed list of `standards/intervention.md` is the only reason to ask Pablo; `CLOSED_WITHOUT_DECISION` in `scripts/lib/plan.mjs`. |
| P10 | I1 and I2 (`goals.json`): a field or entity named twice, or in no table, is the cost the base files (`entities.json`, `fields.json`) exist to stop. |
| P11 | I4 (`goals.json`): a decision only counts if it is written down with its principle and the alternative it discarded; `FORMS` in `scripts/lib/decision.mjs` checks the form, not the fit. |
| P12 | I3 (`goals.json`): a rule with no reader and no trigger is a sentence, and a failure is asked for its class, not its case. |
| P13 | I3 (`goals.json`): PR #145 fixed al-dia against al-dia without reproducing the real failure (both SessionStart hooks at once) or listing who else wrote in `.git`; a fix validated against its own hypothesis is not proof. |

## Questions

### P1 — Does the plan have the machine-readable shape?
Quién: máquina (`node scripts/check-plan.mjs --file <plan>`).
Bien: the command prints no fault; every chunk has all the fields of «Shape».
Mal: a chunk without `Not done:`, or a `Done:` with an unfilled `<...>` marker.

### P2 — Does each chunk's Done command really prove the chunk (it fails before and passes after), and is it more than a generic `npm test`?
Quién: revisor.
Bien: `node --test test/plan-standard.test.js`, a file that does not exist before the chunk and fails without it.
Mal: `npm test` alone, which is green with or without the chunk, or «improve» and «clean up».

### P3 — Does each chunk's Not done name the nearby work left out, and is what the request does not cover written as a doubt instead of assumed?
Quién: revisor.
Bien: «Not done: making the judge read `plan.md` (a later chunk)»; a gap in the request is listed under `Not verified`.
Mal: `Not done: nothing`, or silently deciding what the request left open.

### P4 — Is each chunk one idea that fits in one PR review?
Quién: revisor.
Bien: one parser, or one standard and the role that links it.
Mal: a chunk that changes the judge, a workflow and a standard together.

### P5 — Does each chunk that adds a test, check or file show with a command and its output (Existing) that it does not exist already?
Quién: revisor.
Bien: `Existing:` a `git grep` for the name and its empty output.
Mal: commissioning an end-to-end verdict test when `test/verdict-e2e.test.js` already existed, with `Existing:` left as «none».

### P6 — Does every claim about the code carry proof (path:line, or command and output), and is the unverified listed under Not verified?
Quién: revisor.
Bien: «the parser throws on mixed prefixes (`scripts/lib/questions.mjs:43`)»; what was not run goes under `Not verified`.
Mal: «this cuts the cost from 2,5 to 1» with no measurement behind it.

### P7 — Does the order respect the real dependencies, with no chunks running in parallel on the same file?
Quién: máquina (`node scripts/check-plan.mjs --file <plan>` reports `SHARED_FILE` for chunks that share a file with no dependency path).
The machine sees only shared files. The reviewer still reads the order for a dependency between different files.
Bien: chunk 2 lists `Depends on: 1` when it edits the file chunk 1 edits.
Mal: chunk 5 uses the parser built in chunk 1, they touch different files, and chunk 5 says `Depends on: none`; the machine cannot see it.

### P8 — Does each chunk that touches a gate file say which check it keeps or hardens (C13) and how main is repaired if it breaks?
Quién: revisor.
The machine computes which chunks touch the gate (`checkPlan` returns `gate` per chunk); the reviewer judges what the chunk says about it.
Bien: «keeps C13; if it breaks, revert the PR from a new branch».
Mal: a chunk that changes `scripts/lib/gate.mjs` and says nothing about the checks it affects.

### P9 — Are the questions to Pablo only from the closed list of `standards/intervention.md`, in plain words with the recommended option first, and are chunks that depend on them marked Blocked by?
Quién: máquina (`node scripts/check-plan.mjs --file <plan> --closed-paths <list>`).
The machine decides what it can compute: a chunk whose `Files` meet the closed paths needs `Blocked by`, and each decision has the fixed number of options with the first marked as recommended. The reviewer reads the rest (plain words, a question that is not on the list).
Bien: a decision about `.github/workflows/**` with its options, the recommended one first, and the chunk marked `Blocked by: A`.
Mal: asking Pablo which name to give a file, which is not on the closed list: the constructor decides and writes it down.

### P10 — Is each new field or entity in the plan classified, and compared with the ones that already exist in `entities.json` and `fields.json`?
Quién: revisor.
The base files are the comparison: the reviewer reads the chunk against them.
Bien: «a new field `x`: type and owner as a row of `fields.json` has them, compared with `y` (same meaning, so it is reused and not added)».
Mal: a chunk that adds a field or an entity and never says whether `entities.json` or `fields.json` already has one for it.

### P11 — Does each line of `Decisions taken` apply the principle it cites (the discarded alternative would break it), and is each decision the request does not impose written there?
Quién: revisor.
The form of the line is checked by a machine (`scripts/lib/decision.mjs`); only the reviewer can tell if the choice fits the principle, and if a choice of the plan is missing from the section.
Bien: a line that cites principle 4 and discards «a second copy of the table», which would break «one idea, one place».
Mal: a line that cites a principle the discarded alternative would not break, or a chunk that picks a design the request did not ask for and writes it nowhere.

### P12 — Does each new rule of the plan name its reader and its trigger, does the Done of each check prove it through its real entry point with a bad case in red, and does each chunk born from a failure name its class?
Quién: revisor.
The triggers are the closed list `TRIGGERS` of `scripts/lib/triggers.mjs`; `manual` is only valid when the plan declares it as debt.
Bien: «reader `test/<name>.test.js`, trigger `ci-test`; Done runs `node --test test/<name>.test.js` and a bad fixture turns it red», and «class: a rule with no reader» for a chunk that comes from a failure.
Mal: a rule written as a sentence in a standard with no reader, a Done that calls the function by hand and not the command CI runs, or a chunk that fixes one failure without naming its class.

### P13 — Does each chunk born from a failure show the failure reproduced through its real entry point, with the figure before and after, and the list of everything else that reads or writes the same state, with how it was searched?
Quién: revisor.
The reviewer asks whether the chunk was validated against the failure or against its own hypothesis; the machine cannot tell which chunk is born from a failure (no field of `scripts/lib/plan.mjs` says so).
Bien: «reproduced with the two real startup hooks at once: 27 of 30 fail before, 0 of 50 after», and a list of every writer of the shared state (user and project layers, other tools), saying which command found each.
Mal: a test that pits the fixed command against itself (PR #145 fixed al-dia against al-dia, deduced the cause without reproducing it and without listing who else wrote in `.git`, although the reflog of `refs/remotes/origin/main` already had `fetch -q --prune origin` entries that were not al-dia's).
