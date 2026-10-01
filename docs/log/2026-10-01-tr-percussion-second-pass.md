# The TR toms' second pass: struck edges, faint harmonics, FM-coloured noise

- **Date:** 2026-10-01
- **Status:** proposed (awaiting tacowars's listen in the PR preview)
- **Follows:** `2026-10-01-tr-percussion-fitted-to-references`,
  `2026-10-01-voice-drive-stage`, `2026-10-01-envelope-edges-at-sample-rate`
- **Links:** windsor#318 · measurements in
  `docs/research/2026-10-01-tr-percussion-fit/README.md` ("Second pass") and
  `docs/research/2026-10-01-tom-noise-colour-prototype/`

## Context

tacowars listened to the first pass (windsor#302): the 808 cowbell good
enough but missing a little attack and complexity, the 808 toms missing a
wooden timbre, the 909 tom furthest off in its noise, pitch envelope and
timbre. Since then the voice gained its own drive stage with bias
(windsor#300) and envelope edges at their own samples (windsor#301), and
tacowars put engine changes on the table for TR sound work.

## Decisions

1. **A second pass polishes from the shipped patches and ships only a
   candidate that is at or below the shipped one in every score
   component.** Each sound starts from its shipped patch with a structural
   change made by hand, then Nelder–Mead steps one control at a time; from
   the fit's log the lowest total meeting the rule is taken. CMA-ES found
   nothing better than its start here: the shipped patches sit in narrow
   optima.
2. **The 808 toms strike from their first sample.** The recordings reach
   their crest in 0.25–0.3 ms; the body's attack is now 0, which windsor#301
   made a step. That is the measured "wood": the first 5 ms above 2 kHz
   rises from 8–11 dB low to within about 3 dB, and the mid tom's click from
   −17.4 to −10.9 dB re peak against the recording's −10.5.
3. **The 808 toms' body is a sine with the recording's faint odd
   harmonics**, a User wave (H3 about −44 dB, H5 −53, H7 −66), not a
   triangle: the recording's H3 is −42 dB, a triangle's −19. No noise is
   added to the body; the recordings carry none above 2 kHz after 5 ms. The
   low and high toms take the same change on their own patches and their own
   polish.
4. **The 909 tom's noise is FM-coloured.** Algorithm 6: the two tones on A
   and B, C a sine fixed at 4.8 kHz spread into a band by D, a Noise
   operator. Measured against the shared filter with its envelope and the
   drive's tone pole, and against a prototype per-operator noise filter, it
   is the only one of the three that brings the 2–6 kHz band within 0.3 dB
   of the recording at 0–5 and 30–150 ms. The prototype stays in research;
   its proposed engine ticket is recommended not to be scheduled.
5. **The 909 tom's glide stays the first pass's.** Read from spectral peaks
   at 10, 30, 100 and 300 ms it is +0.7, −3.3, +0.3 and −0.2 semitones off,
   before and after; the 30 ms reading is the two tones' beat and the upper
   tone's second harmonic as much as pitch, and a glide shaped to it made
   every other reading worse.
6. **A drive bias of +0.05 on the 909 tom** turns its cycles the
   recording's way (negative half 1.05 of the positive against 1.08). The
   scores alone would pick −0.1, which turns them the other way.
7. **The 808 cowbell is unchanged.** No candidate beat it in every component
   by a margin worth a change; what is missing (its lower oscillator's upper
   harmonics, intermodulation) is measured in the research note for a later
   pass.
8. **The first pass's specs and start patches read `drive.gain`.** They were
   written for `filter.drive`, which format 3 no longer reads; the start
   patches move it as the format's own upgrade does.
9. **Peaks within 0.25 dB of the shipped patches** (decision 6 of the
   ticket allowed 1 dB), by `volume`.
10. **The 909 high tom's pitch release curve is +0.29, set by ear.** At
    the fit's −0.46 the falling pitch sounded like a change of note at
    tacowars's listen; +0.29 sounded right. The low and mid toms keep their
    fitted curves.

## Consequences

- Six patch files (`tr808-tom-low`, `-mid`, `-high`, `tr909-tom-low`,
  `-mid`, `-high`) and their golden entries change; `patches/index.ts` is
  regenerated (unchanged: it lists the same files). Every other patch
  renders the same bits.
- No format change: `userPartials`, a fixed operator and the drive's bias
  are existing fields.
- A saved song embeds its own snapshot, so no song changes until it is
  re-exported. The new sounds become the baseline only on tacowars's listen.
