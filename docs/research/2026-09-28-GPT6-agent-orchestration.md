My question:
I'm using a kanban-based project for agent orchestration state and leveraging git worktrees and ticket backlog to parallelize and scale work on a software project. Its my software factory pattern. I use github projects, ci , and repo for this atm. its september 2026, is this a common pattern? Are there more efficient patterns when using Claude Code? What do Hacker News people do?

GPT-6 answer:
Yes. As of **September 2026**, what you’re calling your *software factory* has become one of the dominant emerging patterns for serious coding-agent orchestration:

**durable task state → isolated workspace → coding agent → automated verification → PR → integration**

Git worktrees in particular have gone from a relatively obscure Git feature to almost a de facto primitive for parallel coding agents. Anthropic now documents it directly, Claude Code has `claude --worktree`, and Claude Code Desktop automatically gives parallel sessions isolated worktrees. Claude Code’s `/batch` goes even further: it decomposes a large change into **5–30 independent units**, creates isolated worktrees, runs background agents, tests them, and publishes the changes. ([Claude][1])

So your architecture is quite aligned with where the ecosystem has gone.

### What HN people are actually doing

There are strikingly similar systems showing up repeatedly on Hacker News.

`wt` takes a GitHub issue, makes a worktree and branch, launches Claude, and manages the session. ([Hacker News][2]) Superset manages many Claude/Codex agents with one worktree per agent, notifications and diff review. ([Hacker News][3]) KanVibe literally couples **Kanban state + Claude hooks + worktrees**, automatically moving cards through progress/review states. ([Hacker News][4])

More elaborate systems look even more like your "factory." Stoneforge uses a director, task workers, separate worktrees, reviewer agents and task handoffs between context windows. ([Hacker News][5]) TTal separates a persistent **manager plane** from disposable **worker agents**, with workers implementing, reviewing, handling CI feedback and merging. ([Hacker News][6]) Another HN orchestrator has an agent reading the backlog, decomposing tasks, starting workers in worktrees, feeding CI failures back to them, handling review comments and using a merge queue to keep agents from developing against stale `main`. ([Hacker News][7])

There's even an HN example almost exactly describing your workflow: *"one branch per worktree per PR"* with multiple Claude sessions, GitHub review and agents operating simultaneously. ([Hacker News][8])

So I'd distinguish two things:

**Worktrees + parallel agents:** rapidly becoming commonplace among Claude Code power users.

**GitHub Projects/Kanban as an explicit persistent orchestration state machine:** less universal, and arguably more systematic than the typical "I have four Claude terminals open" workflow.

## Where I would evolve your factory now

I would **not replace GitHub Projects, Git, CI or worktrees**. They're extremely good durable primitives. I'd change what sits between them.

The architecture I'd aim for now is:

```text
                 HUMAN CONTROL PLANE

                  GitHub Project
                       │
          ┌────────────┴────────────┐
          │                         │
       backlog                    goals
       priority               architecture
       dependencies          acceptance criteria
          │
          ▼
              AGENT SCHEDULER
          dependency + conflict graph
          │        │        │
          │        │        │
          ▼        ▼        ▼
       lane A    lane B    lane C
       
      subagent   worktree   worktree
      research   Claude     Claude
                    │          │
                    ▼          ▼
                   PR         PR
                    │          │
                    └────┬─────┘
                         ▼
                  CI / verification
                         │
                  reviewer agents
                         │
                     autofix
                         │
                    merge queue
                         │
                         ▼
                       main
                         │
                         ▼
                 GitHub Project
```

The big change is that **Kanban should be your presentation/state layer, not your scheduling algorithm**.

A scheduler should reason about a DAG:

```text
TASK-101 database schema
   ├── TASK-102 API
   │      └── TASK-105 frontend
   └── TASK-103 migration
          └── TASK-106 integration tests

TASK-104 documentation
```

Then it can dispatch `101` and `104`, wait for `101`, dispatch `102` and `103`, etc.

This matters more as you increase parallelism. "Todo / Doing / Review / Done" doesn't capture enough information for an agent scheduler.

### Claude Code now gives you three useful levels of concurrency

This is where I think you can simplify your implementation substantially.

Don't allocate a worktree to everything.

**Level 1 — subagent**

Use for:

* research
* finding code
* architecture investigation
* code review
* test analysis
* security review

Subagents get their own context and return a condensed result to the parent. Anthropic explicitly recommends this for keeping the main context clean. ([Claude][1])

No branch. No worktree. No cleanup.

**Level 2 — independent coding worker**

Use:

```bash
claude --worktree GH-418
```

for something that should become an independently mergeable change.

That's basically your current factory unit. Claude now supports this natively. ([Claude][1])

**Level 3 — agent team / batch**

For something like:

> migrate our 42 React components from API X to API Y

don't create 42 tickets manually.

Claude Code now has:

```text
/batch migrate src/ from old API to new API
```

