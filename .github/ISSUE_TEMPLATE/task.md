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

## PR class

`routine` or `reviewed` (see CLAUDE.md "Working a ticket"). Sound design,
UI/UX, the song document schema, persistence and any deviation are
`reviewed`.
