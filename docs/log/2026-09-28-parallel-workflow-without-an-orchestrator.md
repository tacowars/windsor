# Parallel work runs without an orchestrator, a board script or a role file

- **Date:** 2026-09-28
- **Decided by:** tacowars
- **Research:** `docs/research/2026-09-28-agent-orchestration-overhead/`
  and `docs/research/2026-09-28-agent-orchestration-refined/`

## Context

Aotearoa204 and HOOP ran a hub-and-spoke process: an orchestrator session
dispatched one sub-agent per ticket, each loading a role file, claiming a
board item, running the verify gate, opening a PR, updating the board and
reporting back. Measured over 35 sub-agent transcripts, the cost sat in
three places: the gate run inside the worker (68% of an implementer's wall
clock), a 43 to 45 k token starting context from the role file, and the
orchestrator as a poller (39% process calls, a median of 6 calls between
launches). Board writes and handoff notes were cheap. tacowars runs on a Claude
Max subscription with usage credits off plus a Codex Pro subscription, so
the unit of cost is the rolling allowance window, and the prompt cache
lives one hour, which makes an idle hub re-read its context cold.

## Decisions

1. **The issue is the whole brief.** `.github/ISSUE_TEMPLATE/task.md`:
   goal, numbered decisions, owned folders, dependencies, acceptance
   criteria with boundaries, the local verify slice, and the PR class. No
   role file; the standing rules are the "Working a ticket" section of
   `CLAUDE.md`.
2. **The PR is the only report.** `.github/pull_request_template.md`. A
   worker's final message is the PR URL and one line.
3. **CI is the gate.** A worker runs the tests beside its change, typecheck
   and lint, never `npm run verify`. CI runs `verify` on every PR, including
   docs-only ones, so the required check always reports. The
   `guard-bash.mjs` hook denies the full gate and any CI polling inside a
   worker.
4. **The main session dispatches and merges; nothing else does.** It checks
   overlap with `scripts/overlap.sh` before launching, runs at most two
   Claude workers, lands a `seam` ticket first when a wave shares a hotspot,
   and merges routine PRs with `gh pr merge --squash --auto` so GitHub does
   the waiting. A ruleset on `main` requires the `verify` check and a PR.
5. **Two PR classes.** `routine` merges on green plus no P0 or P1 from
   Codex. `reviewed` (sound design, UI/UX, song document schema,
   persistence, golden changes, deviations) waits for tacowars.
   Refined by `2026-09-28-pr-class-covers-ui-changes-not-ui-copy`.
6. **Codex reviews every PR from GitHub.** The framing lives in
   `AGENTS.md` under "Code Review Rules" and spends the Codex allowance, not
   the Claude window. The main session triages findings; a fix is a fresh
   round on the same branch, at most two.
7. **The board is a view.** GitHub Project #6 is linked to the repo and
   moved only by its built-in workflows (auto-add, PR linked, closed,
   merged). No script or agent writes to it; the hook denies board writes.
8. **Backlog and queue are labels.** No label is backlog, `ready` is the
   queue, an open PR is in progress, closed is done. `blocked`,
   `needs-human`, `seam`, `reviewed` and `area:*` carry the rest.
9. **Model and effort.** Opus at `high` for the main session and
   implementers (`.claude/settings.json`). Explore and verifier sub-agents
   run on Sonnet at `low`.
10. **Measure each wave** with the transcript script in the research
    folder plus ready-to-merge time and tacowars's intervention minutes per PR,
    and compare one worker against two before raising the cap.

## Not adopted

An orchestrator skill, a board script, per-ticket handoff files,
`/autofix-pr` as a default (an always-on watcher in the same allowance),
agent teams, a merge queue, and ticket start or finish scripts. Claude
Code's worktree isolation replaces the start script and CI replaces the
finish script.
