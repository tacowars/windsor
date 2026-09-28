# A smaller software factory for Windsor

2026-09-28. A refined answer to tacowars's question about GitHub Projects,
tickets, worktrees and Claude Code orchestration, incorporating Aotearoa204
and HOOP rather than treating the pattern as a new proposal.

**Your software factory is a recognisable, well-supported pattern. Its
expensive parts are implementation choices you can change while keeping
durable state and parallel work. For Windsor, the next improvement is a
smaller execution process with explicit capacity limits.** The GPT answer
adds useful scheduling ideas, but does not establish that a larger
orchestration system would outperform what you have already built.

Claude Code documents native worktree sessions, and HN contains direct
accounts of issue → worktree → agent → PR workflows. That supports saying
the pattern is established among some active agent users. It does not
support GPT's stronger claim that it is a dominant industry pattern:
product launches and self-selected comments are not adoption measurements.
Sources: [Claude worktrees](https://code.claude.com/docs/en/worktrees),
[HN's issue-to-worktree example](https://news.ycombinator.com/item?id=46190907),
[HN's branch/worktree/PR discussion](https://news.ycombinator.com/item?id=48516623).

**Your previous projects already answer much of the efficiency question.**
The [Claude report](../2026-09-28-agent-orchestration-overhead/README.md)
and its [transcript tables](../2026-09-28-agent-orchestration-overhead/transcript-overhead-report.md)
show three distinct costs: carrying large contexts, waiting through the
finish process, and having the hub repeatedly inspect execution state.
The report measures 43–45k starting contexts for ticket implementers,
60 calls containing `ticket-finish.sh` at a median 214 seconds, and a 39%
process share of orchestrator tool calls. These are useful observations,
although elapsed finish time also includes fixes, review and waiting; it
is not all removable verification overhead.

Aotearoa204's September 27 harmony wave makes the tradeoffs concrete. Six
of thirteen local verify runs failed only on load timeouts. Shared registry
and export edits caused two rebase rounds. Yet independent review also
found real arpeggiator boundary defects that the implementation tests
missed. The right response is to eliminate contention and repetitive
mechanics while improving the initial fixtures and retaining valuable
review. Merely removing every expensive step would discard work that
caught bugs. The original handoff and corrected post-mortem are linked in
the [evidence audit](source-audit.md).

HOOP had already shortened reports, made board queries dramatically
cheaper, and delegated browser checks. Its shared Supabase stack and
browser lock then became constraints. That is evidence for scheduling
resources separately from agents. Windsor has inherited the audio engine,
but deliberately left Aotearoa204's board and orchestration machinery
behind. Its [fork decision](../../log/2026-09-27-windsor-forked-from-aotearoa204.md)
is a good starting point: add machinery when a demonstrated need earns it.

**What the GPT answer contributes to this conversation** is a sharper
vocabulary and a few operational extensions, rather than a replacement
architecture:

| Idea in GPT's answer | What was already known here | Useful addition for Windsor |
| --- | --- | --- |
| Limit work in progress to verification and review capacity | Claude recommended a local agent cap; HOOP serialised browser checks | Count unfinished PRs and scarce resources, not just running agents. Stop dispatch when review accumulates. |
| Separate Kanban state from scheduling | Aotearoa204 already used dependencies, owned files and seam tickets | Distinguish dependency readiness, edit conflicts and runtime capacity. A ready card alone does not mean safe to start. |
| Choose subagent, worktree, batch or team by task | Claude already recommended research agents, background sessions and batch/workflows | Make the independently reviewable change the unit of coding work; do not turn every investigation into a ticket and PR. |
| Feed CI and review results back automatically | Aotearoa204 already had CI handback; Claude proposed bounded retries | `/autofix-pr` is a concrete native option to investigate, with a narrow repair scope and no competing branch writer. |
| Isolate runtimes as well as files | HOOP had already suffered shared-service collisions | Apply isolation to Windsor's browser state, ports, scratch files and audio/test resources. A database/container fleet is unnecessary for the current app. |
| Use hooks for state changes; keep context small | Both repos had already reduced bookkeeping and reading | Preserve those gains in a small, enforced process; this is reinforcement, not a newly discovered principle. |

The strongest addition is **backpressure across the whole delivery
process**: a worker finishing a PR does not mean the factory has capacity
for another one. That PR still consumes testing, review and integration
attention. GPT's illustrative WIP numbers are not measurements for your
machine, but the principle is worth adopting.

**HN users are pursuing several approaches, with no demonstrated winner.**
The [wt author](https://news.ycombinator.com/item?id=46765489) describes a
small wrapper around worktrees and issue-driven sessions.
[KanVibe](https://news.ycombinator.com/item?id=47034185) adds hooks and a
board for visibility. [Stoneforge](https://news.ycombinator.com/item?id=47267105),
[TTal](https://news.ycombinator.com/item?id=47435275) and
[Agent Orchestrator](https://news.ycombinator.com/item?id=47219229) describe
more elaborate planners, dispatchers, review and repair loops. Those posts
establish that people are building factories like yours; they provide no
controlled evidence that their extra machinery saves time.

The comments are more useful than the tool count. In the
[Superset discussion](https://news.ycombinator.com/item?id=46368739), a
team member reports managing two or three agents for substantial work,
with more possible for small fixes. Others question review capacity; one
describes using a shared checkout with file reservations instead of
worktrees. Another [HN thread](https://news.ycombinator.com/item?id=46682551)
contains both a deliberately serial workflow and a developer whose
attention limits them to about three sessions. For you, these are reasons
to test a small concurrency level against real delivery outcomes, not
reasons to copy an advertised agent count or abandon worktrees.

**Keep a planning conversation, and give routine execution a smaller
owner.** A long-lived session can be valuable for deciding what Windsor
should become, comparing designs and resolving surprises. It need not
poll CI, reread the board or relay every worker's report. Preserve the
planning context you find useful, and record durable decisions in issues
and decision records so execution can recover independently.

For two independent changes, two ordinary Claude sessions in worktrees
are sufficient. If repeated dispatch becomes a burden, add a small script
or saved workflow that starts eligible work and records its identity.
Claude's [dynamic workflows](https://code.claude.com/docs/en/workflows)
explicitly put control flow and intermediate results in a script rather
than the coordinating conversation. That is a relevant native option;
there is no evidence here that Windsor currently needs a general scheduler.

Give each coding task a concise brief: desired behaviour, acceptance
criteria, boundary fixtures, dependencies, owned files and relevant
invariants. Keep the PR as the implementation report. Preserve a short
recovery note when unfinished work cannot be reconstructed from the diff
and issue; the useful rule is to avoid duplicated reports, not to lose
uncommitted reasoning on an interrupted task.

**Schedule dependencies, shared edits and runtime resources separately.**
My proposed starting policy is two implementation workers, at most one
heavy local test or audio benchmark at a time, and one shared browser
automation user. Pause new implementation when two PRs are waiting for
your review. These are trial limits, not measured optima. Local test limits
do not imply serialising independent hosted CI runners.

A task is eligible when its prerequisites have landed, its likely shared
edits do not collide with active work, and its needed resources are
available. Initially this can be a human-selected wave and a few explicit
ownership notes. If dispatch is automated, use one dispatcher or an atomic
claim with an owner and recovery mechanism. Reading a `ready` label and
then assigning yourself is not, by itself, protection against two workers
starting the same issue.

For example, land a song-schema or engine-interface seam first. Then an
engine implementation and a UI consumer may run in parallel against that
contract. Identify shared append sites in advance: engine exports,
`partGenerators.ts`, insert registries, the generated patch index and any
common UI composition file. Reserve those edits, prepare their entries in
the seam, or combine the work into one change. A dependency DAG alone
does not capture two otherwise independent tickets editing the same
registry. Different files can also conflict semantically through a shared
contract.

**Choose concurrency for the work, including the option of staying in the
current session.**

| Work | Starting choice |
| --- | --- |
| Small fix whose context is already loaded | Finish it in the current session. |
| Broad investigation or independent review | A focused subagent with a compact brief, when the separate context earns its cost. |
| Independently reviewable implementation | A worktree worker, with its own branch and PR. |
| Many repetitive, independent transformations | A deterministic codemod where possible; otherwise evaluate `/batch` or a bounded dynamic workflow. |
| Design uncertainty spanning schema, engine and UI | Resolve the contract first; use one owner for tightly coupled implementation. |
| Investigation that benefits from agents challenging hypotheses | Consider a small agent team as an experiment. |

The [commands reference](https://code.claude.com/docs/en/commands) describes
`/batch` as a bundled **skill** that plans 5–30 units and launches worktree
subagents after approval. It is not automatically the scripted execution
model described in the workflow docs, nor a natural default for two tickets
on this Mac. [Agent teams](https://code.claude.com/docs/en/agent-teams) remain
experimental, disabled by default, and add context and coordination cost.
Neither feature makes tightly coupled work independent.

**Make verification authoritative without making it ritualistic.**
The useful change to Claude's “verify once, in CI” advice is: run fast,
relevant checks while implementing, and let CI own the comprehensive
integration gate. New fixes and changed integration states can legitimately
require new checks. Do not make “once” a numerical rule that suppresses
necessary feedback.

Windsor's [current CI](../../../.github/workflows/ci.yml) already runs
`npm run verify` on applicable PRs and pushes to `main`, using hosted
Ubuntu runners. It skips docs-only changes. The gate checks types, lint,
format, tests, generated worklets, the patch index and the build. Local
work still needs the checks relevant to its risk: DSP goldens for DSP,
round trips for document changes, headroom and index regeneration for
patches, and browser checks for browser behaviour. Adopting a reduced
local gate would require an explicit update to the current
[repository instructions](../../../CLAUDE.md).

CI does not establish every acceptance criterion. The
[app instructions](../../../packages/app/CLAUDE.md) explicitly say the
IndexedDB adapter is not exercised by the Node tests. Listening quality,
audition behaviour and real browser performance likewise need appropriate
evidence. Keep your judgment at those points; a green build is not a
listening verdict.

Retain independent review for DSP, schema, persistence and other changes
whose defects are costly. Put known boundaries in the brief before work
starts: the harmony wave's register extremes and empty note pool are the
example to carry forward. Review should discover new problems rather than
repeatedly recover omitted acceptance criteria.

Keep one owner of integration. Avoid reflexive rebases, but assess the
change with the current base before merging: a clean textual merge does
not prove that two changes work together. If integration volume eventually
justifies GitHub's merge queue, configure its checks deliberately.
[GitHub requires Actions workflows to handle `merge_group`](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue);
Windsor's current workflow does not have that trigger.

**Automate repair and state transitions from concrete events.**
`/autofix-pr` can start a cloud session that addresses CI failures and
review comments; it requires `gh` and cloud-session access. It offers a
possible replacement for manual feedback relay, not proof of lower cost
or suitability for local audio checks. Source:
[command documentation](https://code.claude.com/docs/en/commands).

My proposed repair policy is to distinguish code failures from transient
infrastructure failures, allow at most two automatic repair attempts, and
then return unresolved work for judgment. Give one worker ownership of a
branch during repair. Associate each result with the PR head and tested
integration state so stale failures do not trigger new edits and stale
successes do not declare completion.

Have deterministic automation project issue/PR/check events onto the
board, with a reconciliation pass after interruption. Agent exit means the
session stopped; PR creation means work is available for review; passing
checks mean those checks passed. None alone means the task was accepted.
GitHub's [agent activity feature](https://github.blog/changelog/2026-03-26-agent-activity-in-github-issues-and-projects/)
displays integrated agent sessions; it does not promise to track every
local CLI worker or maintain your custom Project status field.

Use command hooks for bookkeeping. External execution can avoid adding
bookkeeping to the main context, but prompt hooks and agent hooks invoke
models themselves. “Hooks cost no tokens” is too broad. Source:
[hooks reference](https://code.claude.com/docs/en/hooks).

**For Windsor, runtime isolation is mostly about the browser and machine.**
Give each active preview an explicit port and disposable browser state;
keep scratch outputs separate; serialise shared browser automation and
audio performance measurements. IndexedDB is origin-scoped, so separate
ports help separate app data, while separate browser contexts/profiles
also avoid reusing the user's working state. A browser automation service
can still be a shared lock even when the app origins differ. Sources:
[Windsor's storage decision](../../log/2026-09-27-user-library-in-indexeddb.md),
[IndexedDB documentation](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API).

Worktrees isolate working directories and indexes, but share parts of
Git's repository state, including configuration by default. They do not
reserve CPU, ports or browser tooling. This is directly relevant to
Aotearoa204's `.git/config` race. Containers or remote machines may earn
their setup cost later through resource isolation or unattended execution;
Windsor's present static-site architecture does not call for a database per
ticket. Sources: [Git worktree documentation](https://git-scm.com/docs/git-worktree),
[the HN runtime-isolation discussion](https://news.ycombinator.com/item?id=46510462).

**Evaluate the next wave by completed, accepted work.** Compare similar
task classes at one worker and two workers before increasing concurrency.
Record elapsed time from ready to accepted merge, your intervention
minutes, CI/review waiting, infrastructure retries, integration rework,
and defects discovered after merge. Keep tokens and cost as separate
measures. Reuse the transcript analyser for context and tool-call
diagnostics, but add PR and review timestamps; it cannot infer the whole
delivery process from agent transcripts alone.

The five Windsor research-oriented runs are not a five-minute target for
shipping features. Likewise, a smaller context or fewer board calls is
useful only if it reduces cost without losing needed understanding or
correctness. The [source audit](source-audit.md) records the baseline
corrections and the result of checking all eighteen GPT citations.

For the next Windsor wave, I would keep GitHub and worktrees, select two
changes with explicit ownership, land any shared contract first, limit
heavy tests and browser use separately, and review the resulting delivery
times. Add an event-driven dispatcher or repair loop only where that wave
shows repeated human mechanics. Keep the planning conversation focused on
the instrument you are building.
