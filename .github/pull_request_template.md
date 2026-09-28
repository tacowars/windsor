Fixes #

## Class

`routine` or `reviewed`, as the issue sets it. If the diff crosses into a
`reviewed` area, say so here, add the `reviewed` label, and tacowars merges.

`reviewed` waits for tacowars: sound design (`patches/`, the worklets, a
golden change), the song document schema, persistence, a deviation from
the issue's decisions, or a UI/UX change to layout, interaction or look (a
new or moved control, a new gesture, a restyle).

`routine` merges on a green check plus no P0 or P1 from Codex: everything
else, including user-visible text the issue spells out word for word (a
rename, a label, a hint), a bug fix that restores intended behaviour
without changing how a control works, tests, docs and refactors.

A `reviewed` PR merges without tacowars when all four hold: nothing tacowars
can click or hear changes (an engine-only or internal change a preview
would not show); the issue's decisions agreed the design; the worker
raised no deviation and no `needs-human` (a necessary edit outside the
owned files, declared in the PR, is not one); and CI is green with no open
P0 or P1 in Codex's latest review. The main session checks all four.
Anything audible still waits for tacowars's listen, and UI for tacowars's look.

## What changed

## How to check it

The commands or steps that show it working, and which tests cover it.

## Outside owned folders

Files touched outside the issue's "Owns" list, and why. "None" if none.

## Decision record

`docs/log/<file>.md`, or why no decision was made.
