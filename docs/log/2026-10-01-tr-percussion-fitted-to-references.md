# The TR toms, rim shot, claves and cowbell are fitted to recordings

- **Date:** 2026-10-01
- **Status:** proposed (awaiting tacowars's listen in the PR preview)
- **Amends:** the tom, rim shot, claves and cowbell paragraphs of
  `docs/design/drum-bank.md`
- **Follows:** `2026-09-30-drum-kicks-fitted-to-recordings`,
  `2026-10-01-sound-match-toolkit`

## Context

After the kicks, the bank's tonal percussion was still built from circuit
write-ups and never compared with the machines. tacowars picked reference
hits from Samples From Mars *808 From Mars* and *TR-909 From Mars* (a
commercial pack, kept outside the repository) for the 808 low, mid and high
toms, rim shot, claves and cowbell and the 909 mid tom. Against them the old
patches scored 5.3–7.3 on the sound-match toolkit's total, with pitch 8–18
semitones off by its reading; the 909 set had no mid tom at all
(windsor#302, `docs/research/2026-10-01-tr-percussion-fit/README.md`).

## Decisions

1. **Seven patches are fitted to tacowars's references with the sound-match
   toolkit** (`scripts/sound-match/`). `tr808-tom-low`, `tr808-tom-mid`,
   `tr808-tom-high`, `tr808-rimshot`, `tr808-clave` and `tr808-cowbell`
   are refitted, and `tr909-tom-mid` is new. Each is one hit on C4 at
   velocity 1, scored at the toolkit's default weights. The structure of
   each patch (algorithm, waves, the job of each operator, phase lock) is
   chosen by hand, and CMA-ES with a fixed seed moves only the numbers each
   spec names. The pack is not committed; the specs, start patches, scores
   and overlays are in the research folder. The 808 low and high toms start
   from the mid tom's fit and move only pitch, decay and level.
2. **The 909 tom's two tones are fixed at their measured frequencies.** The
   recording is two inharmonic tones that beat (92.7 and 56.9 Hz once
   settled), and the toolkit's pitch and harmonic readings follow the beat,
   not either tone. A free fit moved both ratios off the recording to chase
   that beat. The shipped fit holds the ratios at the measured tones and
   zeroes the `pitch` and `harm` weights.
3. **The 909 low and high toms are derived, not fitted.** No reference was
   picked for them. They are the fitted mid tom a fourth below and above,
   the spacing the old set used, with decay and release scaled by the old
   set's decay ratio.
4. **Peaks are held within 0.1 dB of the old patches.** Each patch's
   `volume` (the cowbell's two carrier levels, to keep `volume` inside its
   knob) is set so the peak at velocity 1 matches the patch it replaces,
   and the new 909 mid tom sits level with its siblings. A fit is then
   refined at that level, because the drive makes the sound depend on it.
   A kit's balance in a saved arrangement therefore does not move.
5. **Struck tonal operators are phase-locked.** `phaseFree: false` on the
   tonal operators of the toms, rim shot and claves, which start the same
   way every hit on the machines. The cowbell's oscillators stay free, as
   they run continuously on the 808.
6. **No engine change.** The limits met (the 0.5 ms segment and 32-sample
   amplitude step that bound the fastest edge, windsor#301; no asymmetric
   shaper, and level and saturation as one control, windsor#300; one filter
   for tones and noise) are recorded in the research note, not addressed.

## Consequences

- The nine patch files (the seven fitted plus `tr909-tom-low` and
  `tr909-tom-high`), `patches/index.ts` and the golden table
  (`fmGolden.json`, refreshed under Node 24) change. The goldens change
  for exactly these nine patches; every other patch renders the same bits.
  The new sounds become the baseline only on tacowars's listen.
- The files were fitted on patch format 2 and brought to format 3 by the
  format's own upgrade (the filter's drive moved to `patch.drive`). Their
  renders are bit-identical before and after the upgrade (fixed seed, notes
  48, 60 and 72, two velocities), so the fitted sound is what ships.
- Existing ids keep their meaning. A saved song embeds its own snapshot, so
  no saved song changes until it is re-exported.
- The remaining differences, per sound, are in the research note: the
  toms' and claves' first milliseconds above 2 kHz, the rim shot's and 909
  tom's lopsided cycles, and the 909 tom's noise colour.
