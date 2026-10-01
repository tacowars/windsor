# The 808 kicks refitted to tacowars's references

- **Date:** 2026-10-01
- **Status:** accepted (windsor#324); the listening verdict is tacowars's
- **Refines:** the 808 rows of `docs/research/2026-09-30-kick-fit/` (the
  first fit, to Decay B, C and E at Tone 03)
- **Links:** `docs/research/2026-10-01-tr808-kick-refit/` ·
  `docs/design/drum-bank.md` · `2026-10-01-envelope-edges-at-sample-rate`
  (windsor#301) · `2026-10-01-voice-drive-stage` (windsor#300) ·
  `2026-10-01-sound-match-toolkit` · `2026-10-01-kicks-tuned-to-c4`

## Context

tacowars calls the 808's opening transient essential to the classic sound.
The first fit reached about a sixth of the recording's click: an operator
envelope could not move faster than a 32-sample block. Since then an
envelope segment ends on its own sample (an attack of 0 is a step), the
voice has a drive independent of the filter with five shapes and a bias,
and the sound-match toolkit replaced the kick-fit scripts. tacowars chose
three recordings from *808 From Mars* and wrote what each is for
(`tr-refs.txt` beside them, outside the repository).

## Decision

1. **Targets.** `tr808-kick-short` is fitted to `BD A 808 Decay A 03`,
   `tr808-kick` to `BD A 808 Decay C 06` and `tr808-kick-long` to
   `BD A 808 Decay D 04`, on C4 at velocity 1 with no gate. Each
   description names its recording.
2. **The click is chosen per kick, on the numbers.** Each candidate was
   fitted on a common body with only the onset free, and kept by the
   toolkit's waveform score and the 0–5 ms level above 2 kHz:
   - `tr808-kick` (Tone 06): the body sine starts mid-swing with an attack
     of 0, so the hit opens on a step, and a `Square D` at 1 Hz (a DC level)
     held flat for 1.9 ms by Init 1 adds the trigger pulse. 0–5 ms above
     2 kHz moved from −18.9 to −0.9 dB of the recording.
   - `tr808-kick-short` (Tone 03): a zero-attack `Square D` edge with a
     0.1 ms decay, on a body starting near its crest; the candidates were
     within 0.0009 of each other on this mild click.
   - `tr808-kick-long` (Tone 04): no click operator. The width squeeze won
     the comparison but fitted itself silent, so the body's own onset (a
     1 ms attack on a steep curve) is the click, and C sits at level 0.
   tacowars's width squeeze works as a one-sided pulse; on these
   recordings it was not the closest.
3. **The click comes first in the last fit.** The final stage freezes the
   click operator, the body's start phase and attack and the drive tone
   at their comparison values and fits the rest with the waveform score
   weighted 6. A fit with everything free gave the click away for the
   body (0–5 ms above 2 kHz back to −19 dB on `tr808-kick`).
4. **Drive on, filter Off.** Every kick runs the voice drive (`drive.on`)
   near unity gain with a small positive bias, which gives the body its
   second harmonic and lopsided cycles; the filter is Off (a lowpass did
   not improve the 808 Kick's fit). `tr808-kick` uses the Diode shape,
   closer than Soft on both click numbers and in total; the short and long
   kicks keep Soft, where Diode was further on the click. Diode costs
   about five times a bypassed voice render, on one mono voice.
5. **Body pitch per recording.** The three recordings settle at different
   pitches (about 49.6, 51.2 and 52.3 Hz over 40–150 ms on the toolkit's
   track), as the machine's pitch sags faster at a short Decay. Each body
   ratio follows its recording (0.1876, 0.193888 and 0.194085), with the
   pitch envelope's release carrying the sag, instead of the common
   0.198425 of `2026-10-01-kicks-tuned-to-c4`; on C4 each body is within
   0.1 semitones of its recording. Body and knock keep one ratio.
6. **Level.** Each kick's peak at velocity 1 on C4 stays within 1 dB of
   its peak on `main` (+0.29 to +0.69 dB). `volume` and `drive.gain` meet
   only as a product before the shaper, so level matching also set how
   hard each kick is driven.
7. **Every fitted value sits inside its editor knob** (fix round 1), so a
   first touch never clamps it and changes the sound:
   - the envelope Attack and Decay knobs reach exact 0 at the bottom of
     their sweep (`logFloor` in `knob.ts`; the log sweep above it starts
     at the old minima, 0.5 ms and 1 ms), since an envelope stage of 0
     is a sound;
   - the Fixed knob reaches down to 1 Hz, on its log curve, for a held
     sub-audio operator like the 808 Kick's pulse;
   - the Volume knob keeps its 1.5 maximum: the 808 Kick and the long
     kick carry `volume` 1.5 and the rest of the product in `drive.gain`
     (1.19753865 and 1.1581264226666665), which renders bit for bit as
     the fitted volumes did.
   `libraryKnobRanges.test.ts` walks the whole library against the knobs.
8. **No format bump.** A library edit with known fields (`drive.on`,
   `width`); a song keeps its own patch snapshots until it is re-exported.

## Consequences

Every score of each kick, total and per component, is better than the
patch it replaces against these recordings (the research README has the
tables). The goldens of exactly these three patches are refreshed.
Remaining: the trigger pulse's sharp end at 1 ms is not reproduced (a
sharp end measured worse on the fitted body), the first cycle is the
loudest where the recordings peak in the body at 16 ms, and the body's
H3 is about 8 dB high. A song that plays the old kicks keeps them in its
own snapshot. Whether the click now sounds right is tacowars's verdict,
in the console and the PR preview.
