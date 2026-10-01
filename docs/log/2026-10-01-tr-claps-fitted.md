# The 808 and 909 claps are fitted to recordings, their bursts on envelopes

- **Date:** 2026-10-01
- **Status:** proposed (awaiting tacowars's listen in the PR preview)
- **Amends:** the clap paragraphs and rows of `docs/design/drum-bank.md`
- **Follows:** `2026-10-01-sound-match-toolkit`,
  `2026-10-01-tr-percussion-fitted-to-references`,
  `2026-10-01-envelope-edges-at-sample-rate`
- **Links:** windsor#352 · measurements in
  `docs/research/2026-10-01-tr-clap-fit/README.md`

## Context

`tr808-clap` and `tr909-clap` were built from circuit write-ups: noise
through a bandpass, gated by a saw-down LFO at 100 and 91 Hz. Those rates
sit above the patch editor's Rate knob (0.02–40 Hz), so
`libraryKnobRanges.test.ts` carried both as known misses, and the first
touch of the knob would have clamped the gate. tacowars picked a reference
hit for each from Samples From Mars (*808 From Mars* `Clap A 808`,
non-accented; *TR-909 From Mars* `Clap 909 Clean`, "essential for hard
techno"). Measured, both recordings are three noise bursts and a "reverb"
tail at uneven gaps (10.9, 12.5, 7.1 ms and 11.3, 12.5, 6.3 ms), in one
band about 1 kHz with steep low and gentle high sides.

## Decisions

1. **The bursts come from envelopes (the issue's option (a)); the LFO is
   off.** Algorithm 5: D is the patch's one Noise operator, held at level
   0.353553, the depth at which a phase-modulated sine loses its carrier
   line and becomes white noise. A, B and C are fixed sines it modulates,
   so each is noise under its own Trigger-mode envelope: A plays burst 1
   (Init 1, falling through the attack) and burst 2 (a step to the sustain
   level, then the release); B burst 3 and C the tail (silent through an
   attack as long as the onset, a step, the release). Four Noise carriers
   would need algorithm 7, which the fixed-index kernel renders only with
   one Noise operator. Against the LFO structure with its rate free
   (option (b), a widened knob) this reproduces the measured onsets; the
   LFO can only space bursts evenly, and on the 808 its fit went to five.
   The Rate knob is not widened, and `efm-clap` stays a known miss.
2. **Noise colour is the filter's: a 2-pole highpass with resonance and
   the drive's tone pole**, the recordings' steep low and gentle high
   sides. It beat the 2-pole bandpass, and both 4-pole modes, in equal
   fits. FM-coloured noise (#327) is a line plus a white floor at any depth;
   left free, the fit used the line, a 1 kHz tone 18–21 dB above the noise
   around it that the recordings do not have (theirs 7 dB, the largest of
   a few noise bins), for a gain of 0.02–0.03 in total. The noise ships
   white.
3. **Each fit weights the transient**: the first 40 ms of the recording
   (the bursts and the tail's onset) is a second reference at the weight of
   the whole. A refit at three times that weight, and a structure whose
   first burst steps at the first sample (A in Loop mode, muted by a
   one-shot LFO) were tried; neither brought the transient closer, and
   they are recorded in the research note.
4. **Peaks are held to `main`'s at velocity 1 on C4** (−9.54 and
   −7.84 dBFS, mean over seeds 1–8) inside the last fit: the research
   folder's `fit_level.py` adds a level term to the toolkit's objective,
   since volume and drive are one control (windsor#300) and a match after
   the fit changes the fitted sound.
5. **Live noise stays random.** Only the fits seed it; the patches have no
   seed.

## Consequences

- `tr808-clap.json`, `tr909-clap.json`, their golden entries and
  `patches/index.ts` (regenerated, unchanged listing) change; every other
  patch renders the same bits. The new claps are the baseline only on
  tacowars's listen.
- `KNOWN_MISSES` in `libraryKnobRanges.test.ts` drops the two TR claps.
- No format change: every field used exists.
- A saved song embeds its own snapshot, so no song changes until it is
  re-exported.
- The remaining differences, the engine limits behind them and a proposed
  engine ticket are in the research note.
