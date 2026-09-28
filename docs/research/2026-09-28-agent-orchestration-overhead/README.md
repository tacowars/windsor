# Where the overhead is in hub-and-spoke agent work, and what to run instead

- **Date:** 2026-09-28
- **Question:** Aotearoa204 and HOOP ran a hub-and-spoke process: an
  orchestrator session dispatches one fresh sub-agent per ticket into a git
  worktree, the sub-agent loads a role skill, claims a GitHub Projects item,
  implements, runs the verify gate, opens a PR, updates the board and reports
  back. It gave parallelism and durable state but was slow and token-heavy.
  Where is the overhead, how much of it is inherent to sub-agents on one
  repo, and is the pattern an anti-pattern next to what people run in
  September 2026?
- **Method:** three strands.
  1. Measured: every Claude Code transcript for Aotearoa204 on this machine
     (31 main sessions, 35 sub-agent transcripts, 2026-09-04 to 09-27), parsed
     by `measure-overhead.py` in this folder. Full tables in
     `transcript-overhead-report.md`. Windsor's own five process-free
     sub-agents are the baseline. HOOP has no assistant transcripts on this
     machine, so its numbers come from its docs and handoffs only.
  2. Read: both repos' process files (skills, agent definitions, scripts,
     handoffs, post-mortem, `docs/research/agent-metrics/`).
  3. Surveyed: Anthropic's current docs (Claude Code agents, subagents, agent
     teams, workflows, worktrees, projects; the Opus 5.5, Fable 5 and 5.1
     prompting guides) and community sources from 2026. Sources at the end.
- **Machine:** transcripts read on tacowars's Mac (Darwin 25.5), Claude Code
  2.1.26x to 2.1.28x. Durations are elapsed time and include permission
  prompts and any human absence.

## 1. Answer in short

The overhead is not where the pattern's reputation puts it. In Aotearoa204's
sub-agents, board writes, `gh` calls and handoff notes are cheap: 14% of tool
calls and a few minutes per ticket. Three things are expensive:

1. **The verify gate run inside the sub-agent, repeatedly.** The finish phase
   (from the first `ticket-finish.sh` call to the end) is 20% of an
   implementer's calls but 68% of its wall clock. The gate ran 2.3 times per
   ticket, median 214 s each, 3 h 29 min in total across 26 tickets. Under
   sibling load it goes red on Vitest timeouts alone (6 of 13 runs in the
   #703 epic), which forces reruns and fix-up rounds.
2. **Context per turn.** Every ticket-implementer starts at 43 to 45 k tokens
   before it reads anything (system prompt, CLAUDE.md, a 24 kB role file,
   the brief), against 12 k for a bare Explore agent and 28 k for a
   general-purpose one in Windsor. It then carries a median 95 k tokens per
   turn (p90 176 k) because it reads source with `sed -n` and `cat` (46% of
   its Bash calls), so file bodies stay in the transcript. Median 2.1 M input
   tokens per ticket over 26 turns.
3. **The orchestrator as a poller.** Its calls are 39% process (`board.sh`
   123 times, about 200 `gh` segments, `git` inspection) and it makes a
   median 6 tool calls between launches. It is a status loop that also holds
   every report in its context.

Some overhead is inherent to sub-agents on one repo: a fresh context per
agent, the hub reading every result, and integration (conflicts, rebases,
reruns). Anthropic's own docs now say so plainly, and the measured multiplier
for fan-out including report-back is 2.6x to 5.9x the tokens of doing the
same work sequentially (Systima, July 2026). The rest of the pattern's cost
is a design choice and can be removed.

The pattern is not named as an anti-pattern anywhere. But each of its
load-bearing pieces has a lighter replacement in 2026: a script or `/batch`
holds the dispatch loop instead of a session; GitHub writes board status
itself when an agent is assigned to an issue; CI is the only verify; the PR
body is the only report; a human or a merge queue is the single writer to
main. Section 5 maps that onto Windsor.

## 2. Measured: Aotearoa204 sub-agents (n = 35, 26 ticket-implementers)

| metric | median | p90 |
|---|---|---|
| tool calls per sub-agent | 31 | 101 |
| assistant turns | 26 | 80 |
| wall clock | 12 m 18 s | 46 m 17 s |
| input tokens incl. cache reads | 2.43 M | 12.7 M |
| starting context (ticket-implementer) | 43.1 to 44.8 k, all 26 | |
| context per turn | 95 k | 176 k |

Tool share: Bash 82%, Read 5%, Write 3%, Edit 1%. Implementers do not use
Read, Edit, Grep or Glob; they read with `sed`/`cat`/`grep` and edit with
python heredocs and `sed -i`.

**Process share of calls** (gh, git worktree/commit/push, ticket/board/codex
scripts, polling, handback): **14%**. Work (reads, edits, tests): 73%.
Inspect and other: 13%.

**Process share of tool time**: **45%**, because one bucket dominates:

| bucket | calls | time in tool | mean s/call |
|---|---|---|---|
| repo scripts (`ticket-finish`, `ticket-start`, `codex-pass`) | 72 | 2 h 16 m | 114 |
| shell edits | 143 | 39 m | 16 |
| shell reads | 604 | 36 m | 4 |
| polling loops | 23 | 29 m | 77 |
| git inspection | 75 | 25 m | 20 |
| test runs | 37 | 12 m | 19 |

`ticket-finish.sh` alone: 60 calls, median 214 s, p90 467 s, 3 h 29 m total.
Eleven of 26 implementers spent more than 70% of their wall clock after
their first finish call. `gh` calls in sub-agents: 37 calls, 8 minutes.
`board.sh` in sub-agents: 3 calls.

**Implementer phases (medians):** orient (before the first edit) is 25% of
calls and 11% of time. Finish is 20% of calls and 68% of time.

**Cost:** the harness cost records put all 31 Aotearoa204 sessions, sub-agents
included, at USD 803 and 5.9 M output tokens. The six orchestrator sessions
and their sub-agents are USD 290 of that. Most of the spend was in ordinary
interactive sessions, not in the orchestrated flow.

## 3. Measured: the orchestrator (6 sessions, 32 launches)

| metric | value |
|---|---|
| tool calls between consecutive launches | median 6, p90 29 |
| process share of calls | 39% (non-orchestrator sessions: 14%) |
| `board.sh` segments | 123 |
| `gh pr` / `gh issue` / `gh project` segments | about 200 |
| tool time | 2 h 11 m, of which AskUserQuestion 24 m, `board.sh` and scripts 18 m, `git` inspection 14 m, `gh pr` 10 m |

The orchestrator's own reading (CLAUDE.md 14 kB, BOARD_GUIDE 37 kB, its skill
33 kB, the latest handoff about 10 kB) is about 93 kB before it recovers any
state.

