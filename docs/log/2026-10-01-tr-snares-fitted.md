# The 808 and 909 snares are fitted to recordings

- **Date:** 2026-10-01
- **Status:** proposed (awaiting tacowars's listen in the PR preview)
- **Amends:** the 808 and 909 snare rows and the coloured-noise paragraph of
  `docs/design/drum-bank.md`
- **Follows:** `2026-10-01-sound-match-toolkit`,
  `2026-10-01-tr-percussion-fitted-to-references`
- **Links:** windsor#353 · measurements in
  `docs/research/2026-10-01-tr-snare-fit/README.md`

## Context

Wave 3 of the TR fitting. tacowars picked `SD A 808 Tone C 06` ("808 snare
with lots of snappy, medium tone") and `SD 909 Clean D 06` ("medium 909
snare, fair amount of snappy") from Samples From Mars *808 From Mars* and
*TR-909 From Mars*, a commercial pack kept outside the repository. The old
snares were built from circuit write-ups: both played tones at 180 and
330 Hz on C4 (1:1.83), and scored 4.04 and 3.33 on the toolkit's total.
The recordings measure 175 and 345 Hz (1:1.97) on the 808 and 181 and
290 Hz (1:1.60) on the 909, with the 909's tones falling about 6 semitones
over the first 10 ms.

## Decisions

1. **Both snares are refitted to their references** with the sound-match
   toolkit, the transient weighted (a second reference of the recording's
   first 10 ms at half weight, `wave` at 4). Totals 4.038 → 1.621 (808) and
   3.327 → 1.623 (909); every component improves, on the whole hit and on
   the first 10 ms alone (3.118 → 2.276 and 2.985 → 2.229). Each patch's
   description names its reference.
2. **The tones play the measured partials**: two phase-locked sines, the
   808's at 175 and 345 Hz with their own decays, the 909's at 179 and
   287 Hz sharing one decay and the global pitch envelope (11.5 semitones
   at the hit, 1.6 by 8 ms, then a 123 ms release to the settled pitch).
   The 909's tones are sines, not rounded triangles: the recording's lower
   tone has no measurable third harmonic.
3. **The snappy is white noise through the shared filter, not FM-coloured
   noise.** Against the measured band the two tie within a dB; FM colour
   (a sine spread by a Noise operator, which draws a fresh white sample
   every sample) is the sine's line plus a white floor, never a band, and
   its line sits 7–15 dB above anything narrow in either recording. FM
   scores better on the toolkit's totals (1.514 and 1.536) only through
   that line filling its 2–6 kHz band reading, and it spends an operator.
   This goes against the totals; the FM fits are kept in the research
   folder so tacowars can hear the alternative.
4. **The 808's 130 Hz highpass goes.** The recording's snappy is highpassed
   near 1.8 kHz, which the shared filter cannot do without taking the
   tones; the fits put the cutoff at the bottom of its range, and the old
   130 Hz scores worse in every component. The shipped highpass sits at
   32 Hz (58 Hz on the 909), near-transparent but measurably better than
   off.
5. **The drive stays off** on both; the snares keep only the filter.
6. **Peaks match `main`** within 0.01 dB (−8.03 and −7.75 dBFS); the 909
   reaches it with `volume` 1.25 and its carrier levels scaled together.
7. **Per-operator noise colour is proposed as an engine ticket**, with the
   snares as its case. windsor#327's prototype (one-pole `noiseLp` / `noiseHp` on a
   Noise operator), reused unchanged, takes the 808's total from 1.621 to
   1.241 and its first 10 ms from 2.276 to 1.708, and the 909's from 1.623
   to 1.383. Not shipped here. windsor#327's own reading of the prototype ("gained
   nothing" on the 909 tom) was very likely the shipped bundle measured
   twice: its mirror links the toolkit's Python files, and a linked
   `fit.py` imports the repository's renderer.

## Consequences

- Two patch files (`tr808-snare`, `tr909-snare`) and their golden entries
  change; `patches/index.ts` is regenerated and unchanged. Every other patch
  renders the same bits.
- No format change: every field is an existing one.
- A saved song embeds its own snapshot, so no song changes until it is
  re-exported. The new sounds become the baseline only on tacowars's listen.
- What remains, measured, is in the research note: the 808's snappy band
  (too loud below 2 kHz and above 9 kHz), the 909's tone onset (1.5 ms late
  in the recording) and its early pitch (0.3–0.6 semitones sharp over
  12–48 ms).
