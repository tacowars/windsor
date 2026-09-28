# The reviewed PR class covers UI changes, not UI copy

- **Date:** 2026-09-28
- **Decided by:** tacowars
- **Refines:** decision 5 of `2026-09-28-parallel-workflow-without-an-orchestrator`

## Context

Decision 5 of `2026-09-28-parallel-workflow-without-an-orchestrator` sent
every "UI/UX" PR to tacowars. In practice that caught small, fully specified
edits too: the label rename in windsor#9 (PR #19) waited for tacowars although
the issue spelled out the new words and there was nothing left to judge.
tacowars said it should have merged on its own on a green check and a clean
Codex review. What needs tacowars's eye is a change to how the console looks or
behaves, not text the issue already fixed word for word.

## Decisions

1. **`reviewed`** (tacowars merges): sound design (`patches/`, the worklets, a
   golden change), the song document schema, persistence, any deviation
   from the issue's decisions, and a **UI/UX change to layout, interaction
   or look**: a new or moved control, a new gesture, or a restyle.
2. **`routine`** (merges on green plus no P0 or P1 from Codex): everything
   else, including user-visible text the issue spells out word for word (a
   rename, a label, a hint), a bug fix that restores intended behaviour
   without changing how a control works, tests, docs and refactors.
3. **The issue sets the class.** The main session writes it into the issue.
   The worker keeps it unless the diff crosses into a `reviewed` area, and
   then says so in the PR. The main session checks the class against the
   diff.
4. **One definition, three places.** `CLAUDE.md` ("Working a ticket"),
   `.github/ISSUE_TEMPLATE/task.md` and `.github/pull_request_template.md`
   state the two classes in the same words.

Under this rule the windsor#9 rename is `routine`, and the windsor#8 zoom
gesture is `reviewed`.
