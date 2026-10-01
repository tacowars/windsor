# Kicks tuned to C4

- **Date:** 2026-10-01
- **Status:** accepted (windsor#280)
- **Supersedes:** `2026-09-18-drum-bank-ratio-floor-and-two-noise-algorithms`
  decision 1 (kick bodies at ratio 0.25). Its decision 2 stands.
- **Links:** `docs/design/drum-bank.md` · `docs/research/2026-09-30-kick-fit/`
  · `2026-09-18-618-console-ratio-floor-and-the-tools-lint-fence` (#618)

## Context

The 808 and 909 kicks and the EFM Kick kept their bodies at ratio 0.25,
which plays 65 Hz on C4. The machines sit at 52 Hz, which those patches
reached only on G#3. C4 is the percussion note and the sequencer's default,
so a kick dropped into a part played about four semitones high. tacowars
heard the 808 Kick as tuned high in a song on C4 and fixed it by ear with
Fine (ratio 0.199).

The 2026-09-18 record chose 0.25 because the console's Coarse / Fine pair
then floored the stored ratio at `RATIO_MIN` 0.25, so a 52 Hz body on C4
(ratio 0.199) could not round-trip through the knobs. #618 lowered
`RATIO_MIN` to 0.0625 (`packages/app/src/ratioSplit.ts`). That reason is
gone.

## Decision

1. **Kick bodies sit at the ratio that plays the machine's pitch on C4.**
   In `tr808-kick-short`, `tr808-kick`, `tr808-kick-long`,
   `tr909-kick-short`, `tr909-kick`, `tr909-kick-long`, `tr909-kick-hard`
   and `efm-kick`, every operator ratio that is not `fixed` is multiplied
   by 2^(−4/12) = 0.793701, stored to 6 significant figures (0.25 →
   0.198425, 0.5 → 0.39685, 1 → 0.793701). Body and FM knock move together,
   so every ratio relationship inside a patch is unchanged. `fixed`
   operators (the `Square D` edges) and pitch-envelope amounts (in
   semitones) are untouched.
2. **A C4 render is the old G#3 render.** None of the eight patches has a
   non-zero `keyScale`, `levelKeyScale` or filter `keyTrack`, so only the
   note's pitch changes with it. Rendered with the kick-fit `renderHit`
   (48 kHz, velocity 1, 1 s), each patch on C4 differs from its old self on
   G#3 by at most 2.2e-5 (sample peak about 0.6), the rounding of the
   ratios to 6 figures.
3. **Descriptions name C4**, and the kick-fit scripts render on C4 (MIDI
   60) by default, so a re-fit matches the shipped tuning.
4. **The FM Kick (`kick`, ratio 1) is out of scope.** It is not a machine
   voice.
5. **No format bump.** It is a library edit; a song carries its own patch
   snapshots, so no saved song changes until it is re-exported.

## Consequences

A song that played a machine kick on G#3 to get 52 Hz now gets about
41 Hz from a freshly loaded library patch; its own saved snapshot keeps the
old tuning. The goldens for these eight patches are refreshed in the same
change.
