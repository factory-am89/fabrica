# Push and open a PR (runbook)

Run from your own task folder (`npm run tarea -- <branch>`), never from the main folder. Each step is its own command.
Scratch files (body, file list) go to your own scratchpad, never to a shared `/tmp`.

1. **Green locally.** `npm run done` -> last line `done: ok`.
2. **Evidence at the FINAL commit.** Commit everything first: `npm run evidence -- --out <scratchpad>/evidence.md`
   (add `--focus <testfile>` per new test). It refuses a dirty tree and writes `HEAD <sha>` itself. Paste its block
   as is; type no counts by hand. Any new commit after this (even a fix-up) makes the block stale: run it again.
3. **Write the PR body** from `.github/pull_request_template.md` and validate it:
   `git diff --name-only origin/main...HEAD > <scratchpad>/files.txt`, then
   `node scripts/pr-body.mjs --body-file <scratchpad>/body.md --files-file <scratchpad>/files.txt` -> `pr-body: ok`.
   `--files-file` does NOT check the Evidence HEAD (it prints a note saying so); only CI's `--compare-file` does.
   Check it by hand: the `HEAD <sha>` line of the body must equal `git rev-parse --short HEAD`.
4. **Body before push.** The body must already cite the HEAD you are about to push. Updating an existing PR: run
   `node scripts/token.mjs -- gh pr edit <n> --body-file <scratchpad>/body.md` first, then push. If the push goes
   first, the edit and the push can each start a `tests` run (inferred), and a run that reads the old body is red
   (stale-HEAD check in `scripts/lib/pr-body.mjs`).
   Established in #114 (head c70533c): two `tests` runs on the same SHA with the same `created_at` (2026-10-19T16:22:55Z),
   one red (run 39284981066, failing step "PR body has the template sections") and one green (run 39284980072).
   Inferred, no command proves it: that the red run read the old body.
   Reported, not re-checked: that the builder pushed and then edited the body, and the `mergeable_state=unstable` it left.
   A new PR cannot exist before its first push: push, then create at once with the final body file.
5. **Push, create, edit, merge: each a STANDALONE command**, through the App:
   - `node scripts/token.mjs -- git push -u origin <branch>`
   - `node scripts/token.mjs -- gh pr create --title "<t>" --body-file <scratchpad>/body.md`
   Runbook rule, with NO machine check yet: never chain these with edits or a `cd` (one command, one result to read).
   Machine-checked: git from the main folder is denied, chained or not (`.claude/hooks/carpeta-principal.mjs`,
   lesson `git-not-from-main-folder`).
6. **Look at CI once** (rules: skill `github`, "La cuota de GitHub"): `node scripts/token.mjs -- gh pr view <n> --json statusCheckRollup`.
   The constructor App cannot rerun runs: to get a new run, push a new commit (then redo step 2 and the body).
   Rerunning a red run would not fix an old body anyway: GitHub replays it with the original event, so with the body of
   that moment (inferred: attempt 2 of 39284981066 also ended `failure` at the same step, which supports it but does not prove it). Inferred: the only way out is a new commit (it may be empty)
   whose body is already right (no other way was tried), and the body must name the new SHA BEFORE the push: `git commit` first (the local
   commit already has its SHA), then edit the body with that SHA, then push. If you already pushed with an old SHA in the
   body, editing the body to the right SHA should fix it (inferred; #114 at ebc9fc3: run 39369254527 `failure`, then run
   39369395187 `success`, but no command shows the edit was the cause).
   If checks are slow to start or stay queued, look at https://www.githubstatus.com first (incident "Degraded availability
   for GitHub Actions, GitHub Pages and Webhooks", 19 Oct 2026, 15:49-16:56 UTC) and do not push or edit the body while
   Actions is degraded: an edit may restart runs (inferred).
7. **Revisor says no with no reason.** The reason is in the log of the `juzgar` job; do not argue with the verdict.
   - `node scripts/token.mjs -- gh run list --workflow revisor.yml --limit 4 --json databaseId,headSha,conclusion`:
     take the run whose `headSha` is the head of your PR. The run ends `success` even when the verdict is no, and one
     SHA can have a `cancelled` run next to the real one: take the one that is not `cancelled`.
   - `node scripts/token.mjs -- gh run view <id> --log | grep "SALIDA:"`: one line, a JSON `respuestas`
     (`[{id, respuesta, prueba}]`); the reason is each entry with `respuesta: "no"` and its `prueba`.
   - The verdict itself is the line `veredicto: no` plus the failed ids, printed by `scripts/veredicto.mjs` in the same log.
   Observed in #120 (run 39382592608, head 91bb25a): `veredicto: no` / `C8: no`; the `prueba` of C8 names `PLAN_NONE`
   in `scripts/lib/free-values.mjs`. An independent revisor agent is a second reading, not the way to get the reason.
   Reported, not re-checked: in #120 an independent revisor answered C6 where the automatic one answered C8, both true.
   Inferred: the automatic revisor does not see everything, so one `no` is not necessarily the whole list of faults.
   Do not rebase without a real conflict: check with `git merge-tree --write-tree HEAD origin/main` (exit 0 = none).
   A rebase changes the SHAs your body cites, so the body must be redone from step 2. Each entry of a lesson's `sources` follows
   `PR_SOURCE` in `scripts/lib/lessons.mjs`; do not restate it here.
   A stuck `mergeable_state=dirty` with a clean merge-tree is the one justified rebase.
8. **Arm the merge** only when `revisor` and `tests` are green: `node scripts/token.mjs -- gh pr merge <n> --auto --squash`.

Also:
- A PR that touches `plans/` must change nothing else (`PR_OUTSIDE_PLANS`, `scripts/lib/plan.mjs`).
- Parallel folders: see `~/.claude/CLAUDE.md`, "Borrar carpetas" (no `git stash`; the same goes for `git checkout .`).
