# An agreed engine-only PR merges without tacowars

- **Date:** 2026-09-28
- **Decided by:** tacowars
- **Refines:** `2026-09-28-pr-class-covers-ui-changes-not-ui-copy`

## Context

The `reviewed` class sends a PR to tacowars whenever it touches a reviewed area,
such as the song document schema or persistence. When the change is
engine-only or internal, the design was already agreed in the issue, and
nothing about it can be clicked or heard, tacowars's review adds nothing a green
check and a clean Codex review don't already give, and the PR waits for
nothing.

## Decisions

1. **A `reviewed` PR merges without tacowars when all four hold:**
   - (a) there is nothing tacowars can click or hear: an engine-only or
     internal change with no UI or sound change a preview would show;
   - (b) the design was agreed in the issue's decisions;
   - (c) the worker raised no deviation and no `needs-human` (a necessary
     edit outside the owned files, declared in the PR, is not a
     deviation);
   - (d) CI is green and Codex's latest review has no open P0 or P1.
2. **The main session checks all four and merges.**
3. **Sound design and golden changes (anything audible) still wait for
   tacowars's listen; UI still waits for tacowars's look.**
4. **Same words, three places.** The rule sits in the PR classes paragraph
   of `CLAUDE.md` and in the class sections of
   `.github/ISSUE_TEMPLATE/task.md` and `.github/pull_request_template.md`,
   worded identically.
