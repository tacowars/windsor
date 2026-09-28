# Evidence and citation audit

Checked 2026-09-28 for the [refined answer](README.md). Inputs were the
[GPT answer](../2026-09-28-GPT6-agent-orchestration.md), the
[Claude report](../2026-09-28-agent-orchestration-overhead/README.md), its
[generated tables](../2026-09-28-agent-orchestration-overhead/transcript-overhead-report.md)
and relevant current repository files. This review inspected the existing
measurements and selected analyser code; it did not rerun the transcript
analysis or measure a new implementation wave. Recommendations in the
refined answer are proposals, not reported performance improvements.

**GPT citation checks.** Numbers correspond to the original answer.
Seventeen cited pages were retrieved; citation 15 could not be retrieved
after retries, including an attempt through HN's item API. English
equivalents were also read for the Indonesian and French documentation.
Live docs establish what was documented at this reading, not when each
feature first became available or whether this account has access.

| # | Source | Assessment |
| --- | --- | --- |
| 1 | [Common workflows](https://code.claude.com/docs/en/common-workflows) | Supports native worktrees and isolated research subagents. The current dedicated worktree page confirms desktop worktree use; the commands page supports the batch details. None measures adoption prevalence. |
| 2 | [wt on HN](https://news.ycombinator.com/item?id=46765489) | Author describes worktree/session management and an issue-driven `/do` skill. Evidence of an implementation, not comparative efficiency. |
| 3 | [Superset on HN](https://news.ycombinator.com/item?id=46368739) | Supports parallel worktree usage. Discussion also supplies limits from human review and reports of only two or three substantial concurrent tasks; shared-checkout reservations appear as an alternative. |
| 4 | [KanVibe on HN](https://news.ycombinator.com/item?id=47034185) | Author explicitly describes hook-driven board status and worktree creation/cleanup. |
| 5 | [Stoneforge on HN](https://news.ycombinator.com/item?id=47267105) | Describes director, dispatch daemon, worktrees, review stewards and recovery handoffs. Its author advocates worktrees over containers, so this source does not support a universal convergence toward containerised runtimes. |
| 6 | [TTal on HN](https://news.ycombinator.com/item?id=47435275) | Supports the persistent-manager/disposable-worker description and automated PR loop. No comparative cost data. |
| 7 | [Agent Orchestrator on HN](https://news.ycombinator.com/item?id=47219229) | Author reports backlog planning, workers, CI repair, review feedback and a merge queue. This is a self-report, not a benchmark or evidence that Windsor needs the same system. |
| 8 | [Workflow discussion on HN](https://news.ycombinator.com/item?id=48516623) | Direct branch/worktree/PR example. Replies also discuss three-session limits and distinguishing apparent completion from accepted work. |
| 9 | [Commands](https://code.claude.com/docs/en/commands) | Confirms `/batch` and `/autofix-pr`. Batch is labelled a skill, plans 5–30 units, and requires approval of its plan. Autofix requires cloud-session access and `gh`. Availability is conditional. |
| 10 | [Features overview, cited Indonesian version](https://code.claude.com/docs/id/features-overview) | Supports separate contexts and external-hook context savings. Dedicated team docs add the experimental/default-off qualification; dedicated hooks docs distinguish model-invoking hooks. |
| 11 | [Runtime constraints on HN](https://news.ycombinator.com/item?id=46510462) | Direct account of shared DB/service/port and resource problems. Closely resembles HOOP's experience; not evidence that every project needs a full stack per worker. |
| 12 | [Worktree/DB example on HN](https://news.ycombinator.com/item?id=46190907) | Commenter describes per-worktree dev/test databases in Docker. Useful for a service-backed app, not a requirement for Windsor. |
| 13 | [Anthropic C compiler experiment](https://www.anthropic.com/engineering/building-c-compiler) | Confirms 16 agents, per-agent containers and clones, with Git synchronisation. A large experiment establishes feasibility, not the optimal setup or economics for this project. |
| 14 | [Anthropic containment article](https://www.anthropic.com/engineering/how-we-contain-claude) | Supports enforced boundaries as a way to allow unattended operation. Security containment and avoiding runtime contention are related but different requirements. |
| 15 | [Context/attention criticism on HN](https://news.ycombinator.com/item?id=46504554) | Not retrievable here. Its specific attribution is not relied on. Accessible citations 3 and 16 independently contain attention and review concerns. |
| 16 | [Parallel sessions on HN](https://news.ycombinator.com/item?id=46682551) | Confirms the deliberately serial, depth-first account and a separate attention-limited account. Neither establishes that serial execution generally wins. |
| 17 | [.claude directory, cited French version](https://code.claude.com/docs/fr/claude-directory) | Supports separating instructions, rules, skills, agents and workflows. The English directory page and features overview help clarify loading. This is organisation guidance, not evidence that adding more files saves tokens. |
| 18 | [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Supports selective context, durable notes and condensed subagent results. Its research example does not establish coding throughput or cost gains for Windsor. |

**Corrections to carry forward from the local evidence.** The Claude
report is much more relevant than the generic GPT answer, but several
figures and deductions need qualification:

1. The original Aotearoa204 post-mortem corrected its own MVP cache-read
   total from **2.48 billion to 1.19 billion**, median turns from **218 to
   93**, and estimated model-think share from **46.7% to 44%**. Repeated
   streaming records had inflated the original counts. The September 28
   README repeats the superseded figures. Read section 6 and later
   sections of the [original post-mortem](/Users/arrakis/code/Aotearoa204/docs/research/2026-09-02-mvp-protocol-post-mortem.md).
2. The generated September 28 tables give **21m11s** as the median for
   the 26 implementer runs; **12m18s** is the median across all 35
   subagent runs. Follow-up runs can belong to the same ticket, so neither
   is automatically a per-ticket delivery time. The source report also
   warns that elapsed time includes human and permission waits.
3. The **68% finish-phase share** begins at the first finish-script call
   and ends at the last transcript event. The analyser does not isolate
   verification as the cause of that entire interval. Similarly, **3h29m**
   is summed duration of whole shell calls containing `ticket-finish.sh`,
   not a clean measurement of test CPU time or project critical-path time.
4. The README's **USD 803 / 5.9M output tokens** does not match the
   generated report's **USD 732.83 / 4.3426M** harness totals. This review
   does not resolve the difference and does not use either as a budget.
5. Windsor's five runs comprise two Explore runs, a measurement task, a
   web-research task and one context fork. Four start around **12–28k**
   tokens; the fork starts around **111k**. Their five-minute median is
   neither a universal subagent floor nor a matched implementation
   benchmark. Small fresh contexts can reduce duplication; forks can
   deliberately carry extensive context. Current
   [loading documentation](https://code.claude.com/docs/en/features-overview)
   also distinguishes Explore/Plan from other agent types.
6. No causal comparison isolates the role file, shell reading style or
   agent count. Retrieved content volume matters more than the name of
   the reading tool. Cost also depends on caching, model, task difficulty
   and repeated turns. Avoid turning correlations into fixed multipliers.
7. The external fan-out multipliers and cross-agent conflict percentages
   in Claude's README were not independently revalidated for this review
   and are not used as Windsor estimates. Local contention and rework
   records are sufficient to motivate the proposed experiment.

**Local history read directly**, in addition to Windsor's instructions,
fork/storage records, package scripts and CI configuration:

- [Aotearoa204 MVP post-mortem, including its corrections](/Users/arrakis/code/Aotearoa204/docs/research/2026-09-02-mvp-protocol-post-mortem.md).
- [Aotearoa204 harmony wave handoff](/Users/arrakis/code/Aotearoa204/.claude/handoffs/2026-09-27T01-30-orchestrator-harmony-v2-epic-703-merged.md): timeout failures, omitted boundary fixtures, valuable review findings and shared append sites.
- [HOOP context reductions](/Users/arrakis/code/HOOP/.claude/handoffs/2026-09-19-1338-context-savers-built.md): short reports, shared-stack constraint and separated browser review.
- [HOOP browser contention](/Users/arrakis/code/HOOP/.claude/handoffs/2026-09-19-2055-email-sender-live-impacto-nine-merges.md): five simultaneous browser checks stalled; subsequent checks were serialised.
- [HOOP board-query improvement](/Users/arrakis/code/HOOP/.claude/handoffs/2026-09-20-0120-session-close-eight-merges-ai-read-records.md): expensive list queries, cheaper item operations and contract-first parallel work.

These absolute links refer to sibling checkouts on tacowars's machine. The
committed Windsor report remains the portable summary of those projects.

**Documentation distinctions that change the recommendation.**
[Dynamic workflows](https://code.claude.com/docs/en/workflows) hold
intermediate results in script variables; a prompted batch skill should
not be credited automatically with that property.
[Agent activity in GitHub](https://github.blog/changelog/2026-03-26-agent-activity-in-github-issues-and-projects/)
is an integrated-session display, not documented automatic registration
of arbitrary local workers or custom board transitions.
[Worktrees](https://git-scm.com/docs/git-worktree) share repository state;
they are not a complete Git or runtime sandbox.
[Hooks](https://code.claude.com/docs/en/hooks) include prompt and agent
variants that invoke models, so external execution does not mean all
hooks are free of model cost.
