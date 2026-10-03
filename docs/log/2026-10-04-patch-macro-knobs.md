# Patch macro knobs: a macro is a voice target row the voice resolves first

- **Date:** 2026-10-04
- **Status:** accepted; the epic builds it (the engine seam, the voice's
  resolution, then the Parts tab's Macros card).
- **Mockup:** `docs/design/macro-knobs-mockup.html`, layout A (tiles + list)
  chosen by tacowars on 2026-10-04; B is the alternative it was chosen over.
- **Builds on:** `2026-10-02-one-voice-target-table`,
  `2026-10-01-song-automation-lanes`, `2026-10-02-knob-ranges-from-the-catalog`

## Context

tacowars asked for macro knobs on a patch, in the spirit of the 303: a few
knobs whose whole travel stays inside a sound's sweet spots, each moving
several parameters at once. The motivating case is the 303's accent, which
is one gesture that bumps the amplitude, the filter and a decay together.
Today that gesture needs three lanes, each kept inside its own limits by
hand, and the result stops sounding like one instrument.

What the engine had:

- **One voice target table** (`worklet/fm/voiceTargetTables.ts`, 30 rows).
  Every source that moves a sounding voice addresses a row by its code: a
  song lane through one of the part's eight slot parameters, a step lane
  through the note-on's step array. The voice resolves both into
  `liveValues` each control block, and every DSP consumer reads from there.
  An offset of exactly 0 leaves the patch's value untouched.
- **A base per target.** The base every offset is reckoned over is the
  patch's own number, laid out by `layoutVoiceTargets`. A song lane's
  absolute value is turned into an offset against that base on the main
  thread (`synth/voiceAutomation.ts`).
- **Table-driven validation and pickers.** The song normaliser accepts any
  lane whose target the catalog holds; the step-lane normaliser accepts any
  `VoiceTargetPath`; the pickers list the catalog's rows by section.
- **Accent** is a per-note bump added to the mod wheel, so it reaches only
  what the wheel reaches: the two LFO depths and the filter envelope amount.
- The one-table record anticipated "a later source addresses the same
  codes". A macro is that source, and also a target.

## Decision

1. **A macro is a voice target row.** The table gains `MACROS_MAX` (8)
   rows, `macros.<i>.value`, appended after the pitch envelope's: `add`,
   0 to 1, floor 0, span 1 (a step sweeps the whole range), not
   `slideKeeps`. A macro's value is a real patch field, so the layout, the
   main thread's offset reckoning, both normalisers and both pickers accept
   a macro with no new path. A song lane on a macro takes one of the eight
   slots however many parameters the macro moves. A step lane on a macro
   pushes it for that note alone.
2. **Mappings live in the patch.** `Patch.macros` is a list of up to
   `MACROS_MAX` macros, each a `name`, a `value` (what the Parts tab's knob
   sets and a lane overrides live) and up to `MACRO_MAPPINGS_MAX` (8)
   mappings. A mapping is a `target` (a `VoiceTargetPath` that is not a
   macro row), `min` and `max` in the target's own units, a `curve` id and
   `inverted`. Defaults and bounds are `patchDefaults.ts`'s, so `makePatch`
   and the worklet's `normalisePatch` fill identically. The curve ids live
   in `modeIds.ts` beside the other patch enums.
3. **The macro's output is the mapped target's base.** This is the rule
   that keeps one modulation path. Today the base is the patch's number;
   for a mapped target it is the macro's live value, shaped by the mapping.
   The lane offset and the step push then apply over that base in the
   row's own curve, exactly as they apply over the patch's value. The two
   functions that lay out bases today (`bindOwnValues`, `bindLiveValues`)
   resolve in order: the macro rows themselves as ordinary rows (patch
   value, lane offset, step push); then each mapping writes the shaped
   macro value into its target's base; then every other row as today.
   Mappings are compiled where a patch is normalised, at the processor's
   construction (the part's first patch arrives in `processorOptions`, with
   no message) and on every `patch` message, into typed arrays (target
   code, macro code, min, max, curve, polarity, count) that belong to that
   normalised patch. A voice reads the tables of the patch it is bound to,
   so with live retune off a held voice keeps its note-on patch's mappings
   through a preset swap, as it keeps every other field of that patch, and
   a rebind takes the new patch's tables with the new patch. No new message
   type. A patch with no macros compiles to a count of 0 and the goldens do
   not move.
4. **Shapes.** Inverted is `1 − x` first. Then Linear `x`, Exp `x³`, Log
   `1 − (1 − x)³`, S `x²(3 − 2x)`: multiplications only, so no
   platform-dependent `Math.pow` (`v8-math-platform-drift`). The result
   interpolates `min..max` in the row's curve: geometrically on a `ratio`
   row (a cutoff mapping sweeps in octaves), linearly on an `add` row. On
   a `ratio` row an endpoint below the row's floor is raised to the floor
   before the interpolation, as a lane's ends are (`2026-10-02-one-voice-
   target-table` decision 2): a decay mapping whose `min` is the knob's 0
   sweeps from 1 ms, and at the macro's bottom plays 1 ms, not an instant
   decay. The compile step does the raising, so the render never sees a 0
   in a logarithm. Resonance is an `add` row drawn `log`, so its mapping
   sweeps linearly; accepted.
5. **One mapping per target, across all macros.** With the macro as the
   base, two macros on one target cannot both win. The normalisers keep the
   first and report the rest. A macro cannot map a macro row; the
   resolution stays a fixed two-phase pass with no graph. Summing in
   display space is left for later.
6. **A direct lane on a mapped target is kept, and inert.** The main
   thread reckons a lane's offset against the patch's value, which is no
   longer the base, so the lane's absolute-value promise would break. The
   pickers hide a mapped target, the lane stays in the document, and the
   resolver returns no handle while the mapping exists, as a Tape `wear`
   lane is inert while split. The voice enforces the same rule per bound
   patch: a target its own patch's tables mark as mapped reads the part's
   lane offset as 0. So a slot that still reaches a mapped target (the
   quantum between a patch message and its resync, or, with live retune
   off, a held voice on patch A whose cutoff is mapped after a swap to
   patch B whose cutoff lane is on) moves nothing on that voice. The
   reverse swap, a held voice on A with a cutoff lane while B maps the
   cutoff, releases the slot and the held voice plays A's own cutoff for the
   rest of its note: the lane goes inert mid-note, as it does when its
   target is removed. Step pushes are relative and stack as they always
   have, on mapped targets too.
7. **A lane on a macro the patch does not define is kept and silent**, as a
   vowel lane on a patch not in Formant is today. A patch swap keeps the
   lane (`2026-10-01-song-automation-lanes` decision 14).
8. **Slides.** A macro row is not `slideKeeps`. A macro mapped to a
   `slideKeeps` row (feedback, a decay curve) therefore moves it on a
   slide, which may click; accepted for version 1.
9. **The patch format is additive.** `macros` defaults to empty and an
   empty list reproduces today's behaviour, so `PATCH_FILE_FORMAT` stays 3
   (`2026-09-28-format-versions-refuse-never-destroy`). The loader's shape
   check gains a rule for a variable-length list of records, as it has one
   for `userPartials`, and refuses a mapping whose target is unknown or a
   macro row in a library file; the worklet's normaliser drops such a
   mapping, so a song's snapshot never reaches the audio thread malformed.
   A song carries its patches' macros in `patches`, so the self-contained
   rule holds by construction. A build before this change refuses a file
   that carries `macros`, as it refuses any unknown key.
10. **Names are the patch's.** The catalog row's label is a fallback
    (`Macro 1`); the pickers and lane titles read the macro's name from the
    part's patch, and offer a macro row only when the patch defines that
    macro, in a Macros group. `VoiceSection` gains a `macro` kind.
11. **Knobs.** A macro's knob is a knob over a voice target: its range from
    the catalog, its lane lock from the existing machinery. The knob of a
    mapped target is locked the same way, with a tag naming the macro,
    since turning it would do nothing audible. The Macros card is where
    macros and mappings are made: name, value knob, and per mapping a
    target picker that reuses the lane picker's grouping and excludes macro
    rows and targets already mapped, min and max knobs ranged by
    `knobRangeOf` on the target's row, a curve picker and an invert toggle.

## Consequences

- **The 303 accent is one macro:** carrier level, cutoff and a decay time
  under one name, pushed by a step lane or drawn as one song lane, and each
  parameter stays inside the range the mapping gives it.
- **The extension point is unchanged.** A new target is still a row in the
  table; a macro reaches it through `liveValues` with no further work. The
  decay reshape, the feedback ramp and the LFO rates already read there.
- **Codes grow from 30 to 38.** The note-on's step array and the per-block
  loops lengthen by eight; renders without macros, lanes or steps stay bit
  for bit.
- **Later sources.** With a macro as a row, the accent's per-note `mod` can
  become a step push on a chosen macro and the mod wheel a part-level
  offset on one, which is the real 303 accent switch. Neither is in this
  epic.
- **Not done:** expanding a macro on the main thread into one handle per
  mapping. It would spend slots, force the step lanes' relative model to
  express absolute ranges, and put the shaping arithmetic on both threads.
