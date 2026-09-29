# Workers load a thin profile: worker or worker-light, one shared rules file

- **Date:** 2026-09-28
- **Decided by:** tacowars
- **Refines:** decisions 1 ("No role file") and 9 (model and effort) of
  `2026-09-28-parallel-workflow-without-an-orchestrator`
- **Research:** `docs/research/2026-09-28-agent-orchestration-overhead/`

## Context

The first waves of workers kept tripping on the same few things: a
worktree resolving `@windsor/*` to the main checkout, an older default
Node, `gh pr edit` failing to add labels, trying to reach a dev server
from the sandbox. The fixes lived in one session's memory or were repeated
in every launch prompt, so they did not travel to tacowars's other machine.
The research rejected a 24 kB role file, which pushed a worker's starting
context to 43 to 45 k tokens. The size was the problem, not a profile as
such.

## Decisions

1. **Two sub-agent profiles in `.claude/agents/`.** `worker` runs Opus at
   effort `high` for the engine and DSP, the song or patch format,
   persistence and multi-file features. `worker-light` runs Opus at effort
   `medium` for a label, a CSS tweak, copy, docs, config, or a small bug
   fix with a clear cause. Both set `model` and `effort` in frontmatter,
   the keys the Claude Code sub-agent docs list
   (`https://code.claude.com/docs/en/sub-agents`).
2. **One shared rules file, `.claude/worker-rules.md`,** outside `agents/`
   so it is not loaded as a profile. The profiles are a few lines that
   point to it and to `CLAUDE.md` "Working a ticket"; neither restates the
   protocol, and no rule is stated in both the rules file and `CLAUDE.md`.
3. **Size cap.** The rules file stays under 2 kB and each profile under
   0.5 kB. It holds only what workers actually tripped on.
4. **The issue names the profile.** The task template gains a "Worker"
   section, set by the main session with the PR class, and the main
   session launches the worker with that profile.
5. **Merging waits for Codex.** `gh pr merge --auto` waits only for the
   `verify` check, so the main session merges a routine PR only after
   Codex's 👍, without `--auto` when the check is already green.

## Not adopted yet

Sonnet for implementation. Measure it on light tickets first, per
decision 10 of the parallel-workflow record.
