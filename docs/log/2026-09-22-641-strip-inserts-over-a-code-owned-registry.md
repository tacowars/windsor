# Strip inserts: code-owned kinds, document-declared instances, live on one strip

- Date: 2026-09-22
- Area: audio
- Links: issue #641 · epic #637 · builds on `2026-09-22-639-sends-tap-the-strip-tail` and `2026-09-22-640-strip-low-cut-is-a-frequency` · the returns precedent is `2026-09-11-music-document-carries-patches-and-returns`

## Decision

A channel strip carries `inserts`, an ordered list of insert effects after
the low cut and before the tap, so the sends hear them.

1. **The kinds are code-owned; the instances are the document's.** Which
   returns exist is the code's (`RETURNS`), and a song can only set them.
   Inserts can't work that way: a chorus built on every strip just in case
   would be DSP running for nothing. So the kinds live in a registry
   (`inserts/insertRegistry.ts`, `INSERT_KINDS`: drive today), and a song's
   strip names which of them it uses, up to `MAX_INSERTS` (2). A kind the
   code does not define is dangling, dropped and reported, and fails the
   shippable gate like a dangling return. Entries past the limit are dropped
   with a correction.
2. **A kind is one file.** It exports its spec type, its defaults and an
   `InsertKind`: `fields`, `defaults`, `normalise` (over the document's
   `FieldNormaliser`) and `create`. `create` builds a fixed graph whose `set`
   is param writes only. `dispose` disconnects what it built, never the edge
   out of its `output`, which is the strip's, and stops any source it
   started. The strip, the normaliser and the live path needed no
   kind-specific code. `routePart` takes the registry as a parameter
   defaulting to `INSERT_KINDS`, so tests inject their own kind.
3. **A live edit sends the whole list.** An array in a partial replaces the
   document's wholesale, in the engine's `DeepPartial` and the console's
   `deepMerge` alike. So an insert knob sends the strip's whole next list,
   and the engine compares kinds:
   - The same kinds in the same order are param writes on the live stages.
   - Any other list rebuilds **that strip's insert chain only**. The strip
     object, its low cut, its pan and sends, every other strip and every
     generator stay as they were, and the transport keeps running.
   - The console never calls `ctx.restructure` for an insert. Only Import
     and Restart rebuild the system (#629).
   - A list naming a kind the registry lacks is refused before the graph is
     touched.

   The live list goes through the document's own normaliser. A clamp is
   silent, as for every live number; anything dropped or replaced is
   reported by path in `ignored`.
4. **Drive:**
   - A tanh `WaveShaperNode` over a curve built once and shared
     (`tanhCurve.ts`, which the echo's loop clip from #647 now uses too), with
     `oversample: '2x'`.
   - The amount is a gain before the shaper, never a curve swap, so turning
     it cannot click.
   - A Butterworth lowpass **Tone** after the shaper, and a parallel dry path
     for **Mix**.
   - The wet gain carries compensation that holds a −12 dBFS sample at its
     own level at any drive, so Drive changes colour more than loudness.
   - Ranges: Drive 0–36 dB (default 12), Tone 500 Hz–16 kHz (default
     8 kHz), Mix 0–1 (default 1).
5. **Inserts are post-fader.** The fader is the worklet's k-rate `gain`, ahead
   of every stage, so a strip's Level changes how hard it drives an insert.
   Drive is the trim that compensates. The Mixer tab's section note says so.

## Why

Pat asked for per-channel distortion and chorus. The registry keeps the rule
that no DSP runs unless a table declares it, while letting a song choose its
effects. The whole-list partial reuses the one array rule the document
already has, instead of inventing index-keyed partials. The same-kinds check
makes the common case, turning a knob, a param write with no graph change,
and a structural edit costs one strip's chain, not a restart.

Measured through the fake graph (`inserts/driveInsert.test.ts`):
- At the least drive, a −12 dBFS sine comes out within 0.25 dB, with its
  third harmonic below −35 dB.
- At 24 dB of drive the third harmonic rises above −20 dB.
- At full drive and full scale, the output stays within the compensation
  times the tone filter's impulse-response L1 norm (an exact bound; an
  analogue overshoot figure under-reads a digital filter this close to
  Nyquist).
- At Mix 0 the output is the input, sample for sample.

## Punted / alternatives

- **Pre-fader inserts.** Only possible by moving the fader out of the worklet
  into a `GainNode` after the stages, which costs the "no node in the dry
  path" property (record `2026-08-31-mixer-sends-returns-and-channel-strips`
  §3). Revisit if the Level/Drive interaction bothers a mix.
- **Index-keyed partials** (`inserts: { 0: { drive: 20 } }`). A second
  partial shape for one field; the whole list is small.
- **Insert reordering in the console.** The engine takes any order, but the
  console adds at the end and removes by index. Drag-to-reorder waits for a
  mix that needs it.
- **Cost.** The audio-load meter reads only nodes with a `port`
  (`audioLoad.ts`), so native insert chains are invisible to it. No cost is
  claimed here. A reading at `MAX_INSERTS` on every strip belongs to the next
  audio milestone on the target box (CLAUDE.md invariant 3).