## 4. What the repos already knew

Aotearoa204 measured itself and cut hard, and the cuts worked on tokens but
not on minutes:

- MVP post-mortem (`docs/research/2026-09-02-mvp-protocol-post-mortem.md`):
  2,227 active agent-minutes and 2.48 G cache-read tokens for 49 tickets.
  Time split: model thinking 46.7%, Codex review 16.7%, CI polling 12.0%.
  After the #134 cuts, per 1,000 source lines: turns 126 to 49, cache-read
  25.6 M to 11.7 M, active minutes 40.9 to 43.5. Its verdict: "the cuts
  bought turns and tokens, not wall-clock minutes."
- One run (#324) spent 335 of 470 Bash calls polling CI, 157 M cache-read
  tokens. Polling is now hook-denied.
- Startup reading was cut from 35.4 k to 8.3 k tokens on 2026-09-02; the
  same three files have since grown back to 44 kB, about 11 k tokens.
- `docs/research/agent-metrics/` (301 runs): median context at first edit
  96.5 k overall, 74.5 k since 09-22; median wall 30.7 min overall, 21.7 min
  since 09-22 (n = 25).
- The 2026-09-27 handoff: 6 of 13 verify runs red only on load timeouts,
  about 60 min of wall; parallel registry appends cost two rebase rounds;
  capping workers took the timeout-red rate from 5/8 to 1/5.
- Stated pain: GitHub REST and GraphQL quota exhaustion by polling and by
  five parallel agents; account usage limits tripped by two Fable agents at
  once; `ticket-start.sh` racing on `.git/config`; scratch-file collisions
  between tickets; a serial self-hosted CI runner.

HOOP was the lighter variant and its handoffs say why: it capped reports at
150 words after "600 to 1,000-word agent reports repeating the PR body, and a
dozen noisy calls per PR"; a ticket's board cost fell from about 800 GraphQL
points to 6 (#206) after quota exhaustion stalled five finished PRs for half
an hour; the implementer creates its own worktree; most PRs merge on one
Vercel check with no reviewer; the report is the final message, not a file.
It landed 111 squash merges in about 55 hours. Its pain was infrastructure
shared between parallel agents: one local Supabase stack that agents reset
under each other, one browser lock that wedged every look, deployment caps,
and permission-classifier refusals of compound commands.

Both repos converged on the same lessons independently: cap the report,
make board writes cheap, keep the role file small, run verify once, and
partition files by ownership. What neither removed was the gate inside the
agent, the hub as poller, and the sub-agent's reading style.

## 5. What is inherent and what is not

Inherent to sub-agents on one repo, and confirmed by outside measurement:

- **A fresh context per agent.** The Claude Code subagents doc: each
  subagent "starts with a fresh, isolated context window" and loads the
  system prompt, CLAUDE.md, the delegation message and any preloaded skills.
  The floor here is 12 to 28 k tokens; the role file is what pushes it to 44 k.
- **The hub reads every result.** The workflows doc names it: with subagents
  and agent teams "Claude is the orchestrator ... and every result goes into
  a context window". Agent teams "use significantly more tokens than a single
  session", about 7x in plan mode (costs doc). Systima's proxy measurement:
  two sub-agents cost 2.6x the tokens of sequential on Opus and 5.9x on
  Fable 5, and were slower in wall clock; fan-out pays only when the units
  are independent and the lead keeps working.
- **Integration.** Across 33,596 agent PRs in 2,807 repos, cross-agent
  textual conflict rate was 41.7% against 19.8% within one agent (Vaughan's
  summary of Xu et al., July 2026). Aotearoa204's registry appends and
  HOOP's `package.json` "conflict every time" are the same effect.

Not inherent, and removable:

- Agents writing the board. GitHub records queued / working / waiting for
  review / completed itself when an agent is assigned to an issue (GA
  2026-03-26), and `Fixes #N` closes the issue on merge.
- The handoff note per ticket. The PR body plus CI state is the report.
  Anthropic's Projects product runs each thread on its own branch and reads
  PR state in an overview pane, with no note back to a lead.
- The 24 kB role file and the 33 kB orchestrator skill. The Fable 5 guide:
  skills "developed for prior models are often too prescriptive ... and can
  degrade output quality"; prefer goal and constraints over enumerated steps.
- Running the full gate inside the agent, several times, on a machine shared
  with siblings. CI is the gate; locally run the affected slice.
- A session as the dispatch loop. A workflow script or `/batch` holds the
  loop and "Claude's context holds only the final answer".

## 6. What the Opus 5.5 guide changes

Read on 2026-09-28. The parts that bear on this process:

- **A text-only `end_turn` is a report, not completion.** On long tasks the
  model "keeps the user updated as it works, and some of those updates end
  the turn with text rather than a tool call". The harness should keep the
  task list in a checklist the model updates, nudge with a short message
  naming the open items, and stop after two or three automatic
  continuations. If a sub-agent or background command is still running, the
  task is not done. Aotearoa204's "CI handback" (the agent ends its turn and
  the orchestrator watches CI by sha) is already this shape; what it adds is
  a hub relaying the report, which the guide does not ask for.
- **Time signals for multi-agent harnesses.** Append `elapsed 340s / 1200s`
  to each message; the model paces itself and "usually finishes well before"
  the budget. "A tighter budget has a different effect from a lower effort
  setting: lowering effort reduces the work itself, whereas a budget mostly
  keeps more agents working in parallel." Advisory; keep a hard timeout. In
  Claude Code this could be tried through a PostToolUse hook that returns an
  elapsed-time line as additional context. Untested here.
- **Effort.** Default is `medium` (Opus 5 defaulted to `high`), and at
  `medium` it matched Opus 5 at `high` on coding "in fewer steps and with
  fewer tokens". Lower effort means fewer, more consolidated tool calls.
  Sub-agents doing bounded work belong at `low` or `medium`; Aotearoa204
  pinned an Opus floor and reserved Fable for design tickets, which is the
  right direction.
- **Progress updates arrive as thinking blocks**, not transcript text, so a
  harness does not need the agent to write status anywhere. A reminder
  after about five silent tool steps "roughly halved the share of tasks with
  a long silent stretch, with no measurable change in cost".
- **Fable 5.1 additions:** let the lead keep working while sub-agents run
  ("lowers average time to completion at similar quality, token usage, and
  cost"); ground progress claims against tool results, which "nearly
  eliminated fabricated status reports"; fresh-context verifier sub-agents
  beat self-critique.

## 7. Recommendation for Windsor

Keep the parallelism and the durable state. Move the loop, the status and
the gate out of the model.

1. **State: GitHub Issues, and nothing the agent has to write.** A `ready`
   label is the claim gate; assignment marks in-progress; `Fixes #N` closes
   on merge. If a Projects board is wanted, GitHub's agent-session status or
   an Actions automation from PR events writes it. No `board.sh` in any
   agent, no claim comments.
2. **Issue as spec.** Goal, numbered decisions, owned folders and files not
   to touch, acceptance criteria. That is the whole brief; the standing rules
   stay in CLAUDE.md (5.6 kB today, keep it there). No role file. A seam
   ticket lands first when a wave shares a registry, a constants table or an
   export list, which is the one Aotearoa204 device that removed conflicts
   rather than detecting them.
3. **Dispatch from a script, not a session.** For a wave of independent
   tickets use `/batch` or a Workflow script: it decomposes, spawns one
   background sub-agent per unit in its own worktree, and returns only the
   final answers. For two to four tickets, background sessions in agent view
   are enough. Either way no long-lived orchestrator context holds 32
   reports.
4. **Verify once, in CI.** The sub-agent runs the affected test file and
   `tsc` locally, commits, pushes, opens the PR, and ends its turn. The
   `verify` workflow is the gate. Cap local parallel agents at two or three
   on this machine; the measured cause of gate reruns was CPU contention,
   not code.
5. **The PR body is the report.** What changed, how to check it, what fell
   outside the owned folders, and the decision record if one was made. A
   sub-agent's final message is a few lines with the PR number. Keep
   `.claude/handoffs/` for the human's own long sessions, not per ticket.
6. **One writer to main.** tacowars merges, in dependency order, smallest blast
   radius first, squash, rebase only on a real conflict. Batch review PRs.
   Retry an agent at most twice on a red check, then hand to a human.
7. **Effort and time.** Implementers at `medium` on Opus 5.5 (or the Claude
   Code default), Explore and verifier sub-agents at `low`. Try the
   elapsed-time line via a hook on one wave and measure.
8. **Measure every wave.** Rerun `measure-overhead.py` on the Windsor
   transcript folder after each wave and record process share, starting
   context, per-turn context, and time inside `verify`. The Windsor baseline
   today: five process-free sub-agents at 3% process share, median 5 min,
   starting context 12 to 28 k. That is what the floor looks like; a wave
   should be judged against it.

What this gives up: the orchestrator's live relay to tacowars (replaced by PR
notifications and the idle notification of a background session), the
cross-model Codex pass on every PR (keep it on demand for engine DSP and
schema changes), and the per-ticket metrics commit (replaced by the script
run per wave).

## Sources

Repos read on 2026-09-28: `~/code/Aotearoa204` (HEAD `153294a6`) and
`~/code/HOOP`. Transcripts under `~/.claude/projects/`.

Anthropic, fetched 2026-09-28:

- Prompting Claude Opus 5.5:
  <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5>
- Prompting Claude Fable 5 and 5.1 (same site, `prompting-claude-fable-5`,
  `prompting-claude-fable-5-1`)
- Claude Code docs: `agents`, `sub-agents`, `agent-teams`, `workflows`,
  `worktrees`, `agent-view`, `claude-projects`, `hooks`, `costs`,
  `best-practices` under <https://code.claude.com/docs/en/>
- Introducing dynamic workflows in Claude Code (2026-05-28):
  <https://claude.com/blog/introducing-dynamic-workflows-in-claude-code>
- Building a C compiler with a team of parallel Claudes (2026-02-05):
  <https://www.anthropic.com/engineering/building-c-compiler>
- Effective harnesses for long-running agents (2025-11-26):
  <https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents>
- How we built our multi-agent research system (2025-06-13):
  <https://www.anthropic.com/engineering/multi-agent-research-system>

Community and industry, 2026:

- Systima, The subagent tax (2026-07-22): <https://systima.ai/blog/subagent-tax>
- Vaughan, Agent PR merge conflicts (2026-07-28, updated 09-28):
  <https://codex.danielvaughan.com/2026/07/28/agent-pr-merge-conflicts-concurrent-coding-agents-codex-cli-worktree-isolation-coordination-defence/>
- GitHub changelog, agent activity in Issues and Projects (2026-03-26):
  <https://github.blog/changelog/2026-03-26-agent-activity-in-github-issues-and-projects/>
- GitHub changelog, stacked pull requests public preview (2026-07-30):
  <https://github.blog/changelog/2026-07-30-stacked-pull-requests-are-now-in-public-preview/>
- Tian Pan, The merge queue is the new bottleneck (2026-07-02):
  <https://tianpan.co/blog/2026-07-02-the-merge-queue-is-the-new-bottleneck>
- Addy Osmani, Code agent orchestra (2026-03-26):
  <https://addyosmani.com/blog/code-agent-orchestra/>
- Aakash, Parallel Claude Code agents (2026-05-16):
  <https://www.aakashx.com/blog/parallel-claude-code-agents/>
- DoltHub, A day in Gas Town (2026-01-15):
  <https://www.dolthub.com/blog/2026-01-15-a-day-in-gas-town/>
- Paddo, Gas Town: two kinds of multi-agent (2026-01-17):
  <https://paddo.dev/blog/gastown-two-kinds-of-multi-agent/>
- Ready Solutions, When to orchestrate subagents (2026-05-24):
  <https://readysolutions.ai/blog/2026-05-24-when-to-orchestrate-subagents/>
- Digital Applied, Claude Code subagent depth limits and budget caps
  (2026-07-26):
  <https://www.digitalapplied.com/blog/claude-code-subagent-depth-limits-budget-caps-2026>

Not used: one Medium post returned HTTP 403. No source publishes the cost of
board-update calls in isolation; the closest figures are Systima's per-turn
prefix measurement and the numbers in section 2.