It researches the codebase, decomposes the work into 5–30 independent units and starts background workers in separate worktrees. ([Claude][9])

Agent teams are another option when the workers actually need to communicate. Anthropic distinguishes them from subagents: subagents report to the parent, whereas agent-team members have independent contexts, shared task coordination and can message each other. ([Claude][10])

That suggests a useful factory rule:

```text
Need information?
    → subagent

Need an independently committable change?
    → worktree worker

Need N homogeneous independent changes?
    → /batch

Need multiple workers to reason/coordinate together?
    → agent team
```

That's considerably cheaper and simpler than "ticket = agent = worktree" universally.

## CI should become part of the agent loop

This is another area where Claude Code has moved toward your model.

It now has `/autofix-pr`, which starts a cloud agent watching the current PR. If CI fails or a reviewer leaves comments, Claude can fix them and push another change. ([Claude][9])

So instead of:

```text
Agent
 ↓
PR
 ↓
CI fails
 ↓
tacowars notices failure
 ↓
restart agent
 ↓
fix
```

you want:

```text
Agent
  ↓
 PR
  ↓
 CI ───── failure ─────┐
  ▲                     │
  └──── fix agent ◄─────┘
  │
 success
  ↓
review
  ↓
merge queue
```

**Humans should mostly wake up for judgment, not mechanics.**

That's probably the biggest opportunity I see in your existing factory pattern.

## Use deterministic automation for state changes

I would also resist having Claude continually update GitHub Projects itself.

For example:

```text
agent spawned
    ↓
Doing

PR opened
    ↓
Review

CI failing
    ↓
Agent Fixing

CI green
    ↓
Ready For Review

PR merged
    ↓
Done
```

Those are deterministic events.

Use Claude Code hooks, GitHub webhooks and Actions to move them automatically.

Claude Code hooks run outside the model's context, which means they have effectively zero context cost unless they explicitly inject something back into the conversation. ([Claude][10])

That makes hooks excellent plumbing for your software factory.

**Use LLM reasoning for decisions. Use deterministic code for bookkeeping.**

That's an important architectural boundary.

## Worktrees don't solve runtime isolation

HN users have hit one important limitation to the worktree model that you should account for.

Worktrees isolate:

```text
source files
branches
git state
```

They do **not** isolate:

```text
ports
databases
Docker names
Redis
filesystem outside repo
cloud credentials
processes
environment state
```

One HN discussion specifically describes parallel Claude worktrees running into this problem with databases, services and ports. ([Hacker News][11])

Another describes creating a separate development/test database in Docker for each Claude worktree. ([Hacker News][12])

For your software factory I'd therefore eventually make:

```text
ticket
   │
   ├── worktree
   │
   └── ephemeral dev environment
          ├── DB
          ├── services
          ├── ports
          └── credentials
```

rather than worktree alone.

Anthropic reached essentially the same conclusion at larger scale. Their experimental 16-agent C-compiler project gave every Claude instance its **own Docker container and repository clone**, with Git acting as the synchronization mechanism. ([Anthropic][13])

And Anthropic now explicitly argues that containment enables higher autonomy because an agent with a constrained blast radius can safely be given substantially more freedom. ([Anthropic][14])

That fits very naturally with the "devspace" idea you've been exploring.

## The surprising HN disagreement: parallelism isn't free

There is a countercurrent on HN worth taking seriously.

Some developers argue that throwing 10–30 agents at a codebase simply moves the bottleneck from **generation** to **verification**. One discussion points out that each worktree agent independently has to rebuild context, while another commenter argues the real scarce resource is developer attention rather than tokens. ([Hacker News][15])

Another HN developer explicitly rejects broad parallelism and says they prefer **depth-first recursive dispatch**, serializing the work because one careful agent can outperform many agents producing mistakes. ([Hacker News][16])

I think there's an important architectural lesson there.

Parallelism should be proportional to **independence**, not available compute.

Consider:

```text
                 independence

CSS cleanup      ████████████████  → parallelize
unit tests       ███████████████   → parallelize
docs             ████████████████  → parallelize
independent API  █████████████     → parallelize

shared types     ███████
DB redesign      ████
architecture     ██
core refactor    ██
```

Launching eight agents against a tightly coupled architectural refactor usually produces eight merge conflicts and eight slightly different mental models.

For genuinely independent work, it's enormously effective.

## Your next optimization is probably WIP control

This is perhaps counterintuitive given that agents make parallelism cheap.

I'd put a **WIP limit on your factory**.

For example:

```text
READY             24
RUNNING             4
CI                   3
AGENT REVIEW         2
HUMAN REVIEW         1
```

Your scheduler doesn't ask:

> How many agents can I run?

It asks:

> How many changes can my verification and integration pipeline absorb?

That makes your bottleneck visible.

If PR review can sustainably absorb four changes an hour, running 30 agents isn't necessarily better than running six.

## I would also separate persistent knowledge from task context

Claude's current guidance fits something you've already been moving toward with your factory.

