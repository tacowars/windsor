# Captured patterns live in the drivers as null-or-array; console seams found in implementation

- Date: 2026-09-01
- Links: issue #70 · implements
  `2026-08-31-arrangement-console-and-runtime-arrangements` §1, §2, §6 ·
  extends `2026-08-31-arrangement-document-schema-and-optional-parts` (#75)

The parent record decided *that* a generated bar can be captured into a
literal array in the document (§6) and that the console drives the real
engine (§1). Neither pinned the representation nor the seams; these are the
decisions made while implementing #70.

## Decision

1. **A captured pattern is a `pattern` field on the part's driver, and in a
   normalised document it is always present: `null` when generative, a
   literal array when captured.** Percussion drivers carry booleans (one per
   step, length = `steps`); the arp and drone carry `(midiNote | null)[]`,
   looped bar-relative. Always-present-null is load-bearing, not cosmetic:
   the engine-side merge (`mergeArrangement`) only reaches keys the current
   arrangement has, so an optional-when-absent field could never be captured
   *or released* through the live `AudioSystem.apply` path.

2. **The generators own fixed playback; there is no separate fixed-sequencer
   type.** Each of `EuclideanSequencer`, `Arpeggiator` and `StepSequencer`
   takes the optional `pattern` and, when set, plays it verbatim — no
   regeneration, no RNG consumed, pool/walk/skip/density unused. The player
   spreads the driver into the config it already builds, so the binding layer
   is untouched. A captured pitched note reports `degree: -1` — it was not
   drawn from the scale, and pretending otherwise would be a lie in the data.

3. **Capture reads what actually sounded.** The percussion figure is read off
   the sequencer (`currentPattern`); a pitched bar exists only as the notes
   it emitted, so the player records note-ons per step (`BarRecorder`,
   `capturedPattern.ts`) and capture returns the last completed bar. Drone
   ties emit no events, so a drone capture forward-fills rests with the
   sounding note — which reproduces the tie exactly under the step
   sequencer's tie rule — and an all-tie stretch falls back to the held note.

4. **The console's modules are TypeScript, type-checked against the real
   engine.** `tools/patch-editor/src/**` imports
   `packages/client/src/audio/index-for-editor.ts` directly;
   `tools/patch-editor/tsconfig.json` joined the root `npm run typecheck`.
   esbuild strips types without checking, so without this the console —
   whose whole point is driving the real API — would be untyped against it.

5. **Returns and spaces in the Mixer tab are live-only.** #75 deliberately
   punted `returns`/`spaces` sections from the document schema; the tab
   drives the live `ReturnBus` levels and the plate's space parameters and
   says so in its hint. Extending the schema is the revisit path #75 named,
   not something this ticket smuggles in.

6. **Standalone-file seams found by verification, kept as code:**
   `import.meta.url` (the worklet URL default) does not exist in an IIFE, so
   `build-editor.mjs` defines it to `self.location.href` — the default only
   ever needs to construct, the host always passes overrides. And a `file://`
   origin refuses *blob* worklet modules (AbortError, found driving the
   built console from file://), so the host tries blob URLs and falls back
   once to data URLs on a fresh context. One context lives for the page; a
   structural change rebuilds engine + system on it, and re-`init` with the
   same URLs resolves from the context's worklet module map without
   re-registering processors.

## Why

The through-line from the parent record is one source of truth per thing.
The pattern lives where the rest of the driver lives, in the document the
gate already checks; playback lives in the generator that owns the step
grid; and capture reads the emission stream rather than re-deriving what
"should" have sounded. The always-null default trades a few `"pattern":
null` lines in committed JSON for a live path with no special cases.

## Punted / alternatives

| Rejected | Why not |
|---|---|
| `pattern?` optional, absent when generative | Release (and first capture) cannot merge through `apply`; every write becomes a rebuild that restarts the transport mid-audition |
| A separate `FixedSequencer` generator | A fourth generator type plus player branching, for behaviour each generator expresses in a few lines |
| Capture predicts the next bar instead of recording the last | Prediction would consume the RNG it predicts; recording is exact and free |
| Note arrays carry degrees too | The degree is derivable when wanted and wrong when the key has changed since capture; `-1` is honest |
| Console modules in plain JS | Bundled unchecked against the exact API drift the console exists to prevent |
| Document sections for returns/spaces now | #75's explicit punt; the console's hint marks them live-only until that revisit |
