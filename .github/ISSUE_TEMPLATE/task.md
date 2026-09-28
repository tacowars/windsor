---
name: Task
about: One unit of work for one worker. The issue is the whole brief.
title: ''
labels: ''
assignees: ''
---

## Goal

One paragraph: what is different when this is done, and why it matters.

## Decisions

Numbered and binding. A worker does not reopen them; a worker that must
deviate says so in the PR and adds the `reviewed` label.

1.

## Owns

Folders and files this ticket may edit. Everything else is off limits; a
need outside this list goes in the PR under "Outside owned folders".

-

Must not edit:

-

## Dependencies

Issues that must be closed first, or "none".

## Acceptance criteria

Checkable statements, including the boundary cases (empty input, register
extremes, first and last step, a song with no parts).

- [ ]

## Verify locally

The test files and checks a worker runs while implementing. CI runs the
full `verify`; the worker does not.

- `npx vitest run <paths>`
- `npm run typecheck && npm run lint`

## Worker

`worker` or `worker-light` (the profiles in `.claude/agents/`), set by the
main session with the PR class. `worker` (effort high) for the engine and
DSP, the song or patch format, persistence and multi-file features;
`worker-light` (effort medium) for a label, a CSS tweak, copy, docs,
config, or a small bug fix with a clear cause.

## PR class

`routine` or `reviewed` (see CLAUDE.md "Working a ticket"), set here when
the issue is written.

`reviewed` waits for Pat: sound design (`patches/`, the worklets, a
golden change), the song document schema, persistence, a deviation from
the issue's decisions, or a UI/UX change to layout, interaction or look (a
new or moved control, a new gesture, a restyle).

`routine` merges on a green check plus no P0 or P1 from Codex: everything
else, including user-visible text the issue spells out word for word (a
rename, a label, a hint), a bug fix that restores intended behaviour
without changing how a control works, tests, docs and refactors.

A `reviewed` PR merges without Pat when all four hold: nothing Pat
can click or hear changes (an engine-only or internal change a preview
would not show); the issue's decisions agreed the design; the worker
raised no deviation and no `needs-human` (a necessary edit outside the
owned files, declared in the PR, is not one); and CI is green with no open
P0 or P1 in Codex's latest review. The main session checks all four.
Anything audible still waits for Pat's listen, and UI for Pat's look.
