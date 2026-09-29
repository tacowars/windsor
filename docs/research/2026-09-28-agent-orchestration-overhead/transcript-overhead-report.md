# Sub-agent tool-call and token overhead, measured from Claude Code transcripts

Generated 2026-09-28T13:00:31 by measure-overhead.py from `/Users/arrakis/.claude/projects`. All numbers are counted from the jsonl records; nothing is estimated. Token sums dedupe assistant records by `message.id` (the transcript stores one record per content block, repeating the same usage).
- Schema as found: main session = `<project>/<uuid>.jsonl`; sub-agent = `<project>/<uuid>/subagents/agent-<id>.jsonl` plus `agent-<id>.meta.json` (agentType, description, toolUseId, spawnDepth, isFork). Sub-agent records have `isSidechain: true` and `agentId`; none are stored inline in the parent file.
- Fields present: `type`, `timestamp`, `message.role/content/usage/id/model`, `requestId`, `toolUseResult`, `cwd`, `version`, `gitBranch`. No `parentAgentId` field exists; the link to the launching Agent tool_use is `meta.toolUseId`.
- Wall-clock duration = first to last record timestamp in the transcript file.
- Bash classification splits each command into shell segments (heredoc bodies removed) and reports both the first informative segment per call (`primary`) and all segments; python/node heredocs are their own buckets, with `python-inline:edit` when the body writes a file.

## Aotearoa204

- Main session files: 31 (with any assistant turn: 25); assistant API turns in main sessions: 2734
- Sub-agent transcripts: 35; date range: 2026-09-04 .. 2026-09-27
- Claude Code versions seen: 2.1.251, 2.1.260, 2.1.261, 2.1.265, 2.1.268, 2.1.270, 2.1.271, 2.1.273, 2.1.274, 2.1.277, 2.1.278, 2.1.280, 2.1.281, 2.1.282, 2.1.283
- Sub-agent types (from .meta.json): {'ticket-implementer': 26, 'Explore': 2, 'general-purpose': 7}
- spawnDepth: {1: 32, 2: 3}
- Tool calls: main sessions 2993, sub-agents 1615
- Tokens, main sessions: input+cache_read 682481.5k, cache_create 12131.3k, assistant output chars 4290.3k (recorded output_tokens 2937.8k, undercounts; see caveats)
- Tokens, sub-agents: input+cache_read 188108.5k, cache_create 7838.1k, assistant output chars 2180.8k (recorded output_tokens 48.6k, undercounts)
- Harness cost-state totals over all main sessions (sub-agents included): cost USD 732.83, output tokens 4342.6k

### Per sub-agent transcript

