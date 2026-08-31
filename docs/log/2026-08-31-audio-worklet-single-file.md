# The DSP worklet stays one file

- Date: 2026-08-31
- Links: issue #33 · `CLAUDE.md` "Code structure" · `eslint.config.js`
  (`max-lines`) · `docs/design/audio-architecture.md` §6.1

## Decision

`packages/client/src/audio/worklet/fm-processor.js` is ~1,150 lines against a
`max-lines` cap of 300. It carries a file-top
`/* eslint-disable max-lines -- … */` with the reasoning, rather than being
split. The cap itself is unchanged; this is a single-file exception, which is
what `CLAUDE.md` sanctions provided the reason is stated and weighable.

It also stays plain JavaScript rather than TypeScript, and is excluded from
`tsc` by virtue of the client tsconfig not enabling `allowJs`.

## Why

The file has no `import` statements, and that is load-bearing rather than
incidental. `AudioWorklet.addModule()` takes a URL, so the DSP must reach the
browser as one resolvable script. Because this file imports nothing,
`new URL('./worklet/fm-processor.js', import.meta.url)` resolves correctly in
both the Vite dev server and the production build, with no bundler
configuration at all.

Splitting it reintroduces exactly the problem that single file avoids. Vite's
asset handling has a specific trap here: `?url` and
`new URL(…, import.meta.url)` yield a URL for the file itself *without*
bundling its dependency graph, which works in dev and breaks in a build. A
split worklet would therefore need a second Rollup input, a `?worker&url`
indirection, or a bespoke build step — build-system complexity bought with no
gain in the code, since the operator, envelope, filter and voice code is one hot
loop read top to bottom and the seams a split would follow are already section
comments.

`docs/design/audio-architecture.md` §6.1 recorded this as an unresolved spike
blocking any audio ticket. Keeping the file whole is what resolved it; §6.1 is
updated to say so.

TypeScript is declined for the same reason: compiling it would put a build step
between the source and the asset. The types that matter are at the boundary —
the patch schema and the message contract — and those are TypeScript, in
`patch.ts` and `workletMessages.ts`.

## Punted / alternatives

- **Raise `max-lines` repo-wide.** Rejected. `eslint.config.js` says a limit is
  raised only with a decision record, and this is one file's problem, not the
  repo's.
- **Split anyway and add a worklet bundling step.** Punted, not refused. If the
  DSP grows a second worklet, or wants to share code with the main thread beyond
  the schema, the bundling question returns and should be answered then.
- **The duplication this leaves.** The waveform enums and the 11-algorithm
  routing table exist twice: in the worklet, and in `patch.ts` for the main
  thread and the editor. That is a real cost of the no-imports rule. It is
  mitigated, not hidden: `patch.test.ts` asserts the two copies are identical
  and fails the build if they diverge.
