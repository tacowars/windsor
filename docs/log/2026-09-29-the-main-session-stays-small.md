# The main session stays small: rotate at 150k, wake once per PR, fresh fix workers

- **Date:** 2026-09-29
- **Decided by:** tacowars
- **Refines:** decision 4 ("The main session dispatches and merges") of
  `2026-09-28-parallel-workflow-without-an-orchestrator`
- **Research:** `docs/research/2026-09-29-orchestration-after-two-sprints/`

## Context

Two sprints under the parallel workflow merged 39 PRs. The worker-side
changes worked: the gate left the worker (57 minutes of vitest, typecheck
and lint across 38 workers) and workers start at 29 to 30k tokens. The
cost moved to the main session, which used 40% of the tokens of the
sessions that dispatched work. It ran to 370 to 415k context per call and
never compacted: 36% of its tokens were context above 150k. It woke 63
times for a CI or Codex verdict (22% of its tokens) and 72 times for a
worker's hand-back (21%). Fix rounds continued in the original worker were
36% of worker tokens, at a median 171k per call, while a fresh worker
starts at 30k. The three PRs that went past the two-round cap were
features with many interacting states, not simply large ones.

## Decisions

1. **Rotate at about 150k context.** The main session writes its handoff
   in `.claude/handoffs/` and a fresh session takes over, or it compacts.
2. **One wake per PR decision.** The main session watches a PR until
   `verify` has finished and Codex has reviewed its head (matched on
   `original_commit_id`), and wakes once for the pair, not once per event.
3. **A fix round goes to a fresh worker.** The brief is the findings with
   file and line and the rule to follow, and the profile is usually
   `worker-light`. The main session does not send the round to the worker
   that wrote the PR. This is a trial for the next wave; compare its fix
   rounds with the research's section 3 before keeping it.
4. **Split by behaviour before launch.** Work whose states interact
   (cancel, timing, selection, live edits) and that is expected past about
   800 changed lines is split, a seam ticket first. The issue lists the
   interactions as boundary cases.
5. **The main session delegates its own browser checks** to a sub-agent
   on Sonnet at `low`, as decision 9 of the parallel-workflow record says
   for verifiers.

## Not adopted yet

A PR status script (one line per open PR with its head, `verify` state and
Codex verdict), `worker` at effort `medium`, Sonnet for `worker-light`
tickets, and a CI time budget for slow suites. Each is in the research's
section 6 as a trial or follow-up.
