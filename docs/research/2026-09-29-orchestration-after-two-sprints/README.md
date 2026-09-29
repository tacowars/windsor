# The parallel workflow after two sprints: where the allowance went

- **Date:** 2026-09-29
- **Question:** `docs/log/2026-09-28-parallel-workflow-without-an-orchestrator.md`
  moved the gate, the board and the report out of the worker, on the
  evidence of `../2026-09-28-agent-orchestration-overhead/`. Two sprints
  and 39 merged PRs later, did the cost fall where that research said it
  would, where is it now, and what should change?
- **Method:** two scripts in this folder, both stdlib Python, cut off at
  2026-09-29 09:22 UTC so the numbers reproduce while sessions keep writing.
  1. `measure-hub.py` reads every Claude Code transcript for this repo
     (9 main sessions with records before the cut-off, 38 worker
     transcripts) and writes `hub-report.md`.
  2. `pr-rounds.py` reads the 39 merged PRs from #18 (the first under the
     workflow) through #84 from the GitHub API and writes `pr-report.md`.
  Section 5 lists what each number means and what it does not.
- **Machine:** transcripts read on tacowars's Mac (Darwin 25.5), Claude
  Code 2.1.283 and 2.1.284. Main sessions ran Opus 5.5 or Fable 5.1;
  workers ran Opus 5.5.

"Tokens" below are input-side context per API call: fresh input plus cache
reads plus cache writes. On a Max subscription cache reads draw on the
allowance, so this is the quantity that runs a window down.

## 1. Answer in short

The worker-side fixes worked. The cost moved to the main session.

- **The gate is gone from the worker.** Across all 38 workers, vitest,
  typecheck and lint took 57 minutes of tool time in total, against 3 h
  29 min for `ticket-finish.sh` alone over 26 Aotearoa204 tickets. Test and
  lint output is 6% of the tool-result characters a worker reads.
- **Workers start small.** Starting context is 29 to 30k tokens, against
  43 to 45k with the Aotearoa204 role file.
- **The main session is 40% of the tokens.** The five sessions that
  launched workers used 204.5M tokens themselves against 308.0M for all
  their sub-agents.

The main session is expensive because it runs long, not because it calls
many tools. Its context per call grew from a median of about 110k in the
first quarter of a long session to about 370k in the last, and no session
compacted. 36% of all main-session tokens, 102.8M, is context carried
above 150k.

## 2. Where the main session's tokens went

From `hub-report.md`.

| session | calls | median context | max | first quarter / last quarter | above 150k |
|---|---|---|---|---|---|
| f7863305 | 317 | 245k | 415k | 110k / 370k | 32.0M of 76.0M |
| ea1938b7 | 298 | 228k | 409k | 108k / 369k | 29.6M of 70.8M |
| 7e89a6da | 124 | 234k | 295k | 157k / 283k | 9.6M of 27.5M |
| 19cfc312 | 121 | 133k | 209k | 71k / 185k | 1.2M of 15.6M |

**What woke it.** A message from tacowars started 125 turns and 56% of the
tokens. The rest came without anyone typing:

| trigger | turns started | tokens | share |
|---|---|---|---|
| Monitor or background wait on CI and Codex | 63 | 62.6M | 22% |
| a worker's hand-back | 72 | 61.4M | 21% |
| an agent finished | 11 | 3.4M | 1% |

A Codex or CI wake cost about 1M tokens: about four calls at a quarter of
a million each, to read a verdict and act on it. Codex itself answers in a
median 3.4 minutes after a push (`pr-report.md`), so the waiting is short
and the cost is the context each wake reloads.

**What it did with the calls.** `gh` 25% of main-session tokens, a reply
with no tool 21%, shell reads and edits 16%, the browser 13%, `git` 8%.
The browser share is the main session re-checking UI in headless Chrome at
full context, mostly for the overnight auto-merge.

## 3. Where the workers' tokens went

From `hub-report.md`.

- **Reading code fills the context.** `sed`, `cat` and `head` output is
  43% of tool-result characters, `grep`, `find` and `ls` 20%, `Read` 14%.
  That is the work, not overhead. The #47 fix brief, which named the rule
  in `workletMessages.ts` to follow, was fixed on the first try; a brief
  that points at file and line saves reading.
- **Fix rounds in the same worker are a third of worker tokens.** A fix
  round was sent to the worker that wrote the PR. Those continued rounds
  used 109.9M tokens, 36% of all worker tokens, at a median 171k per call,
  against 115k per call in first runs. Four fix rounds went to a fresh
  `worker-light` instead: they started at 30 to 31k and used 0.6M, 0.7M,
  1.6M and 7.1M. The fixes differed in size, so this is a pointer, not a
  controlled comparison.