Keep `CLAUDE.md` small—Anthropic's current documentation recommends keeping it focused and moving conditional information into skills/rules. Claude supports path-scoped rules, reusable skills, isolated subagents and persistent agent memory. ([Claude][17])

So I would structure factory context approximately like:

```text
CLAUDE.md
    core invariants
    architecture
    commands
    coding conventions

.claude/rules/
    frontend.md
    database.md
    security.md

.claude/skills/
    implement-ticket/
    review-pr/
    debug-ci/
    create-migration/

GitHub issue
    task-specific requirements
    acceptance criteria
    dependencies

git
    actual implementation state
```

That avoids every worker carrying the entire company's accumulated instructions.

Anthropic's broader context-engineering guidance says much the same thing: keep detailed exploration inside isolated workers and bring compact summaries back to the coordinating context. ([Anthropic][18])

---

### So, is your pattern still state of the art?

Broadly, **yes—but the unit of orchestration is shifting upward**.

A year ago the interesting trick was:

```text
Claude + git worktree
```

By September 2026 that part is almost mundane. Anthropic has made it a first-class feature, and there are numerous HN tools wrapping exactly that pattern. ([Claude][1])

The interesting engineering problem now is:

```text
                     SOFTWARE FACTORY

requirements
     │
dependency decomposition
     │
scheduler
     │
     ├── cheap subagents
     ├── coding worktrees
     ├── agent teams
     └── batch workers
              │
       isolated runtimes
              │
             PR
              │
       verification agents
              │
           CI loop
              │
         merge queue
              │
            main
              │
         telemetry/evals
```

In other words, **GitHub Projects + Git + worktrees + CI are still excellent foundations.**

I wouldn't replace them.

I'd make your next version less about manually orchestrating worktrees and more about a **dependency-aware scheduler, automatic execution-state transitions, runtime isolation, autonomous CI remediation, and choosing the cheapest Claude concurrency primitive appropriate to each task**.

That's essentially where both Claude Code itself and the more sophisticated HN experiments appear to be converging.

[1]: https://code.claude.com/docs/en/common-workflows "Common workflows - Claude Code Docs"
[2]: https://news.ycombinator.com/item?id=46765489&utm_source=chatgpt.com "Show HN: wt – lightweight Git worktree orchestrator for parallel coding agents | Hacker News"
[3]: https://news.ycombinator.com/item?id=46368739&utm_source=chatgpt.com "Show HN: Superset – Terminal to run 10 parallel coding agents | Hacker News"
[4]: https://news.ycombinator.com/item?id=47034185&utm_source=chatgpt.com "Show HN: KanVibe – Kanban board that auto-tracks AI agents via hooks | Hacker News"
[5]: https://news.ycombinator.com/item?id=47267105&utm_source=chatgpt.com "Show HN: Stoneforge – Open-source orchestration for parallel AI coding agents | Hacker News"
[6]: https://news.ycombinator.com/item?id=47435275&utm_source=chatgpt.com "TTal – CLI that turns Claude Code into a multi-agent software factory | Hacker News"
[7]: https://news.ycombinator.com/item?id=47219229&utm_source=chatgpt.com "Show HN: Agent Orchestrator – Built using the agents it orchestrates | Hacker News"
[8]: https://news.ycombinator.com/item?id=48516623&utm_source=chatgpt.com "What are people's workflows these days? As I use claude more and more I've start... | Hacker News"
[9]: https://code.claude.com/docs/en/commands "Commands - Claude Code Docs"
[10]: https://code.claude.com/docs/id/features-overview?utm_source=chatgpt.com "Perluas Claude Code - Claude Code Docs"
[11]: https://news.ycombinator.com/item?id=46510462&utm_source=chatgpt.com "Ask HN: Does git worktree really help with parallel dev? | Hacker News"
[12]: https://news.ycombinator.com/item?id=46190907&utm_source=chatgpt.com "The usage of worktrees is seeing a big comeback in the era of AI assisted coding... | Hacker News"
[13]: https://www.anthropic.com/engineering/building-c-compiler?utm_source=chatgpt.com "Building a C compiler with a team of parallel Claudes \ Anthropic"
[14]: https://www.anthropic.com/engineering/how-we-contain-claude?utm_source=chatgpt.com "How we contain Claude across products \ Anthropic"
[15]: https://news.ycombinator.com/item?id=46504554&utm_source=chatgpt.com "Every time I've seen people use Git worktrees with agents, it's incredibly waste... | Hacker News"
[16]: https://news.ycombinator.com/item?id=46682551&utm_source=chatgpt.com "Ask HN: How do you run parallel agent sessions? | Hacker News"
[17]: https://code.claude.com/docs/fr/claude-directory?utm_source=chatgpt.com "Explorez le répertoire .claude - Claude Code Docs"
[18]: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents?utm_source=chatgpt.com "Effective context engineering for AI agents \ Anthropic"
