# An operator's own filters on every wave

- **Date:** 2026-10-04
- **Status:** accepted (the decisions of windsor#590)
- **Refines:** `2026-10-02-operator-noise-colour`, which gave a Noise
  operator alone its lowpass and highpass. That record stands as history.
- **Links:** windsor#590 · its cost in
  `docs/research/2026-10-04-operator-filters-on-every-wave/README.md` ·
  windsor#362 and its cost in
  `docs/research/2026-10-02-operator-noise-colour/README.md`

## Context

windsor#362 gave a Noise operator its own two-pole lowpass and highpass,
`noiseLp` and `noiseHp`, and held every other wave out of them. The same
two sections are what an 808 cowbell, cymbal or hat needs on its Square and
Pulse operators (each band its own), and a Saw through its own lowpass is a
per-oscillator tone control that leaves the voice filter free. A tone
control on a pitched operator wants to follow the note the way the voice
filter's `keyTrack` follows it, or a low note sounds bright and a high one
dull.

## Decision

1. **Fields.** Every operator carries `opLp` and `opHp` (Hz, 0 off, clamped
   0–20 kHz, `OP_FILTER_RANGE`) and `opTrack` (0 by default, clamped to the
   voice filter's Key Trk range, −1 to 2, `OP_FILTER_TRACK_RANGE`).
   `noiseLp` and `noiseHp` are retired. The module is
   `worklet/fm/operatorFilter.ts` (`OperatorFilter`, `bindOperatorFilter`),
   the constants `OP_FILTER_*`, and the engine index exports
   `OP_FILTER_FLOOR_HZ`, `OP_FILTER_RANGE` and `OP_FILTER_TRACK_RANGE`.
2. **Every wave.** The fields are heard on Sine, Table, Saw, Square, Pulse
   and Noise alike, squeezed (width) or not. Both render loops filter after
   the wave read; the kernel and the generic loop stay bit-identical, which
   `synth/fmProcessorOperatorFilter.test.ts` checks on every wave, plain and
   squeezed, carrier and modulator. An operator whose filter is on is never
   skipped by the kernel, as a Noise operator never is: the generic loop
   runs the filter's state on at any amplitude, so a silent filtered
   operator raised later would otherwise come back from a different state.
3. **Feedback reads the raw wave.** The feedback taps (`fb1`/`fb2`, the
   kernel's `f1X`/`f2X`) take the wave before the filter; `out`, which
   reaches the modulated operators and the carrier mix, takes it after. A
   saw with feedback, tacowars's rounded analog saw, sounds the same with
   its filter on; only what it sends on is filtered. A test holds the
   feedback history to the same bits with a lowpass on and off. A Noise
   operator never reads its feedback, so no Noise patch changes.
4. **Key tracking.** Each section's cutoff is
   `field × 2^(opTrack × (note − 60) / 12)`, the voice filter's formula,
   then held to the 20 Hz floor and the 0.45 fs ceiling. It follows the
   played note, not the operator's frequency, so a Fixed operator tracks
   too and 0 is the setting for a fixed band. The power is
   `portablePowers.ts`'s `exp2InPlace`, so a tracked cutoff is the same
   bits on arm64 and x64, as the prewarp's tangent already was; its
   exponent is held to ±32 octaves, which moves no held cutoff and keeps
   the power inside its table. The tuning runs where it ran: when the voice
   binds a patch (a note-on, a live edit's rebind) and at a slide's
   `retarget`, which rebinds with the new note; a section retunes only when
   its effective cutoff changes. Tracking adds no per-sample or per-block
   work (measured: a tracked section costs what an untracked one does; see
   Cost).
5. **Off is bit-identical.** With `opLp` and `opHp` at 0 no section runs,
   whatever `opTrack` says, and the FM goldens (`fmProcessorGolden`) did not
   move. What off still costs is under Cost.
6. **Format.** `PATCH_FILE_FORMAT` 3 → 4, with `PATCH_MIGRATIONS[3]`
   renaming `noiseLp`/`noiseHp` to `opLp`/`opHp` on every operator, key
   order kept; `opTrack` is left to the normaliser's 0. The upgrade keeps a
   Noise operator's values and writes 0 on any other wave (the wave as the
   normaliser reads it, Sine when absent), because format 3 heard the
   fields on Noise alone and the old editor kept them hidden on an operator
   switched away from Noise, so the patch sounds as it did.
   `ARRANGEMENT_VERSION` 6 → 7, with `SONG_MIGRATIONS[6]` running that step
   over the snapshot's patches. Every library file was rewritten at format 4
   by script, and the diff of the files is the format line and the key
   renames alone.
7. **Editor.** Every operator row shows LP, HP (the zero-end log knobs the
   Noise pair used, Off at the bottom) and Key Trk (the voice filter's
   signed format) after Vel, on every wave, so the Noise-only show and hide
   and the `op-noise` row class are gone. The main knob group is ten
   columns on every row, so the columns line up across A–D; the rows close
   their gaps below 920 px of their own width (the full gaps need 912 px,
   the closed ones 876).

## Cost

The measurements, the machine (an Apple M1, Node 24.21.0, the FM worklet
bundle under Node, not a browser) and the method are in
`docs/research/2026-10-04-operator-filters-on-every-wave/README.md`. In
short: one section on a lone Saw carrier costs about 11 ns a sample
(+11.25 ns against a 20.5 ns voice), a lowpass and highpass together about
15 (+14.96 ns), and tracking nothing a sample. In the kernel a section
costs about 2 ns on a Noise operator, about 3 ns on operator D and 9.5 to
12 ns on A, B or C, so the kernel writes the section out rather than
calling it. Off costs less than a nanosecond a sample (+0.76 ns on the Saw
carrier, +1.16 ns on `tr909-tom-mid`), and that is the kernel's code, not
its work.

## Consequences

- A patch or a song saved at format 3 or version 6 loads with its Noise
  operators' cutoffs in the new fields and plays as before; one saved by
  this build is refused by an older one, as the format record says.
- The editor offers the filters on every operator. A user who turns one on
  pays the section's cost above for that voice while it sounds.
- The off path's last nanosecond and the kernel's dearer A–C sections are
  open: a shorter recurrence (the ×2 folded into the coefficients, exact
  but for subnormals, saves a multiply on each state) or a different
  placement may win some back, and needs its own bench.