- **Hand-backs are longer than the rule.** Median 863 characters against
  "the PR URL and one line". At a few hundred tokens each, that costs
  nothing next to the wake that reads it; not worth enforcing.

## 4. Where the wall clock and the rounds went

From `pr-report.md` and the main sessions' retro notes.

- **Codex found real problems cheaply.** 61 P0 or P1 findings on 18 of
  39 PRs, from the Codex allowance, not Claude's.
- **Rounds follow behaviour, not size.** PRs over 1,000 changed lines
  averaged 2.67 extra rounds (n = 9), against 0.69 under 300 (n = 16). But
  #61 (3,595 lines, a mechanical retirement) and #44 (966 lines, a
  schema change) needed none, and #68 (1,628 lines) needed one. The three
  PRs past the two-round cap were features with many interacting states:
  #47 (WAV export: render, encode, cancel, save), #71 (modulation lanes)
  and #79 (editing the selected region). Each review found the next
  interaction.
- **Epic #70's seam worked.** #77 landed the region-pattern seam with no
  extra round, and #78 built on it with two.
- **Overnight waits are by design.** #71 and #79 waited 9.4 h and 8.5 h
  from open to merge, past the round cap, for tacowars. The draft next
  rounds (#82, #83) had Codex's approval before tacowars read them.
- **A red `main` cost a stretch of CI.** A stems test in #69 ran about
  6 s on CI against vitest's 5 s default after passing on its branch, and
  every PR branched after it failed `verify` until #81 set a budget.

## 5. What changes

Recorded in `docs/log/2026-09-29-the-main-session-stays-small.md` and in
`CLAUDE.md` "Working a ticket".

1. **Rotate the main session at about 150k context.** Write the handoff
   and start a fresh session, or compact. A session starts small (the
   shortest one here, `3d9b9710`, ran at 41 to 49k per call); the measured
   cost of not rotating is 102.8M over two days.
2. **One wake per PR decision.** Watch a PR until `verify` has finished
   and Codex has reviewed its head (matched on `original_commit_id`), and
   wake once, not on each event.
3. **A fix round goes to a fresh worker.** The brief is the findings, with
   file and line, and the rule to follow; the profile is usually
   `worker-light`. Trial it for a wave and compare with section 3.
4. **Split by behaviour before launch.** Work whose states interact
   (cancel, timing, selection, live edits) and that is expected past about
   800 changed lines is split, a seam first, as Epic #70 was. The issue
   lists the interactions as boundary cases.
5. **The main session delegates its own browser checks** to a sub-agent,
   as decision 9 of the parallel-workflow record already says for
   verifiers.

## 6. Trials and follow-ups, not decided

- **A PR status script.** One line per open PR: head, `verify` state,
  Codex's verdict on the head and its P0/P1 titles. It would make rule 2
  one call instead of several `gh` calls. Not built.
- **Worker effort and model.** `worker` at `medium` on an engine ticket,
  and Sonnet on `worker-light` tickets, both still unmeasured (the
  thin-profiles record deferred the second). Worker wall clock is mostly
  model time: a median 24% of a sub-agent's elapsed time is inside tools.
- **A CI time budget for slow suites**, so a test near vitest's 5 s
  default cannot turn `main` red.

## 7. Caveats

- Durations are elapsed time and include permission prompts and waits for
  tacowars.
- Session `7f5876dc` was still being written at the cut-off; its figures
  cover the part before it.
- The first waves ran workers as `general-purpose` agents with a worker
  prompt; `measure-hub.py` counts them as workers by their prompt.
- "Extra rounds" is commits minus one, a proxy: a rebase or a second
  commit within one round also counts.
- A main-session call is attributed to the last message that started its
  turn, and its context is split evenly between the kinds of tool it
  called. Both are attributions, not causes: a call that follows a
  hand-back may be the main session merging, which it would do anyway.
- The 24% in-tool share comes from `../2026-09-28-agent-orchestration-overhead/measure-overhead.py`,
  whose `windsor` section reads the same folder. That script rewrites its
  own report file, so run a copy.

## Reproduce

```bash
python3 measure-hub.py > hub-report.md
python3 pr-rounds.py > pr-report.md   # needs an authenticated gh
```

Both take `--until <ISO time>`; the default is the cut-off above.