| # | parent | type | role | tools | Bash | Read | Edit | Write | Grep/Glob | other | turns | dur | out chars | out tok (recorded, undercounts) | in+cache_read | cache_create | first-turn ctx (in+read / +create) | prompt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | e58ef4d7 | ticket-implementer | implementer | 21 | 18 | 2 | 0 | 0 | 0 | 1 | 23 | 10m17s | 25.7k | 597 | 1562.2k | 84.1k | 2 / 44.0k | Ticket: #669 — "Share the loop, filter and LFO mode ids between the FM worklet and patch.ts". Board status Ready. Start  |
| 2 | e58ef4d7 | ticket-implementer | implementer | 69 | 66 | 2 | 0 | 0 | 0 | 1 | 68 | 28m52s | 78.8k | 1.1k | 8305.5k | 271.4k | 25.3k / 44.2k | Ticket: #671 — "Bring the reverb worklet under the worklet folder's rules: golden test, a WORKLETS row, TypeScript split |
| 3 | e58ef4d7 | ticket-implementer | implementer | 70 | 57 | 3 | 0 | 1 | 0 | 9 | 75 | 1h22m | 67.9k | 2.6k | 7351.1k | 342.1k | 25.3k / 44.1k | Ticket: #670 — "One patch-defaults table for the worklet's patchNormalise and makePatch, pinned by a test". Board status |
| 4 | 451b3889 | ticket-implementer | implementer | 24 | 22 | 1 | 0 | 0 | 0 | 1 | 26 | 21m39s | 22.6k | 1.0k | 1373.7k | 208.4k | 2 / 43.1k | Ticket: #676 on tacowars/Aotearoa204 — "Reverb follow-ups: the settled-SIZE sleep test feeds cancelling clicks, and seve |
| 5 | 451b3889 | ticket-implementer | implementer | 36 | 29 | 4 | 2 | 0 | 0 | 1 | 35 | 22m10s | 37.8k | 1.6k | 2719.8k | 245.3k | 2 / 43.5k | Ticket: #677 on tacowars/Aotearoa204 — "ticket-finish.sh checks the GraphQL quota before verify; the merge protocol read |
| 6 | 451b3889 | Explore | explore | 33 | 24 | 8 | 0 | 0 | 0 | 1 | 26 | 2m33s | 23.2k | 2.2k | 1679.0k | 107.1k | 2 / 14.5k | Repo: /Users/arrakis/code/Aotearoa204 (TypeScript monorepo: packages/shared, packages/server, packages/client). I am ref |
| 7 | 451b3889 | ticket-implementer | implementer | 25 | 24 | 0 | 0 | 0 | 0 | 1 | 26 | 24m09s | 27.4k | 1.2k | 1415.9k | 284.0k | 2 / 43.1k | Ticket: #683 on tacowars/Aotearoa204 — "music-engine skill: fix three pre-#655 paths, add the #660/#666/#667 engine and  |
| 8 | 451b3889 | ticket-implementer | implementer | 73 | 64 | 6 | 0 | 0 | 0 | 3 | 44 | 15h53m | 109.6k | 2.4k | 7118.0k | 379.2k | 2 / 43.8k | Ticket: #686 on tacowars/Aotearoa204 — "Classic string-machine patch bank (Solina, OB, Juno, D-50, JP-8, supersaw) for E |
| 9 | 451b3889 | ticket-implementer | implementer | 19 | 18 | 0 | 0 | 0 | 0 | 1 | 20 | 12m18s | 13.5k | 631 | 1051.8k | 131.6k | 2 / 43.2k | Ticket: #682 on tacowars/Aotearoa204 — "Add an adjustable MIDIVerb-inspired reverb insert". Open PR #685, branch `featur |
| 10 | 451b3889 | general-purpose | research | 31 | 0 | 0 | 0 | 0 | 0 | 31 | 19 | 4m29s | 20.7k | 396 | 1072.9k | 76.7k | 2 / 39.3k | You are a research assistant. Using WebSearch and WebFetch only (no file edits, no repo access needed), compile a cited  |
| 11 | 451b3889 | ticket-implementer | implementer | 7 | 6 | 0 | 0 | 0 | 0 | 1 | 8 | 6m38s | 6.8k | 505 | 334.0k | 52.0k | 2 / 43.2k | Ticket: #686 on tacowars/Aotearoa204 — the classic string-machine patch bank. Open PR #688, branch `feature/686-classic- |
| 12 | 632d6ed4 | ticket-implementer | implementer | 66 | 57 | 6 | 0 | 1 | 0 | 2 | 66 | 17m35s | 55.1k | 2.5k | 6223.5k | 134.9k | 2 / 43.1k | Ticket #636 (tacowars/Aotearoa204): `ticket-finish.sh` runs a `verify:docs` target on a docs-only diff, with CI parity.  |
| 13 | 632d6ed4 | ticket-implementer | implementer | 20 | 18 | 1 | 0 | 0 | 0 | 1 | 21 | 10m26s | 26.1k | 459 | 1307.3k | 76.3k | 2 / 43.1k | Ticket #690 (tacowars/Aotearoa204): `scripts/lib/ciRegister.sh` reads the PR's mergeability before polling for a CI run. |
| 14 | 632d6ed4 | ticket-implementer | implementer | 108 | 104 | 2 | 0 | 0 | 0 | 2 | 109 | 46m17s | 161.2k | 1.6k | 17848.3k | 663.6k | 2 / 43.7k | Your ticket is #695 in tacowars/Aotearoa204: add an ensemble insert (Solina-style, three phases, slow + fast LFO), raise |
| 15 | 632d6ed4 | general-purpose | research | 64 | 31 | 7 | 0 | 0 | 0 | 26 | 49 | 7m18s | 29.9k | 3.4k | 3729.6k | 108.9k | 15.8k / 34.6k | Research task (read-only, web only; no paid APIs; do not edit any files in any repo). I am implementing a Solina-style s |
| 16 | 4aad2802 | Explore | research | 42 | 41 | 0 | 0 | 0 | 0 | 1 | 33 | 4m03s | 37.4k | 1.5k | 3950.8k | 181.0k | 2 / 15.2k | Read-only survey of the Aotearoa204 music engine (repo /Users/arrakis/code/Aotearoa204, branch main) to ground a redesig |
| 17 | 4aad2802 | general-purpose | general-purpose | 22 | 12 | 0 | 0 | 1 | 0 | 9 | 16 | 10m10s | 50.9k | 631 | 1414.9k | 109.2k | 2 / 36.2k | Build static UI mockups for a design discussion about the Aotearoa204 arrangement console (`tools/patch-editor/` in /Use |
| 18 | 4aad2802 | general-purpose | general-purpose | 28 | 3 | 4 | 9 | 0 | 0 | 12 | 17 | 7m23s | 30.9k | 845 | 2516.3k | 184.7k | 2 / 35.5k | Extend an existing static mockup page for the Aotearoa204 arrangement console. Do NOT touch the repo; work only in the s |
| 19 | 4aad2802 | general-purpose | general-purpose | 22 | 2 | 7 | 2 | 1 | 0 | 10 | 14 | 9m16s | 64.0k | 1.6k | 2194.4k | 277.3k | 2 / 36.3k | Rework an existing static mockup page for the Aotearoa204 arrangement console. Do NOT touch the repo; work only in the s |
| 20 | 4aad2802 | ticket-implementer | implementer | 101 | 99 | 1 | 0 | 0 | 0 | 1 | 102 | 22m34s | 113.9k | 2.0k | 17652.2k | 257.0k | 2 / 43.9k | Ticket #704 — Harmony v2 T0: delete the legacy arp and step generators, the degree weights, note capture and the shipped |
| 21 | 4aad2802 | ticket-implementer | implementer | 119 | 101 | 5 | 0 | 11 | 0 | 2 | 96 | 53m39s | 349.5k | 3.3k | 26474.0k | 787.2k | 2 / 44.5k | Ticket #705 — Harmony v2 T1 (seam): document v3 — transport bars, the harmony timeline, regions and the restart rule, pe |
| 22 | 4aad2802 | general-purpose | general-purpose | 78 | 76 | 1 | 0 | 0 | 0 | 1 | 77 | 15m17s | 106.8k | 945 | 12685.5k | 258.7k | 2 / 34.1k | Read and follow the brief at /private/tmp/claude-501/-Users-arrakis-code-Aotearoa204/4aad2802-eb29-4680-a845-f0e3635b008 |
| 23 | 4aad2802 | ticket-implementer | implementer | 70 | 61 | 2 | 0 | 6 | 0 | 1 | 68 | 37m51s | 81.9k | 1.0k | 8132.5k | 588.6k | 2 / 43.7k | Ticket #706 — Harmony v2 T2: the Arpeggiator. Repo tacowars/Aotearoa204. Read the issue body first (its Decisions define |
| 24 | 4aad2802 | ticket-implementer | implementer | 77 | 70 | 2 | 0 | 4 | 0 | 1 | 78 | 37m45s | 87.0k | 2.0k | 9393.5k | 622.0k | 2 / 43.8k | Ticket #707 — Harmony v2 T3: Bass / Drone. Repo tacowars/Aotearoa204. Read the issue body first (its Decisions define th |
| 25 | 4aad2802 | ticket-implementer | implementer | 82 | 71 | 1 | 0 | 2 | 0 | 8 | 80 | 34m16s | 104.2k | 2.6k | 10990.4k | 351.7k | 2 / 44.1k | Ticket #708 — Harmony v2 T4: the persistent transport strip — BPM, bars, key and scale, bar.beat.sixteenth position, pla |
| 26 | 4aad2802 | ticket-implementer | implementer | 12 | 11 | 0 | 0 | 0 | 0 | 1 | 13 | 4m37s | 7.8k | 723 | 604.9k | 56.6k | 2 / 43.4k | Ticket #706 — follow-up round on its open PR #714 (branch `feature/706-harmony-v2-t2-the-arpeggiator-chord-tone`, head ` |
| 27 | 4aad2802 | ticket-implementer | implementer | 12 | 11 | 0 | 0 | 0 | 0 | 1 | 13 | 5m18s | 15.5k | 974 | 704.4k | 38.8k | 25.3k / 43.4k | Ticket #706 — follow-up round on its open PR #714 (branch `feature/706-harmony-v2-t2-the-arpeggiator-chord-tone`, head ` |
| 28 | 4aad2802 | ticket-implementer | implementer | 16 | 15 | 0 | 0 | 0 | 0 | 1 | 17 | 5m50s | 17.9k | 891 | 956.1k | 69.7k | 2 / 43.4k | Ticket #706 — follow-up round on its open PR #714 (branch `feature/706-harmony-v2-t2-the-arpeggiator-chord-tone`, head ` |
| 29 | 4aad2802 | ticket-implementer | implementer | 11 | 10 | 0 | 0 | 0 | 0 | 1 | 12 | 4m52s | 10.9k | 676 | 619.2k | 36.4k | 25.3k / 43.2k | Ticket #706 — follow-up round on its open PR #714 (branch `feature/706-harmony-v2-t2-the-arpeggiator-chord-tone`, head ` |
| 30 | 4aad2802 | ticket-implementer | implementer | 14 | 13 | 0 | 0 | 0 | 0 | 1 | 15 | 5m19s | 11.0k | 584 | 805.3k | 39.6k | 25.3k / 43.7k | Ticket #707 — follow-up round on its open PR #713 (branch `feature/707-harmony-v2-t3-bass-drone-follow-root`, head `b8fe |
| 31 | 4aad2802 | ticket-implementer | implementer | 107 | 68 | 3 | 7 | 14 | 0 | 15 | 49 | 35m01s | 202.9k | 1.0k | 12147.0k | 329.3k | 2 / 44.8k | Ticket #709 — Harmony v2 T5: the Song view — bar ruler, harmony lane, region lanes, one playhead, the detail pane hostin |
| 32 | 33619b00 | ticket-implementer | implementer | 21 | 19 | 1 | 0 | 0 | 0 | 1 | 23 | 16m38s | 19.2k | 955 | 1174.9k | 127.1k | 2 / 43.5k | Ticket #717 — Ship tacowars's fresh song as bed-01, the game's default arrangement, replacing the T0 placeholder. Repo tacowa |
| 33 | 33619b00 | ticket-implementer | implementer | 79 | 75 | 1 | 0 | 2 | 0 | 1 | 80 | 20m42s | 77.0k | 1.7k | 9636.2k | 170.7k | 2 / 43.6k | Ticket #719 — Devx cleanup: 60 s timeouts on the eight render/budget tests, ticket-finish picks the worker cap and check |
| 34 | 33619b00 | ticket-implementer | implementer | 9 | 8 | 0 | 0 | 0 | 0 | 1 | 10 | 6m21s | 13.3k | 669 | 534.5k | 41.2k | 25.5k / 43.2k | Ticket #720 — Docs: three pre-epic statements in the music-engine skill and the audio architecture doc still describe th |
| 35 | 70d394c4 | general-purpose | docs | 27 | 23 | 3 | 0 | 0 | 0 | 1 | 27 | 5m13s | 72.5k | 1.7k | 2428.9k | 145.7k | 2 / 36.3k | You are editing documentation in the repo at /Users/arrakis/code/windsor (a fresh fork of a music engine out of the Aote |

### Sub-agent aggregates

| metric | median | p90 | max |
|---|---|---|---|
| tool calls per sub-agent | 31 | 101 | 119 |
| Bash calls per sub-agent | 24 | 76 | 104 |
| assistant turns per sub-agent | 26 | 80 | 109 |
| duration | 12m18s | 46m17s | 15h53m |
| total input incl. cache_read | 2428.9k | 12685.5k | 26474.0k |
| total cache_create | 170.7k | 588.6k | 787.2k |
| assistant output chars (text+thinking+tool_use JSON; measured) | 37.4k | 113.9k | 349.5k |
| output tokens as recorded (UNRELIABLE, see caveats) | 1.0k | 2.6k | 3.4k |
| first-turn context (input+cache_read) | 2 | 25.3k | 25.5k |
| first-turn context incl. cache_create | 43.4k | 44.1k | 44.8k |
| context per turn (input+cache_read+create)/turns | 95.3k | 175.6k | - |

#### By role

| role | n | median tools | median dur | median out chars | median in+cache_read | median first ctx |
|---|---|---|---|---|---|---|
| docs | 1 | 27 | 5m13s | 72.5k | 2428.9k | 2 |
| explore | 1 | 33 | 2m33s | 23.2k | 1679.0k | 2 |
| general-purpose | 4 | 25 | 9m43s | 57.5k | 2355.4k | 2 |
| implementer | 26 | 30 | 21m11s | 32.6k | 2141.0k | 2 |
| research | 3 | 42 | 4m29s | 29.9k | 3729.6k | 2 |

#### Tool-call share across all sub-agents

| tool | calls | share |
|---|---|---|
| Bash | 1327 | 82% |
| Read | 73 | 5% |
| Write | 43 | 3% |
| SubagentHandback | 37 | 2% |
| WebFetch | 33 | 2% |
| Edit | 20 | 1% |
| WebSearch | 20 | 1% |
| ToolSearch | 11 | 1% |
| mcp__chrome-devtools__evaluate_script | 8 | 0% |
| mcp__chrome-devtools__new_page | 6 | 0% |
| mcp__chrome-devtools__close_page | 6 | 0% |
| Artifact | 6 | 0% |
| mcp__chrome-devtools__take_screenshot | 5 | 0% |
| Skill | 4 | 0% |
| mcp__chrome-devtools__resize_page | 4 | 0% |
| Agent | 3 | 0% |
| mcp__chrome-devtools__list_console_messages | 3 | 0% |
| Monitor | 2 | 0% |
| TaskStop | 2 | 0% |
| mcp__chrome-devtools__take_snapshot | 1 | 0% |
| mcp__chrome-devtools__navigate_page | 1 | 0% |

#### Bash buckets (sub-agents): primary bucket per call, and per shell segment

Bash calls: 1327; shell segments after splitting on `&&`, `;`, `|`, newlines and dropping `cd`/`export`/`echo` preambles: 6217 (4.7 per call)

| bucket | calls (primary) | share | segments | share |
|---|---|---|---|---|
| read:shell | 604 | 46% | 3733 | 60% |
| other | 23 | 2% | 400 | 6% |
| git:inspect | 75 | 6% | 396 | 6% |
| edit:shell | 143 | 11% | 261 | 4% |
| python-inline:edit | 191 | 14% | 225 | 4% |
| verify:test | 37 | 3% | 205 | 3% |
| shell-control | 2 | 0% | 179 | 3% |
| script:process | 72 | 5% | 137 | 2% |
| git:commit | 3 | 0% | 96 | 2% |
| verify:lint/typecheck | 7 | 1% | 89 | 1% |
| node-other | 21 | 2% | 77 | 1% |
| git:other | 22 | 2% | 58 | 1% |
| git:push | 4 | 0% | 38 | 1% |
| gh:project/api | 11 | 1% | 35 | 1% |
| gh:issue | 15 | 1% | 34 | 1% |
| verify:format | 5 | 0% | 33 | 1% |
| poll/wait | 24 | 2% | 30 | 0% |
| gh:pr | 11 | 1% | 30 | 0% |
| verify:build | 8 | 1% | 25 | 0% |
| npm-other | 7 | 1% | 24 | 0% |
| verify:verify | 3 | 0% | 24 | 0% |
| script:build | 3 | 0% | 21 | 0% |
| web:shell | 14 | 1% | 17 | 0% |
| node-inline | 9 | 1% | 15 | 0% |
| python-inline:other | 5 | 0% | 14 | 0% |
| git:worktree | 5 | 0% | 13 | 0% |
| gh:other | 2 | 0% | 5 | 0% |
| python-script | 1 | 0% | 3 | 0% |

Repo scripts called (segments, by basename):

| script | segments |
|---|---|
| ticket-finish.sh | 63 |
| ticket-start.sh | 34 |
| codex-pass.sh | 19 |
| build-worklets.mjs | 12 |
| log.sh | 5 |
| ciRegister.sh | 5 |
| patch-library-index.mjs | 4 |
| dev-bootstrap.sh | 4 |
| board.sh | 3 |
| ticketFixture.mjs | 3 |
| 671-purity.mjs | 3 |
| verifyPreflight.sh | 1 |
| client-dir-table.mjs | 1 |
| workletBundle.mjs | 1 |

#### Process share (all tool calls, primary bucket)

| group | calls | share |
|---|---|---|
| process | 228 | 14% |
| work | 1180 | 73% |
| inspect/other | 207 | 13% |

process = gh:*, git worktree/commit/push/other, repo scripts (board/ticket/handoff), poll/wait, codex/claude CLI, SubagentHandback, Skill, ToolSearch, Agent, Monitor, TaskStop. work = shell reads/edits, python/node inline, npm/npx verify/test/lint/build, Read/Edit/Write/Grep/Glob. inspect/other = git status/log/diff, web, MCP, unclassified.

| role | process | work | inspect/other |
|---|---|---|---|
| docs (n=1) | 1 (4%) | 26 (96%) | 0 (0%) |
| explore (n=1) | 1 (3%) | 29 (88%) | 3 (9%) |
| general-purpose (n=4) | 10 (7%) | 113 (75%) | 27 (18%) |
| implementer (n=26) | 211 (17%) | 955 (75%) | 102 (8%) |
| research (n=3) | 5 (4%) | 57 (42%) | 75 (55%) |

Per-sub-agent process share: median 15%, p90 35%

#### Wall time inside tool calls (tool_use record to tool_result record), sub-agents, by bucket

Matched 1615/1615 tool calls to a result record. Total time inside tools 5h57m of 26h32m elapsed across all sub-agents; per sub-agent share of elapsed time inside tools: median 62%, p90 89%. The rest is model time (thinking, generation) plus harness/permission waits.

| bucket | calls | time | share of tool time | mean s/call |
|---|---|---|---|---|
| Bash/script:process | 72 | 2h16m | 38% | 114 |
| Bash/edit:shell | 143 | 39m06s | 11% | 16 |
| Bash/read:shell | 604 | 36m21s | 10% | 4 |
| Bash/other | 23 | 29m30s | 8% | 77 |
| Bash/git:inspect | 75 | 24m32s | 7% | 20 |
| Bash/python-inline:edit | 191 | 18m21s | 5% | 6 |
| Bash/verify:test | 37 | 11m31s | 3% | 19 |
| Write | 43 | 11m24s | 3% | 16 |
| Bash/git:push | 4 | 11m21s | 3% | 170 |
| Bash/gh:pr | 11 | 4m07s | 1% | 23 |
| Bash/npm-other | 7 | 3m53s | 1% | 33 |
| WebFetch | 33 | 3m17s | 1% | 6 |
| Bash/verify:verify | 3 | 3m00s | 1% | 60 |
| Bash/git:other | 22 | 2m52s | 1% | 8 |
| Bash/verify:format | 5 | 2m28s | 1% | 30 |
| WebSearch | 20 | 2m24s | 1% | 7 |

Tool time by group: process 2h40m (45%), work 2h13m (37%), inspect/other 1h03m (18%)

Tool time includes any permission-prompt wait before the command ran; parallel tool calls in one turn overlap, so per-transcript shares can exceed 100%.

Duration of Bash calls that invoke a repo script (whole call, which may include other segments):

| script | calls | median s | p90 s | max s | total |
|---|---|---|---|---|---|
| ticket-finish.sh | 60 | 214 | 467 | 551 | 3h29m |
| ticket-start.sh | 32 | 24 | 51 | 95 | 16m26s |
| patch-library-index.mjs | 4 | 19 | 553 | 553 | 9m53s |
| dev-bootstrap.sh | 4 | 42 | 62 | 62 | 2m42s |
| build-worklets.mjs | 11 | 3 | 37 | 38 | 2m01s |
| codex-pass.sh | 19 | 1 | 3 | 42 | 1m07s |
| board.sh | 3 | 12 | 14 | 14 | 0m37s |
| ticketFixture.mjs | 2 | 18 | 18 | 18 | 0m35s |
| ciRegister.sh | 2 | 14 | 28 | 28 | 0m28s |
| log.sh | 5 | 1 | 3 | 3 | 0m09s |
| 671-purity.mjs | 2 | 2 | 3 | 3 | 0m04s |
| workletBundle.mjs | 1 | 3 | 3 | 3 | 0m02s |
| verifyPreflight.sh | 1 | 1 | 1 | 1 | 0m01s |
| client-dir-table.mjs | 1 | 1 | 1 | 1 | 0m01s |

#### Implementer phases: orient (calls before the first edit) / implement / finish (from the first `ticket-finish` call to the end)

| sub-agent | tools | orient calls | orient time | implement calls | implement time | finish calls | finish time | finish share of calls | finish share of time |
|---|---|---|---|---|---|---|---|---|---|
| 5ae02ff5 | 21 | 6 | 1m54s | 12 | 3m15s | 3 | 5m07s | 14% | 50% |
| 8ecbcbaa | 69 | 11 | 1m56s | 44 | 10m42s | 14 | 16m13s | 20% | 56% |
| 5c31a96e | 70 | 12 | 2m53s | 27 | 7m43s | 31 | 1h11m | 44% | 87% |
| 464d7424 | 24 | 6 | 0m58s | 11 | 2m34s | 7 | 18m06s | 29% | 84% |
| 296c7eca | 36 | 8 | 1m23s | 4 | 1m32s | 24 | 19m13s | 67% | 87% |
| a549956d | 25 | 4 | 0m53s | 6 | 1m36s | 15 | 21m40s | 60% | 90% |
| 0c7543ba | 73 | 34 | 7m44s | 24 | 15h31m | 15 | 13m45s | 21% | 1% |
| e9256524 | 19 | 4 | 0m25s | 5 | 0m24s | 10 | 11m28s | 53% | 93% |
| 8bbde806 | 7 | 4 | 3m09s | 1 | 0m08s | 2 | 3m20s | 29% | 50% |
| 438dd8ea | 66 | 23 | 3m43s | 0 | 0m00s | 43 | 13m51s | 65% | 79% |
| e90a2015 | 20 | 3 | 1m32s | 14 | 4m55s | 3 | 3m58s | 15% | 38% |
| a485dddb | 108 | 18 | 4m14s | 84 | 28m41s | 6 | 13m22s | 6% | 29% |
| a7bb05e9 | 101 | 19 | 2m55s | 79 | 15m33s | 3 | 4m05s | 3% | 18% |
| b0caa810 | 119 | 21 | 5m28s | 92 | 42m59s | 6 | 5m10s | 5% | 10% |
| 6e323f93 | 70 | 20 | 5m25s | 39 | 7m55s | 11 | 24m30s | 16% | 65% |
| 0b0e5fd0 | 77 | 25 | 4m13s | 44 | 9m25s | 8 | 24m05s | 10% | 64% |
| 08bec531 | 82 | 22 | 4m27s | 47 | 13m43s | 13 | 16m04s | 16% | 47% |
| 740e6b6b | 12 | 10 | 0m51s | 0 | 0m00s | 2 | 3m45s | 17% | 81% |
| d9bf2102 | 12 | 3 | 0m40s | 6 | 0m42s | 3 | 3m55s | 25% | 74% |
| 84c18ecb | 16 | 4 | 0m27s | 7 | 1m04s | 5 | 4m18s | 31% | 74% |
| c543cc27 | 11 | 5 | 0m35s | 4 | 0m26s | 2 | 3m50s | 18% | 79% |
| a98708b5 | 14 | 4 | 0m26s | 8 | 1m04s | 2 | 3m48s | 14% | 71% |
| e343bd19 | 107 | 32 | 8m24s | 70 | 22m09s | 5 | 4m28s | 5% | 13% |
| 5ddf80c9 | 21 | 4 | 1m47s | 10 | 2m15s | 7 | 12m36s | 33% | 76% |
| b43899b5 | 79 | 7 | 1m11s | 43 | 6m04s | 29 | 13m27s | 37% | 65% |
| 0610862f | 9 | 5 | 1m06s | 2 | 0m20s | 2 | 4m54s | 22% | 77% |

Medians over implementers: orient share of calls 25% (time 11%), finish share of calls 20% (time 68%); implementers that never called ticket-finish: 0/26

What the finish phase is made of (all implementers, calls from the first ticket-finish to the end):

| bucket | calls | time inside tool | mean s/call |
|---|---|---|---|
| Bash/read:shell | 56 | 5m27s | 6 |
| Bash/script:process | 34 | 2h05m | 222 |
| SubagentHandback | 28 | 0m33s | 1 |
| Bash/git:inspect | 22 | 20m09s | 55 |
| Bash/edit:shell | 21 | 19m09s | 55 |
| Read | 17 | 0m00s | 0 |
| Bash/python-inline:edit | 17 | 2m23s | 8 |
| Bash/other | 11 | 27m42s | 151 |
| Bash/verify:test | 10 | 4m41s | 28 |
| Bash/gh:pr | 9 | 4m01s | 27 |
| Bash/gh:project/api | 8 | 0m26s | 3 |
| Bash/poll/wait | 7 | 0m04s | 1 |

Finish phase totals: 271 calls, 3h43m inside tools, 1h57m outside tools (model turns, harness, waits).

#### Top 10 longest sub-agent runs (by wall clock)

| dur | type | role | tools | tool breakdown (top 6) | top Bash buckets | process/work/other | turns | out chars | in+cache_read | cache_create | first ctx (+create) | prompt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 15h53m | ticket-implementer | implementer | 73 | Bash 64, Read 6, Skill 1, Agent 1, SubagentHandback 1 | read:shell 39, edit:shell 8, git:inspect 4, node-inline 3, script:process 2, git:worktree 2 | 9/59/5 | 44 | 109.6k | 7118.0k | 379.2k | 43.8k | Ticket: #686 on tacowars/Aotearoa204 — "Classic string-machine patch bank (Solina, OB, Juno, D-50, J |
| 1h22m | ticket-implementer | implementer | 70 | Bash 57, Read 3, SubagentHandback 3, ToolSearch 2, Monitor 2, TaskStop 2 | read:shell 17, edit:shell 10, git:inspect 8, script:process 6, python-inline:edit 5, git:other 4 | 23/38/9 | 75 | 67.9k | 7351.1k | 342.1k | 44.1k | Ticket: #670 — "One patch-defaults table for the worklet's patchNormalise and makePatch, pinned by a |
| 53m39s | ticket-implementer | implementer | 119 | Bash 101, Write 11, Read 5, Agent 1, SubagentHandback 1 | read:shell 42, python-inline:edit 31, edit:shell 14, script:process 4, gh:issue 2, git:inspect 2 | 10/107/2 | 96 | 349.5k | 26474.0k | 787.2k | 44.5k | Ticket #705 — Harmony v2 T1 (seam): document v3 — transport bars, the harmony timeline, regions and  |
| 46m17s | ticket-implementer | implementer | 108 | Bash 104, Read 2, Agent 1, SubagentHandback 1 | read:shell 43, edit:shell 24, python-inline:edit 15, script:process 4, node-inline 4, other 4 | 9/94/5 | 109 | 161.2k | 17848.3k | 663.6k | 43.7k | Your ticket is #695 in tacowars/Aotearoa204: add an ensemble insert (Solina-style, three phases, slo |
| 37m51s | ticket-implementer | implementer | 70 | Bash 61, Write 6, Read 2, SubagentHandback 1 | read:shell 31, python-inline:edit 8, verify:test 5, edit:shell 5, script:process 4, gh:issue 2 | 10/58/2 | 68 | 81.9k | 8132.5k | 588.6k | 43.7k | Ticket #706 — Harmony v2 T2: the Arpeggiator. Repo tacowars/Aotearoa204. Read the issue body first ( |
| 37m45s | ticket-implementer | implementer | 77 | Bash 70, Write 4, Read 2, SubagentHandback 1 | read:shell 38, python-inline:edit 11, script:process 4, verify:test 4, git:inspect 3, edit:shell 3 | 10/64/3 | 78 | 87.0k | 9393.5k | 622.0k | 43.8k | Ticket #707 — Harmony v2 T3: Bass / Drone. Repo tacowars/Aotearoa204. Read the issue body first (its |
| 35m01s | ticket-implementer | implementer | 107 | Bash 68, Write 14, Edit 7, mcp__chrome-devtools__evaluate_script 4, Read 3, mcp__chrome-devtools__new_page 2 | read:shell 37, python-inline:edit 11, edit:shell 7, gh:issue 2, script:process 2, git:inspect 2 | 8/84/15 | 49 | 202.9k | 12147.0k | 329.3k | 44.8k | Ticket #709 — Harmony v2 T5: the Song view — bar ruler, harmony lane, region lanes, one playhead, th |
| 34m16s | ticket-implementer | implementer | 82 | Bash 71, Write 2, ToolSearch 2, mcp__chrome-devtools__evaluate_script 2, mcp__chrome-devtools__new_page 1, mcp__chrome-devtools__list_console_messages 1 | read:shell 34, python-inline:edit 12, edit:shell 7, script:process 5, git:inspect 3, poll/wait 2 | 12/61/9 | 80 | 104.2k | 10990.4k | 351.7k | 44.1k | Ticket #708 — Harmony v2 T4: the persistent transport strip — BPM, bars, key and scale, bar.beat.six |
| 28m52s | ticket-implementer | implementer | 69 | Bash 66, Read 2, SubagentHandback 1 | read:shell 25, edit:shell 13, python-inline:edit 4, git:inspect 3, git:other 2, node-other 2 | 15/51/3 | 68 | 78.8k | 8305.5k | 271.4k | 44.2k | Ticket: #671 — "Bring the reverb worklet under the worklet folder's rules: golden test, a WORKLETS r |
| 24m09s | ticket-implementer | implementer | 25 | Bash 24, SubagentHandback 1 | read:shell 11, script:process 3, python-inline:edit 3, verify:test 3, git:inspect 2, edit:shell 1 | 4/18/3 | 26 | 27.4k | 1415.9k | 284.0k | 43.1k | Ticket: #683 on tacowars/Aotearoa204 — "music-engine skill: fix three pre-#655 paths, add the #660/# |

#### First-turn context distribution (input_tokens + cache_read_input_tokens on the first assistant turn)

| stat | in+cache_read | in+cache_read+cache_create |
|---|---|---|
| min | 2 | 14.5k |
| p10 | 2 | 34.6k |
| median | 2 | 43.4k |
| p90 | 25.3k | 44.1k |
| max | 25.5k | 44.8k |

Note: on a sub-agent's first turn the freshly assembled context (system prompt + CLAUDE.md + skills + prompt) is mostly written to cache (cache_creation), not read from it, so the second column is the real starting context; the first column is what the task asked for and reflects only the part that was already cached by the parent or a sibling.

### Main (orchestrator) sessions

Sessions launching >= 1 Agent: 6; other main sessions with assistant turns: 19

| session | title | launches | tool calls | Bash | Read/Edit/Write | turns | dur | out chars | in+cache_read | cache_create | tool calls between launches (median / max) | before first | after last |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 33619b00 | orchestrator-A204 | 3 | 77 | 71 | 0 | 64 | 9h30m | 70.3k | 8730.5k | 319.2k | 19.5 / 29 | 21 | 14 |
| 451b3889 | orchestrator-A204 | 7 | 128 | 118 | 0 | 109 | 20h39m | 136.4k | 18179.2k | 687.9k | 8.5 / 48 | 21 | 13 |
| 4aad2802 | orchestrator-A204 | 15 | 128 | 85 | 25 | 161 | 17h18m | 262.3k | 36260.9k | 863.8k | 5.0 / 30 | 9 | 10 |
| 632d6ed4 | orchestrator-A204 | 3 | 83 | 70 | 8 | 105 | 19h04m | 130.6k | 15249.1k | 618.8k | 20.5 / 41 | 23 | 16 |
| 70d394c4 | - | 1 | 114 | 83 | 4 | 104 | 1h22m | 118.1k | 15733.0k | 226.4k | - / - | 107 | 6 |
| e58ef4d7 | orchestrator-A204 | 3 | 143 | 120 | 9 | 177 | 8h22m | 187.5k | 39266.6k | 562.5k | 2.5 / 5 | 95 | 40 |

Across orchestrator sessions: Agent launches total 32; tool calls between consecutive launches: median 6.0, p90 29, launches with 0 tool calls before the next: 6/26
Launch subagent_type: {'ticket-implementer': 26, 'Explore': 2, 'general-purpose': 4}

Session totals from the harness `cost-state` record (API-reported usage for the whole session, sub-agents included):

| session | cost USD | API time | tool time | wall (harness) | output tok | cache_read | cache_create | input | models | transcript cache_read main+subs / cost-state cache_read | recorded output tok main+subs / cost-state output |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 33619b00 | 18.02 | 26m58s | 32m16s | 26h22m | 120.7k | 26009.8k | 680.9k | 50.9k | fable-5-1 out 45.3k, opus-5-5 out 75.4k | 0.77 | 0.40 |
| 451b3889 | 48.40 | 1h13m | 1h31m | 25h20m | 274.7k | 43111.8k | 2389.0k | 521.8k | fable-5-1 out 173.7k, opus-5-5[1m] out 79.7k, sonnet-5 out 12.5k, haiku-4-5-20251001 out 8.8k | 0.81 | 0.36 |
| 4aad2802 | 147.22 | 3h28m | 2h02m | 21h50m | 988.8k | 207096.1k | 5424.6k | 833.8k | fable-5-1 out 611.3k, opus-5-5[1m] out 377.5k | 0.71 | 0.17 |
| 632d6ed4 | 28.85 | 1h01m | 45m21s | 35h36m | 279.5k | 60871.0k | 1689.5k | 319.3k | opus-5-5 out 274.6k, haiku-4-5-20251001 out 4.9k | 0.73 | 0.31 |
| 70d394c4 | 8.60 | 18m57s | 5m06s | 1h30m | 104.7k | 19506.3k | 378.3k | 9.1k | opus-5-5 out 104.7k, haiku-4-5-20251001 out 15 | 0.93 | 0.69 |
| e58ef4d7 | 38.53 | 57m07s | 44m01s | 8h44m | 248.3k | 61771.6k | 1294.4k | 113.5k | haiku-4-5-20251001 out 33, fable-5-1 out 128.8k, opus-5-5[1m] out 119.5k | 0.91 | 0.54 |

The last two columns check the transcript against the harness totals: a cache_read ratio near 1.0 confirms that the transcript's input-side usage is complete and that cost-state covers the sub-agents; the output ratio shows how badly the per-record `output_tokens` undercounts.

Orchestrator tool calls by tool:

| tool | calls | share |
|---|---|---|
| Bash | 547 | 81% |
| Agent | 32 | 5% |
| Write | 30 | 4% |
| Edit | 16 | 2% |
| AskUserQuestion | 8 | 1% |
| ToolSearch | 7 | 1% |
| ListAgents | 5 | 1% |
| SendMessage | 4 | 1% |
| mcp__chrome-devtools__evaluate_script | 4 | 1% |
| TaskStop | 3 | 0% |
| mcp__chrome-devtools__new_page | 3 | 0% |
| mcp__chrome-devtools__click | 3 | 0% |
| Artifact | 2 | 0% |
| mcp__chrome-devtools__take_snapshot | 2 | 0% |
| mcp__chrome-devtools__take_screenshot | 2 | 0% |
| mcp__chrome-devtools__list_console_messages | 1 | 0% |
| mcp__chrome-devtools__list_network_requests | 1 | 0% |
| mcp__chrome-devtools__close_page | 1 | 0% |
| Monitor | 1 | 0% |
| PushNotification | 1 | 0% |

Orchestrator Bash buckets:

| bucket | calls (primary) | share | segments | share |
|---|---|---|---|---|
| read:shell | 196 | 36% | 1538 | 46% |
| other | 31 | 6% | 466 | 14% |
| shell-control | 0 | 0% | 205 | 6% |
| git:inspect | 42 | 8% | 204 | 6% |
| script:process | 43 | 8% | 155 | 5% |
| gh:project/api | 21 | 4% | 125 | 4% |
| gh:pr | 43 | 8% | 108 | 3% |
| git:other | 20 | 4% | 93 | 3% |
| edit:shell | 37 | 7% | 89 | 3% |
| gh:other | 35 | 6% | 69 | 2% |
| gh:issue | 25 | 5% | 59 | 2% |
| git:worktree | 5 | 1% | 55 | 2% |
| git:push | 6 | 1% | 46 | 1% |
| git:commit | 10 | 2% | 41 | 1% |
| poll/wait | 8 | 1% | 29 | 1% |
| python-inline:edit | 14 | 3% | 16 | 0% |
| node-inline | 2 | 0% | 8 | 0% |
| verify:test | 1 | 0% | 7 | 0% |
| npm-other | 1 | 0% | 7 | 0% |
| verify:verify | 2 | 0% | 7 | 0% |
| verify:lint/typecheck | 1 | 0% | 6 | 0% |
| verify:build | 0 | 0% | 5 | 0% |
| node-other | 2 | 0% | 4 | 0% |
| web:shell | 1 | 0% | 4 | 0% |
| verify:format | 1 | 0% | 1 | 0% |
| script:build | 0 | 0% | 1 | 0% |

Orchestrator repo scripts: board.sh 123, agent-phases.mjs 23, codex-pass.sh 6, ticket-start.sh 1, log.sh 1, build-worklets.mjs 1, ticket-finish.sh 1

Orchestrator process share: process 263 (39%), work 303 (45%), inspect/other 107 (16%)

Orchestrator wall time inside tool calls (matched 673/673): 2h11m total. Agent calls run in the background, so their tool time is the launch, not the sub-agent's run.

| bucket | calls | time | share | mean s/call |
|---|---|---|---|---|
| AskUserQuestion | 8 | 24m21s | 19% | 183 |
| Bash/read:shell | 196 | 20m27s | 16% | 6 |
| Bash/script:process | 43 | 17m50s | 14% | 25 |
| Bash/git:inspect | 42 | 13m36s | 10% | 19 |
| Bash/gh:pr | 43 | 10m18s | 8% | 14 |
| Bash/edit:shell | 37 | 7m47s | 6% | 13 |
| Bash/other | 31 | 5m48s | 4% | 11 |
| Agent | 32 | 4m40s | 4% | 9 |
| Bash/git:other | 20 | 4m00s | 3% | 12 |
| Bash/gh:issue | 25 | 4m00s | 3% | 10 |
| Bash/gh:other | 35 | 3m46s | 3% | 6 |
| Bash/gh:project/api | 21 | 2m58s | 2% | 8 |

Non-orchestrator main sessions (no Agent launches), for contrast:

- 19 sessions, 2320 tool calls, median tool calls/session 110, median duration 2h27m, assistant output chars total 3385.0k
- cost-state totals for these sessions: output tokens 2325.9k, cost USD 443.21
- process share: process 316 (14%), work 1553 (67%), inspect/other 451 (19%)
- top Bash buckets: read:shell 760, python-inline:edit 272, edit:shell 220, other 96, script:process 67, git:inspect 60, poll/wait 55, gh:pr 38

### Caveats for this project

- Records that failed JSON parsing: 0
- Bash calls whose primary segment could not be classified (bucket `other`): 23 in sub-agents, 127 in main sessions
- Unclassified command heads (top 12): `.` 22, `uptime` 14, `pr` 8, `until` 7, `api` 6, `Support/Blender/5.2/extensions/lab_blender_org/mcp` 5, `uv` 5, ``needs-human`` 5, `timeout` 4, `'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'` 4, `rev-parse` 4, `break` 4
- Records/commands with secret-like strings (redacted, never printed): 0; Bash commands mentioning `.env`: 13 (contents never read by this script)
- `output_tokens` on assistant records is the count at the moment the record was persisted (mid-stream), e.g. 7 tokens on a record whose tool_use input is 9 kB; only end-of-turn records carry the final count. Per-transcript output tokens are therefore NOT measurable from these files; the report gives measured output characters instead, and the harness `cost-state` totals per main session (which include sub-agents) for real output-token counts.
- Input-side usage (input_tokens, cache_read, cache_creation) is known at request start and is consistent across the blocks of a message; those sums are reliable.
- Wall-clock durations include waiting: on permission prompts, on background tasks (Monitor/TaskStop), on the human. They are elapsed time, not model time.
- Role tags come from `.meta.json` agentType plus keywords in the description/prompt; `general-purpose` is left as-is when no keyword matched.
- Sub-agent transcripts in this project's sessions launched Agents themselves: 3 nested launches (spawnDepth 2 transcripts are included in the sub-agent set).

## HOOP

- Main session files: 3 (with any assistant turn: 0); assistant API turns in main sessions: 0
- Sub-agent transcripts: 0; date range: 2026-09-21 .. 2026-09-21
- Claude Code versions seen: 2.1.278
- Tool calls: main sessions 0, sub-agents 0
- Tokens, main sessions: input+cache_read 0, cache_create 0, assistant output chars 0 (recorded output_tokens 0, undercounts; see caveats)

### Main (orchestrator) sessions

Sessions launching >= 1 Agent: 0; other main sessions with assistant turns: 0


### Caveats for this project

- Records that failed JSON parsing: 0
- Bash calls whose primary segment could not be classified (bucket `other`): 0 in sub-agents, 0 in main sessions
- Records/commands with secret-like strings (redacted, never printed): 0; Bash commands mentioning `.env`: 0 (contents never read by this script)
- `output_tokens` on assistant records is the count at the moment the record was persisted (mid-stream), e.g. 7 tokens on a record whose tool_use input is 9 kB; only end-of-turn records carry the final count. Per-transcript output tokens are therefore NOT measurable from these files; the report gives measured output characters instead, and the harness `cost-state` totals per main session (which include sub-agents) for real output-token counts.
- Input-side usage (input_tokens, cache_read, cache_creation) is known at request start and is consistent across the blocks of a message; those sums are reliable.
- Wall-clock durations include waiting: on permission prompts, on background tasks (Monitor/TaskStop), on the human. They are elapsed time, not model time.
- Role tags come from `.meta.json` agentType plus keywords in the description/prompt; `general-purpose` is left as-is when no keyword matched.
- Sub-agent transcripts in this project's sessions launched Agents themselves: 0 nested launches (spawnDepth 2 transcripts are included in the sub-agent set).

## windsor (baseline)

- Main session files: 3 (with any assistant turn: 3); assistant API turns in main sessions: 237
- Sub-agent transcripts: 5; date range: 2026-09-27 .. 2026-09-28
- Claude Code versions seen: 2.1.283
- Sub-agent types (from .meta.json): {'Explore': 2, 'general-purpose': 2, 'fork': 1}
- spawnDepth: {1: 5}
- Tool calls: main sessions 258, sub-agents 222
- Tokens, main sessions: input+cache_read 41441.6k, cache_create 1448.9k, assistant output chars 277.0k (recorded output_tokens 173.2k, undercounts; see caveats)
- Tokens, sub-agents: input+cache_read 18160.0k, cache_create 781.6k, assistant output chars 262.9k (recorded output_tokens 7.7k, undercounts)
- Harness cost-state totals over all main sessions (sub-agents included): cost USD 18.98, output tokens 127.2k

### Per sub-agent transcript

| # | parent | type | role | tools | Bash | Read | Edit | Write | Grep/Glob | other | turns | dur | out chars | out tok (recorded, undercounts) | in+cache_read | cache_create | first-turn ctx (in+read / +create) | prompt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | f241d70a | fork | fork | 44 | 43 | 0 | 0 | 0 | 0 | 1 | 44 | 6m02s | 47.3k | 3.5k | 6762.9k | 66.9k | 110.6k / 111.2k | You've inherited the conversation context above from a parent agent working in /Users/arrakis/code/windsor. You are oper |
| 2 | 35dbdc79 | Explore | explore | 37 | 34 | 2 | 0 | 0 | 0 | 1 | 26 | 5m00s | 45.0k | 1.8k | 2985.2k | 190.8k | 2 / 12.1k | Map the agent-orchestration process in /Users/arrakis/code/Aotearoa204 (a separate repo, read-only). Thoroughness: very  |
| 3 | 35dbdc79 | Explore | explore | 27 | 20 | 6 | 0 | 0 | 0 | 1 | 19 | 3m29s | 32.7k | 1.6k | 1646.9k | 151.4k | 2 / 12.1k | Map the agent-orchestration process in /Users/arrakis/code/HOOP (a separate repo, read-only). Thoroughness: very thoroug |
| 4 | 35dbdc79 | general-purpose | measure | 53 | 20 | 0 | 32 | 1 | 0 | 0 | 53 | 14m26s | 97.6k | 578 | 5848.7k | 159.1k | 2 / 28.2k | Measure, from real Claude Code session transcripts, where the tool-call and token overhead sits in sub-agent tasks for t |
| 5 | 35dbdc79 | general-purpose | research | 61 | 2 | 0 | 0 | 0 | 0 | 59 | 8 | 5m05s | 40.3k | 277 | 916.3k | 213.4k | 2 / 28.0k | Research, using WebSearch and WebFetch, what the software community is doing as of September 2026 for parallel multi-age |

### Sub-agent aggregates

| metric | median | p90 | max |
|---|---|---|---|
| tool calls per sub-agent | 44 | 61 | 61 |
| Bash calls per sub-agent | 20 | 43 | 43 |
| assistant turns per sub-agent | 26 | 53 | 53 |
| duration | 5m05s | 14m26s | 14m26s |
| total input incl. cache_read | 2985.2k | 6762.9k | 6762.9k |
| total cache_create | 159.1k | 213.4k | 213.4k |
| assistant output chars (text+thinking+tool_use JSON; measured) | 45.0k | 97.6k | 97.6k |
| output tokens as recorded (UNRELIABLE, see caveats) | 1.6k | 3.5k | 3.5k |
| first-turn context (input+cache_read) | 2 | 110.6k | 110.6k |
| first-turn context incl. cache_create | 28.0k | 111.2k | 111.2k |
| context per turn (input+cache_read+create)/turns | 122.2k | 155.2k | - |

#### By role

| role | n | median tools | median dur | median out chars | median in+cache_read | median first ctx |
|---|---|---|---|---|---|---|
| explore | 2 | 32 | 4m14s | 38.8k | 2316.0k | 2 |
| fork | 1 | 44 | 6m02s | 47.3k | 6762.9k | 110.6k |
| measure | 1 | 53 | 14m26s | 97.6k | 5848.7k | 2 |
| research | 1 | 61 | 5m05s | 40.3k | 916.3k | 2 |

#### Tool-call share across all sub-agents

| tool | calls | share |
|---|---|---|
| Bash | 119 | 54% |
| WebFetch | 42 | 19% |
| Edit | 32 | 14% |
| WebSearch | 15 | 7% |
| Read | 8 | 4% |
| SubagentHandback | 3 | 1% |
| ToolSearch | 1 | 0% |
| Write | 1 | 0% |
| Agent | 1 | 0% |

#### Bash buckets (sub-agents): primary bucket per call, and per shell segment

Bash calls: 119; shell segments after splitting on `&&`, `;`, `|`, newlines and dropping `cd`/`export`/`echo` preambles: 524 (4.4 per call)

| bucket | calls (primary) | share | segments | share |
|---|---|---|---|---|
| read:shell | 75 | 63% | 421 | 80% |
| shell-control | 0 | 0% | 33 | 6% |
| git:inspect | 6 | 5% | 20 | 4% |
| python-inline:edit | 18 | 15% | 18 | 3% |
| python-inline:other | 8 | 7% | 11 | 2% |
| other | 1 | 1% | 7 | 1% |
| python-script | 5 | 4% | 5 | 1% |
| script:build | 2 | 2% | 3 | 1% |
| git:commit | 1 | 1% | 2 | 0% |
| git:other | 1 | 1% | 2 | 0% |
| edit:shell | 1 | 1% | 1 | 0% |
| verify:verify | 1 | 1% | 1 | 0% |

Repo scripts called (segments, by basename):

| script | segments |
|---|---|
| build-worklets.mjs | 2 |
| evidence-host.sh | 1 |

#### Process share (all tool calls, primary bucket)

| group | calls | share |
|---|---|---|
| process | 7 | 3% |
| work | 151 | 68% |
| inspect/other | 64 | 29% |

process = gh:*, git worktree/commit/push/other, repo scripts (board/ticket/handoff), poll/wait, codex/claude CLI, SubagentHandback, Skill, ToolSearch, Agent, Monitor, TaskStop. work = shell reads/edits, python/node inline, npm/npx verify/test/lint/build, Read/Edit/Write/Grep/Glob. inspect/other = git status/log/diff, web, MCP, unclassified.

| role | process | work | inspect/other |
|---|---|---|---|
| explore (n=2) | 2 (3%) | 58 (91%) | 4 (6%) |
| fork (n=1) | 3 (7%) | 38 (86%) | 3 (7%) |
| measure (n=1) | 0 (0%) | 53 (100%) | 0 (0%) |
| research (n=1) | 2 (3%) | 2 (3%) | 57 (93%) |

Per-sub-agent process share: median 3%, p90 7%

#### Wall time inside tool calls (tool_use record to tool_result record), sub-agents, by bucket

Matched 221/222 tool calls to a result record. Total time inside tools 20m22s of 34m03s elapsed across all sub-agents; per sub-agent share of elapsed time inside tools: median 42%, p90 100%. The rest is model time (thinking, generation) plus harness/permission waits.

| bucket | calls | time | share of tool time | mean s/call |
|---|---|---|---|---|
| WebFetch | 42 | 9m58s | 49% | 14 |
| Bash/read:shell | 75 | 5m20s | 26% | 4 |
| WebSearch | 15 | 3m12s | 16% | 13 |
| Bash/python-inline:edit | 18 | 0m29s | 2% | 2 |
| Bash/python-inline:other | 8 | 0m20s | 2% | 3 |
| Bash/python-script | 5 | 0m15s | 1% | 3 |
| Bash/git:inspect | 6 | 0m11s | 1% | 2 |
| Read | 8 | 0m08s | 1% | 1 |
| SubagentHandback | 3 | 0m07s | 1% | 3 |
| Bash/script:build | 2 | 0m05s | 0% | 3 |
| Bash/other | 1 | 0m03s | 0% | 3 |
| Bash/verify:verify | 1 | 0m02s | 0% | 2 |
| Bash/git:other | 1 | 0m01s | 0% | 2 |
| Bash/edit:shell | 1 | 0m01s | 0% | 2 |
| Bash/git:commit | 1 | 0m01s | 0% | 2 |
| Agent | 1 | 0m01s | 0% | 1 |

Tool time by group: process 0m12s (1%), work 6m43s (33%), inspect/other 13m25s (66%)

Tool time includes any permission-prompt wait before the command ran; parallel tool calls in one turn overlap, so per-transcript shares can exceed 100%.

Duration of Bash calls that invoke a repo script (whole call, which may include other segments):

| script | calls | median s | p90 s | max s | total |
|---|---|---|---|---|---|
| build-worklets.mjs | 2 | 2 | 2 | 2 | 0m03s |
| evidence-host.sh | 1 | 3 | 3 | 3 | 0m03s |

#### Top 10 longest sub-agent runs (by wall clock)

| dur | type | role | tools | tool breakdown (top 6) | top Bash buckets | process/work/other | turns | out chars | in+cache_read | cache_create | first ctx (+create) | prompt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 14m26s | general-purpose | measure | 53 | Edit 32, Bash 20, Write 1 | read:shell 8, python-inline:other 7, python-script 5 | 0/53/0 | 53 | 97.6k | 5848.7k | 159.1k | 28.2k | Measure, from real Claude Code session transcripts, where the tool-call and token overhead sits in s |
| 6m02s | fork | fork | 44 | Bash 43, Agent 1 | python-inline:edit 18, read:shell 17, git:inspect 2, git:other 1, edit:shell 1, script:build 1 | 3/38/3 | 44 | 47.3k | 6762.9k | 66.9k | 111.2k | You've inherited the conversation context above from a parent agent working in /Users/arrakis/code/w |
| 5m05s | general-purpose | research | 61 | WebFetch 42, WebSearch 15, Bash 2, ToolSearch 1, SubagentHandback 1 | read:shell 2 | 2/2/57 | 8 | 40.3k | 916.3k | 213.4k | 28.0k | Research, using WebSearch and WebFetch, what the software community is doing as of September 2026 fo |
| 5m00s | Explore | explore | 37 | Bash 34, Read 2, SubagentHandback 1 | read:shell 31, python-inline:other 1, git:inspect 1, script:build 1 | 1/35/1 | 26 | 45.0k | 2985.2k | 190.8k | 12.1k | Map the agent-orchestration process in /Users/arrakis/code/Aotearoa204 (a separate repo, read-only). |
| 3m29s | Explore | explore | 27 | Bash 20, Read 6, SubagentHandback 1 | read:shell 17, git:inspect 3 | 1/23/3 | 19 | 32.7k | 1646.9k | 151.4k | 12.1k | Map the agent-orchestration process in /Users/arrakis/code/HOOP (a separate repo, read-only). Thorou |

#### First-turn context distribution (input_tokens + cache_read_input_tokens on the first assistant turn)

| stat | in+cache_read | in+cache_read+cache_create |
|---|---|---|
| min | 2 | 12.1k |
| p10 | 2 | 12.1k |
| median | 2 | 28.0k |
| p90 | 110.6k | 111.2k |
| max | 110.6k | 111.2k |

Note: on a sub-agent's first turn the freshly assembled context (system prompt + CLAUDE.md + skills + prompt) is mostly written to cache (cache_creation), not read from it, so the second column is the real starting context; the first column is what the task asked for and reflects only the part that was already cached by the parent or a sibling.

### Main (orchestrator) sessions

Sessions launching >= 1 Agent: 2; other main sessions with assistant turns: 1

| session | title | launches | tool calls | Bash | Read/Edit/Write | turns | dur | out chars | in+cache_read | cache_create | tool calls between launches (median / max) | before first | after last |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 35dbdc79 | - | 4 | 13 | 6 | 0 | 11 | 6m56s | 15.8k | 1203.8k | 130.6k | 0 / 0 | 2 | 7 |
| f241d70a | windsor | 1 | 168 | 134 | 7 | 159 | 15h26m | 164.5k | 30022.5k | 991.3k | - / - | 26 | 141 |

Across orchestrator sessions: Agent launches total 5; tool calls between consecutive launches: median 0, p90 0, launches with 0 tool calls before the next: 3/3
Launch subagent_type: {'Explore': 2, 'general-purpose': 2, 'fork': 1}

Session totals from the harness `cost-state` record (API-reported usage for the whole session, sub-agents included):

| session | cost USD | API time | tool time | wall (harness) | output tok | cache_read | cache_create | input | models | transcript cache_read main+subs / cost-state cache_read | recorded output tok main+subs / cost-state output |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 35dbdc79 | - | - | - | - | - | - | - | - | none | - | - |
| f241d70a | 18.98 | 25m29s | 18m53s | 15h27m | 127.2k | 40205.8k | 1064.9k | 22.2k | haiku-4-5-20251001 out 14, opus-5-5 out 127.2k | 0.91 | 0.85 |

The last two columns check the transcript against the harness totals: a cache_read ratio near 1.0 confirms that the transcript's input-side usage is complete and that cost-state covers the sub-agents; the output ratio shows how badly the per-record `output_tokens` undercounts.

Orchestrator tool calls by tool:

| tool | calls | share |
|---|---|---|
| Bash | 140 | 77% |
| mcp__claude-in-chrome__javascript_tool | 7 | 4% |
| mcp__claude-in-chrome__navigate | 6 | 3% |
| Agent | 5 | 3% |
| Read | 4 | 2% |
| mcp__claude-in-chrome__computer | 3 | 2% |
| Write | 3 | 2% |
| ToolSearch | 2 | 1% |
| AskUserQuestion | 2 | 1% |
| mcp__claude-in-chrome__read_console_messages | 2 | 1% |
| mcp__claude-in-chrome__tabs_close_mcp | 2 | 1% |
| Skill | 1 | 1% |
| WebFetch | 1 | 1% |
| mcp__claude-in-chrome__tabs_context_mcp | 1 | 1% |
| mcp__claude-in-chrome__read_network_requests | 1 | 1% |
| mcp__claude-in-chrome__list_connected_browsers | 1 | 1% |

Orchestrator Bash buckets:

| bucket | calls (primary) | share | segments | share |
|---|---|---|---|---|
| read:shell | 68 | 49% | 418 | 63% |
| git:inspect | 9 | 6% | 43 | 6% |
| shell-control | 0 | 0% | 38 | 6% |
| python-inline:edit | 28 | 20% | 34 | 5% |
| git:commit | 2 | 1% | 22 | 3% |
| verify:test | 7 | 5% | 16 | 2% |
| verify:lint/typecheck | 2 | 1% | 15 | 2% |
| edit:shell | 3 | 2% | 15 | 2% |
| git:other | 4 | 3% | 11 | 2% |
| other | 2 | 1% | 11 | 2% |
| verify:verify | 5 | 4% | 9 | 1% |
| verify:format | 0 | 0% | 5 | 1% |
| gh:other | 1 | 1% | 5 | 1% |
| poll/wait | 4 | 3% | 5 | 1% |
| web:shell | 0 | 0% | 4 | 1% |
| script:build | 0 | 0% | 3 | 0% |
| verify:build | 1 | 1% | 2 | 0% |
| npm-other | 1 | 1% | 2 | 0% |
| gh:project/api | 1 | 1% | 2 | 0% |
| node-inline | 1 | 1% | 2 | 0% |
| node-other | 0 | 0% | 1 | 0% |
| git:push | 0 | 0% | 1 | 0% |
| git:worktree | 1 | 1% | 1 | 0% |

Orchestrator repo scripts: build-worklets.mjs 2, patch-library-index.mjs 1

Orchestrator process share: process 21 (12%), work 123 (68%), inspect/other 37 (20%)

Orchestrator wall time inside tool calls (matched 181/181): 1h47m total. Agent calls run in the background, so their tool time is the launch, not the sub-agent's run.

| bucket | calls | time | share | mean s/call |
|---|---|---|---|---|
| AskUserQuestion | 2 | 1h22m | 77% | 2469 |
| Bash/python-inline:edit | 28 | 9m08s | 9% | 20 |
| Bash/verify:verify | 5 | 4m21s | 4% | 52 |
| Agent | 5 | 2m27s | 2% | 29 |
| Bash/read:shell | 68 | 2m14s | 2% | 2 |
| Bash/verify:test | 7 | 1m55s | 2% | 17 |
| Bash/git:worktree | 1 | 1m01s | 1% | 62 |
| Bash/verify:lint/typecheck | 2 | 0m33s | 1% | 17 |
| mcp__claude-in-chrome__javascript_tool | 7 | 0m26s | 0% | 4 |
| mcp__claude-in-chrome__navigate | 6 | 0m21s | 0% | 4 |
| Bash/git:other | 4 | 0m18s | 0% | 5 |
| Bash/poll/wait | 4 | 0m18s | 0% | 5 |

Non-orchestrator main sessions (no Agent launches), for contrast:

- 1 sessions, 77 tool calls, median tool calls/session 77, median duration 30m10s, assistant output chars total 96.7k
- cost-state totals for these sessions: output tokens 0, cost USD 0.00
- process share: process 8 (10%), work 36 (47%), inspect/other 33 (43%)
- top Bash buckets: read:shell 13, python-inline:edit 12, edit:shell 7, git:other 2, git:inspect 1, verify:test 1, verify:verify 1, git:commit 1

### Caveats for this project

- Records that failed JSON parsing: 0
- Bash calls whose primary segment could not be classified (bucket `other`): 1 in sub-agents, 2 in main sessions
- Unclassified command heads (top 12): `-s` 2, `npm` 1
- Records/commands with secret-like strings (redacted, never printed): 0; Bash commands mentioning `.env`: 0 (contents never read by this script)
- `output_tokens` on assistant records is the count at the moment the record was persisted (mid-stream), e.g. 7 tokens on a record whose tool_use input is 9 kB; only end-of-turn records carry the final count. Per-transcript output tokens are therefore NOT measurable from these files; the report gives measured output characters instead, and the harness `cost-state` totals per main session (which include sub-agents) for real output-token counts.
- Input-side usage (input_tokens, cache_read, cache_creation) is known at request start and is consistent across the blocks of a message; those sums are reliable.
- Wall-clock durations include waiting: on permission prompts, on background tasks (Monitor/TaskStop), on the human. They are elapsed time, not model time.
- Role tags come from `.meta.json` agentType plus keywords in the description/prompt; `general-purpose` is left as-is when no keyword matched.
- Sub-agent transcripts in this project's sessions launched Agents themselves: 1 nested launches (spawnDepth 2 transcripts are included in the sub-agent set).

## Note: Aotearoa204 (iCloud checkout, pre-fork)

- 1 session(s), 0 sub-agent transcripts, 284 tool calls, date range 2026-08-30; output tokens 338.4k. Not included in the Aotearoa204 totals above.
