# The 808 hats fitted to tacowars's references

- **Date:** 2026-10-01
- **Status:** accepted as the FM hats (windsor#354). At the listen
  (2026-10-02) tacowars heard the fitted hats as too tonal for the 808:
  "I can hear the note", where the reference is "a staccato burst of
  noise", and the open hat "sounds like a ringing bell more than the long
  white burst of the reference". tacowars liked them as original sounds,
  so the fit ships as two new patches, `fm-hat-closed` (FM Closed Hat) and
  `fm-hat-open` (FM Open Hat), and `tr808-hat-closed` / `tr808-hat-open`
  keep their earlier patches unchanged. Where this record says "the 808
  hats" below, it describes the fit, now the FM hats.
- **Amends:** `docs/design/drum-bank.md` (the 808 hats' measured row and
  the metal point)
- **Links:** `docs/research/2026-10-01-tr808-hat-fit/` ·
  `2026-10-01-sound-match-toolkit` · `2026-10-01-voice-drive-stage`
  (windsor#300) · `2026-10-01-envelope-edges-at-sample-rate` (windsor#301)

## Context

The 808 hats summed four of the bank's six nominal frequencies (205.3,
369.6, 522.7 and 800 Hz) as unbandlimited squares through a resonant
highpass, built from circuit write-ups and never compared with the
machine. tacowars picked `CH A 808` and `OH 808 Decay 05` from Samples
From Mars *808 From Mars* (a commercial pack, kept outside the
repository). Against them the old patches scored 2.40 and 4.92 on the
toolkit's total, reproduced 1 of the open hat's 30 strongest lines, and
left the spectrum between lines 31 dB down where the recordings sit
19–20 dB down.

Measured before fitting: four harmonic series, at 819.55, 541.2, 903.4
and 636.35 Hz, carry 75 % of the open hat's line energy, and the closed
hat's lines sit on the same frequencies. The 800 and 540 Hz oscillators
show as series of their own; 304.4 and 205.3 Hz show only as every third
harmonic of 301.1 and 212.1 Hz. The closed hat opens on its loudest
sample, 7 dB above its body.

## Decision

1. **Targets.** `tr808-hat-closed` is fitted to `CH A 808` and
   `tr808-hat-open` to `OH 808 Decay 05`, on C4 at velocity 1 with no
   gate, scored over seeds 1–4 at the toolkit's default weights. Each
   description names its recording. The 909 hats are unchanged.
2. **The metal is four Pulse operators at the measured series**, not at
   the write-ups' frequencies: 819.55, 541.2, 903.4 and 636.35 Hz, fixed,
   free-running, algorithm 7. Each series has every harmonic, so they are
   pulses with fitted duties, not squares. The open hat's render now
   carries 17 of its recording's 30 strongest lines. Four operators reach
   the four series heard; the oscillator count is not the limit.
3. **The voice drive makes the fill between the lines.** Soft, gain 7.8:
   the pulses clip together and intermodulate, as the circuit's mix does.
   It is the largest single gain in the fit (the open hat scores 3.455
   with it off, 2.087 with it on, in stage a). FM pairs (algorithm 4)
   scored the same but kept 6 of the 30 lines; a sine carrier modulated by
   the three pulses scored worse. Tube fitted 0.05 better and costs twice
   the render, so Soft ships.
4. **A 24 dB highpass, and the drive's tone pole as the level control.**
   A 12 dB slope lets the drive's difference tones through. With the drive
   saturating, the tone pole is the only control after the shaper, so it
   is set where each peak lands within 1 dB of `main` (closed −11.35 →
   −10.97 dBFS, open −10.21 → −10.42), and the rest is refitted around it.
5. **The closed hat's opening comes first.** Left free, the fit gave the
   opening away (about +1.5 dB over the body against the recording's +7).
   The closed hat's onset is frozen from a grid (attack 0, 3 ms to 0.35
   on a curve of 1), at +6.9 dB, and the rest is fitted around it.
6. **The two hats share the metal, the drive and the volume, and differ
   in the envelopes, the highpass and the tone pole.** This departs from
   the issue's decision 4 for a measured reason: with the open hat's
   highpass and tone, the closed hat scores 2.107 and peaks 2 dB under
   `main`'s window; with its own (7 kHz, tone 0.9) it scores 1.868 within
   it. The closed recording is also 3 kHz the brighter.
7. **`velSens` 1 on every operator** (was 0.6), since the drive flattens
   the level changes before it; at velocity 0.4 the hats now fall 3.2 and
   4.5 dB in RMS where they fell 3.9. Velocity 1 renders the same either
   way.
8. **No engine change in this PR. An envelope after the drive is
   proposed.** Offline, holding the operator envelopes flat and applying a
   fitted envelope after the drive and highpass takes the closed hat from
   1.868 to 1.468 and the open hat from 2.146 to 1.889, keeps the fill
   through the decay, and would free the tone pole from setting the level
   (research note, "What remains").

## Consequences

- `tr808-hat-closed.json`, `tr808-hat-open.json` and their two rows of
  `fmGolden.json` (refreshed under Node 24) change; every other patch
  renders the same bits. The patch index is unchanged. The new sounds
  become the baseline only on tacowars's listen.
- Scores, before → after: closed 2.400 → 1.868, open 4.925 → 2.146. Every
  component is closer except the closed hat's `wave`, 0.0342 → 0.0354,
  inside its seed spread (± 0.0043): with free-running phases that term
  sums the two signals' energies and rewards a render quieter than the
  recording in its first 30 ms (the research note shows the sums).
- A hit costs more to render (closed 3.8 → 5.6 ms, open 4.3 → 7.2 ms per
  1 s hit on an M1, loaded): Pulse waves, a second filter stage and the
  drive.
- Each hit still differs: the four oscillators start at random phases
  live, and only the fit harness seeds them.
- A saved song embeds its own snapshot, so no saved song changes until it
  is re-exported.
