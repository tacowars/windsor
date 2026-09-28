# Operator width, a PULSE wave and a second LFO

- **Date:** 2026-09-28
- **Status:** accepted (Pat, 2026-09-28, epic windsor#53 "Design")
- **Tickets:** windsor#54 (this schema seam), windsor#55 (the DSP),
  windsor#56 (the console), windsor#57 (the patches)
- **Closes, when the epic lands:** Aotearoa204 #692 (PWM) and engine
  request 3 of `docs/research/2026-09-24-classic-string-machine-patches.md`
  (a second LFO)

## Context

Windsor's operators play a fixed wave at a fixed shape. There is no pulse
width, so the Juno string and brass patches the string-machine research asked
for can't have their PWM shimmer, and there is one LFO, so a patch can't
sweep one thing slowly while vibrato runs at its own rate. The Korg opsix
shows a way to get both in an FM engine: give every operator a **width** that
squeezes its wave into part of the period. Width is useful on every wave, and
on a pulse it is the duty.

This record fixes the design and the semantics before any DSP or UI reads
them, so the DSP ticket and the console ticket can run side by side against
one schema.

## Decisions

1. **The schema.** Every field is additive, and its default reproduces
   today's sound.
   - `Operator.width`, default `1`, clamped by the worklet to
     `WIDTH_RANGE = { min: 0.05, max: 1 }` (`patchDefaults.ts`, exported
     through the engine index).
   - `WAVE.PULSE = 10`, and `WAVE_NAMES[10] = 'Pulse'`.
   - `LfoSettings` gains `oneShot` (default `false`), `unipolar` (default
     `false`) and `toWidth`, one depth per operator, default `0`
     (`LFO_TO_WIDTH_DEFAULT`, the sibling of `LFO_TO_OP_DEFAULT`).
   - `Patch.lfo2: LfoSettings`, filled from
     `LFO2_DEFAULTS = { ...LFO_DEFAULTS, modWheelDepth: 0 }`. A fresh LFO 2 has
     no depth anywhere and does not follow the wheel, so it is inert.
   - `FilterSettings.lfo2Amount`, octaves, default `0`.

   `makePatch` and the worklet's `normalisePatch` fill all of it from the one
   defaults table, and `patchDefaults.test.ts` pins the two fills equal.
2. **Width is phase compression, not a table per width.** The operator's read
   phase runs at `1 / width` until it finishes one cycle, then holds at zero
   for the rest of the period. It applies after the FM phase sum and before
   the table read, on every operator, modulators included.
   - Width 1 is the plain wave and takes the old code path bit for bit, so
     the goldens don't move.
   - Every table is a sum of sines and is zero at phase zero, so the hold is
     continuous for sine, triangle and User waves. Saw and square keep a
     corner that aliases the way `SAW_D` and `SQUARE_D` already do.
   - The operator picks its mip table from `freq / width`, so the squeezed
     segment stays under Nyquist.
3. **PULSE is the difference of two saws.** It is the saw table read at the
   phase, minus the same table read at the phase plus the duty. For PULSE the
   operator's `width` is that duty rather than a compression, and 0.5 is a
   square.
4. **LFO 2 is a second instance of the LFO**, symmetric with the first, and
   seeded from LFO 1's seed with no new draw from the part's random stream.
   Both LFOs gain `oneShot`, `unipolar` and `toWidth`.
5. **The semantics**, binding on windsor#55 and windsor#56:
   - **Effective width.** Per operator `i`, per sample:
     `clamp(op.width + lfo1 × lfo.toWidth[i] + lfo2 × lfo2.toWidth[i], WIDTH_RANGE)`,
     where `lfo1` and `lfo2` are each LFO's output value.
   - **Width's meaning.** Phase compression for every wave except PULSE and
     noise; a noise operator has no phase to squeeze and ignores width. On
     PULSE it is the duty.
   - **One-shot** runs the LFO's phase once and holds its end value. It
     implies a reset at note-on, whatever `retrigger` says, so a one-shot LFO
     can serve as a rough extra envelope.
   - **Unipolar** remaps the LFO's value to `(v + 1) / 2`: after the shape
     and before the delay's fade-in. The fade-in therefore scales a 0..1
     value up from 0.
6. **No format bump and no migration.** Every field is additive, with a
   default that reproduces the old behaviour
   (`2026-09-28-format-versions-refuse-never-destroy`). Since
   `2026-09-28-retire-the-headroom-record`, the patch loader fills a field a
   file omits, so the shipped bank is not rewritten. The patch files and
   every song snapshot load as before, with the new fields at their defaults.

## Why

- **Phase compression over a table per width.** Width is continuous and an
  LFO moves it every sample. A table per width would mean a mip set per width
  value, built somewhere other than the audio loop (the worklets allocate
  nothing per block). It would also cover only the waves someone built tables
  for. Compressing the phase costs a multiply and a compare. It works on
  every wave, the User spectra included, and leaves width 1 on the old path.
- **PULSE as two saws.** A difference of two band-limited saws is a
  band-limited pulse, read from mips that already exist. Its mean is zero at
  any duty. A naive pulse's DC offset moves with the duty, so PWM would pump
  the output and the filter. With two saws, no new table is built and the
  duty can move every sample.
- **LFO 2 symmetric.** One LFO class, one settings shape and one normaliser
  path serve both LFOs. The console can then draw the second panel from the
  first's layout, and a patch author learns one set of controls. Seeding LFO 2
  from LFO 1's seed, instead of drawing again, keeps the part's random stream
  where it was. A new draw would shift every later draw (the next voice's
  S&H, drift and free-running phases), so a patch that never touches LFO 2
  would render differently. That is exactly what the goldens forbid.
- **LFO 2 deaf to the wheel by default.** LFO 1 follows the wheel by
  default (`modWheelDepth` 1). If LFO 2 did too, the wheel would drive two
  LFOs as soon as an author gave LFO 2 a depth, which nobody asked for. The
  wheel can still be routed to LFO 2 by setting its depth.

## Consequences

- Until windsor#55 lands, a PULSE operator renders through the default table
  branch, as a sine. No shipped patch uses PULSE before windsor#57.
- A PULSE operator at the default width 1 has a duty of 100 %. The two saws
  cancel, so it is silent. The duty that sounds is below 1, and 0.5 is the
  square. Whether the console sets a starting duty when the picker switches
  an operator to PULSE is windsor#56's call.
- The console's wave picker lists "Pulse" from `WAVE_NAMES` as soon as this
  seam merges.

## Punted / alternatives

- **A width per table** (precomputed squeezed waves): rejected above.
- **A pulse table with its own mips**, or a naive pulse: rejected above.
- **A second, independent LFO design** (different shapes or a free-running
  clock): rejected. Symmetry is the point, and a later need can extend both
  LFOs at once.
