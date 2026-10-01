# The 909 kicks are refitted: a biased drive, a falling tail, Tune's sweep

- **Date:** 2026-10-01
- **Status:** proposed (awaiting tacowars's listen in the PR preview)
- **Amends:** the 909 parts of `docs/design/drum-bank.md`'s kick
  paragraphs, and, for the 909 kicks only, the pitch
  `2026-10-01-kicks-tuned-to-c4` measured (52 Hz)
- **Follows:** `2026-09-30-drum-kicks-fitted-to-recordings`,
  `2026-10-01-sound-match-toolkit`, `2026-10-01-voice-drive-stage`,
  `2026-10-01-envelope-edges-at-sample-rate`

## Context

tacowars hears the 909's quality as its tone and punch: a waveform with more
than a sine in it, "like there is a little clipping". Against tacowars's
chosen hits from Samples From Mars *TR-909 From Mars* (a commercial pack,
kept outside the repository) the toolkit measured what the first fit
missed: a lopsided body, a tail below the patches' 52 Hz, an opening that
goes straight to a negative edge, and, for the hard kick, Tune's long sweep
(windsor#325). Since that fit the voice gained its own drive with bias
(windsor#300, #309) and envelope edges that land on their own sample
(windsor#301). The measurements are in
`docs/research/2026-10-01-tr909-kick-refit/README.md`.

## Decisions

1. **Each 909 kick is refitted to one reference** with the sound-match
   toolkit, C4, velocity 1, no gate, aligned on the attack edge:
   `tr909-kick-short` to `BD 909 Clean Short C 04`, `tr909-kick` to
   `BD 909 Clean Medium C 03`, `tr909-kick-hard` to
   `BD 909 Clean Medium F 05` (Tune near the top) and `tr909-kick-long` to
   `BD 909 Clean Long A 04`. The ids keep their meaning. Each description
   names its reference.
2. **The lopsided body is the voice drive with bias** (`soft`, gain, bias
   and tone fitted), not a phase-locked second harmonic. Both were fitted
   on all four at the same budget. The drive is closer in waveform on all
   four and reproduces the punch cycles' negative-to-positive ratio (1.35)
   on three; the second harmonic, held near the recording's H2 level,
   never gets past 1.08. The price is 7–14 dB too much H2 in the later
   body, where the recording's ratio flips below 1 (its chain's coupling)
   and the render's does not.
3. **The body settles at 49.4 Hz on C4** (body ratio 0.188819, one value
   for all four), the recordings' measured pitch (49.2–49.9 Hz by the
   toolkit's track and by an FFT peak), rather than 52 Hz. The sweep is a
   two-segment pitch envelope starting at its peak; Tune is its length.
   tacowars kept these tunings at the listen, and the 808 kicks' own
   recording pitches (`2026-10-01-tr808-kicks-refitted`) with them.
4. **The opening is a step.** The edge operator (`Square D` at a fixed
   frequency) has an attack of 0 and its locked phase in the square's
   negative half; the body starts on its falling side with a fitted attack
   of at most 0.19 ms.
5. **The filter is Off and C and D are silent.** A highpass after the drive
   (the coupling's analogue) was fitted on all four and scored worse; the
   old 12 kHz lowpass existed only to enable the old drive.
6. **The level holds within 1 dB of the old patches** (−0.57 to +0.69 dB at
   velocity 1). With the drive on nothing after the shaper sets the level,
   so the fit held it: the research folder's `fit_constrained.py` wraps the
   toolkit's `fit.py` with a penalty on the peak, and for the short kick a
   cap on `band` so that no score ends worse than the old patch's.
   `scripts/sound-match/` is unchanged.

## Consequences

- The four patch files and their four golden rows change; every other
  patch renders the same bits. `patches/index.ts` regenerates unchanged
  (the ids are the same). The new sounds become the baseline only on
  tacowars's listen.
- A song that played a 909 kick at 52 Hz in its key hears it about a
  semitone flat after it reloads these patches; a saved song keeps its own
  snapshot until it is re-exported. No format bump: a library edit.
- The edge's and bodies' attacks sit below 0.5 ms, which the Attack knob
  reaches through its zero slice since `2026-10-01-tr808-kicks-refitted`.
- At the listen tacowars heard the four kicks as cleaner than the machine,
  missing some grit and air, and accepted them as usable to process.
- What remains (the click 2–7 dB hot on three, the body-average ratio, the
  short kick's post-cutoff bump) is listed, measured, in the research note.
