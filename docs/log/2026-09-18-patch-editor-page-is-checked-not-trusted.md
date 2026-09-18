# The tracked console page is checked, not trusted

- Date: 2026-09-18
- Area: audio
- Links: issue #620 · epic #622 · record `2026-08-31-arrangement-console-and-runtime-arrangements` ("The console is a local tool")

## Decision

`node tools/patch-editor/build-editor.mjs --check` builds the console to
memory and exits 1 when the tracked `tools/patch-editor/patch-editor.html`
differs from what its sources produce (a missing page is the same failure);
`npm run verify` runs it right after `npm run build`, so a source, template,
DSP or preset edit committed without a rebuild fails the gate. `.gitattributes`
marks the page `linguist-generated=true` — GitHub collapses it in review —
and deliberately not `-diff`, so `git diff` still shows it. The build's
forbidden-string scan reads the console's code, not its tests.

## Why

The page is a build output that is committed so the console runs from a
file with no dev server (the local-tool decision). Until now nothing checked
it against its sources: it was in sync on 2026-09-18 by discipline alone, and
a stale page would have shipped a console that disagreed with the engine
the tests had verified. Its 20k-line diffs on every preset merge also drowned
PR review, which the attribute fixes without hiding it from local tooling.
The check runs after `build` because the bundle resolves `@aotearoa/shared`
through the shared package's `dist/`.

## Punted / alternatives

Generating the page in CI and not tracking it would remove the diff
entirely, but the console is run from the checkout (`file://`, a MIDI
controller in Chrome) and a page that must be built first is a page that is
sometimes stale on the machine that runs it. The check keeps the tracked
file and makes staleness a red gate instead.
