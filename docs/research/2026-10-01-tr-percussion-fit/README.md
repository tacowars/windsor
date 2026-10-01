# TR tonal percussion fitted to recordings

windsor#302, Wave 1 of the TR fitting work: the 808 toms, rim shot, claves
and cowbell and a new 909 mid tom, fitted with the sound-match toolkit
(`scripts/sound-match/`, record `2026-10-01-sound-match-toolkit`) to
tacowars's picks from Samples From Mars *808 From Mars* and
*TR-909 From Mars*. The recordings are a commercial pack and stay outside
the repository; only numbers measured from them, and the overlays below,
are here. The numbers say where a render differs; whether it sounds right is
tacowars's call by ear.

Everything was measured on an Apple M1 (macOS 26.5), Node 24.21, Python
3.12.9, against `origin/main` at `7b17140`.

## The references and the conditions

| Patch | Reference |
|---|---|
| `tr808-tom-low` | `03. Low Tom/Clean/Digital/A/Tom Low A 808 05.wav` (808 From Mars, individual hits) |
| `tr808-tom-mid` | `Tom Mid A 808 05.wav` |
| `tr808-tom-high` | `05. Hi Tom/Clean/Digital/A/Tom Hi A 808 05.wav` (808 From Mars, individual hits) |
| `tr909-tom-mid` (new) | `Tom Mid 909 Clean 03.wav` (TR-909 From Mars) |
| `tr808-rimshot` | `Rim Shot A 808.wav` |
| `tr808-clave` | `Claves A 808.wav` |
| `tr808-cowbell` | `Cowbell A 808.wav` |

Every render is note 60 (C4), velocity 1, no gate (a hit runs its course),
aligned and normalised by the toolkit's defaults. A patch with a Noise or a
free-phase operator is scored over seeds 1–4, as the toolkit does; the
engine keeps its random noise live. The scores are the toolkit's, at its
default weights (`stft` 1, `band` 0.1, `harm` 0.04, `pitch` 0.2,
`wave` 2), lower is closer.

## Scores, before and after

"Before" is the patch on `main`; for the new 909 mid tom it is the start
patch built for it, with the old `tr909-tom-low` against the same recording
for comparison.

| Patch | total | stft | band (dB) | harm (dB) | pitch (st) | wave |
|---|---|---|---|---|---|---|
| `tr808-tom-low` | 5.328 → **0.705** | 0.567 → 0.089 | 6.19 → 1.72 | 35.6 → 10.5 | 10.57 → 0.08 | 0.303 → 0.004 |
| `tr808-tom-mid` | 5.512 → **0.666** | 0.530 → 0.166 | 6.44 → 1.45 | 33.3 → 7.8 | 13.35 → 0.13 | 0.167 → 0.007 |
| `tr808-tom-high` | 5.591 → **0.700** | 0.550 → 0.133 | 6.63 → 1.89 | 34.3 → 8.5 | 13.34 → 0.13 | 0.168 → 0.006 |
| `tr909-tom-mid` | 3.975 → **2.472** (old low tom 4.733) | 0.646 → 0.422 | 5.55 → 3.22 | 32.0 → 16.9 | 5.80 → 4.38 | 0.167 → 0.089 |
| `tr808-rimshot` | 6.022 → **2.063** | 2.036 → 1.280 | 7.74 → 3.50 | 39.7 → 6.5 | 7.84 → 0.74 | 0.028 → 0.012 |
| `tr808-clave` | 5.721 → **2.147** | 1.306 → 0.768 | 5.91 → 4.42 | 20.1 → 11.0 | 14.43 → 2.47 | 0.067 → 0.001 |
| `tr808-cowbell` | 7.304 → **1.459** | 1.081 → 0.438 | 5.74 → 1.53 | 48.4 → 9.3 | 17.67 → 2.15 | 0.091 → 0.033 |

No score ends worse than it started, in total or in any component.

### Pitch on C4

| Patch | Reference | Render | 20, 40, 80 ms (toolkit track) |
|---|---|---|---|
| `tr808-tom-low` | 87.7 Hz | 87.6 Hz | −0.1, −0.0, +0.0 st |
| `tr808-tom-mid` | 138.0 Hz | 138.4 Hz | −0.1, +0.0, +0.1 st |
| `tr808-tom-high` | 187.8 Hz | 187.9 Hz | −0.1, +0.0, +0.1 st |
| `tr909-tom-mid`, upper tone, 20–100 ms | 104.9 Hz | 106.0 Hz (+0.18 st) | see below |
| `tr909-tom-mid`, lower tone, 20–100 ms | 65.0 Hz | 65.2 Hz (+0.05 st) | |

The 808 rows are the toolkit's 30–150 ms reading and its per-time pitch
differences. The 909 tom is two inharmonic tones that beat, and the
toolkit's zero-crossing track reads the beat as pitch: the recording's own
track swings between 80 and 135 Hz every 26 ms. Its rows are spectral peaks
instead (Hann window, the strongest peaks under 200 Hz); over 100–300 ms
the render's tones sit at 96.5 and 59.1 Hz against 96.5 and 59.3 Hz.

### Level

Peak at velocity 1 on C4, mean over seeds 1–8, against `main`
(decision 4: within 1 dB). The patch's `volume` carries the match, except on
the cowbell, whose operator levels carry it so `volume` stays inside the
knob's range.

| Patch | Before | After |
|---|---|---|
| `tr808-tom-low` | −7.98 dBFS | −8.03 |
| `tr808-tom-mid` | −8.01 | −7.92 |
| `tr808-tom-high` | −7.96 | −7.93 |
| `tr909-tom-low` | −6.06 | −6.14 |
| `tr909-tom-mid` | new; siblings −6.06 / −6.13 | −6.06 |
| `tr909-tom-high` | −6.13 | −6.09 |
| `tr808-rimshot` | −9.92 | −9.96 |
| `tr808-clave` | −4.47 | −4.47 |
| `tr808-cowbell` | −11.33 | −11.32 |

## What was fitted, per sound

The structure (algorithm, waves, which operator does what, phase lock) is
chosen here; the optimizer moves only the numbers each spec names. Every
fitted amplitude envelope that needs a long, exponential-looking tail uses
the trigger-mode breakpoint: decay to a sustain level, then the release
carries on to zero without a note-off (`envelope.ts`). One decay segment
reaches zero at a finite time on a rational curve and cut every tail short.

### 808 toms

Algorithm 6, as before: A is the body sine, C the same sine with a short
decay that shapes the first few milliseconds, B a noise tick, D silent.
Every tonal operator is phase-locked (decision 5) and starts at about 0.32
of a cycle, near the crest, as the recordings do. The fit dropped the dark
noise puff almost to nothing (the recordings carry none above 2 kHz after
5 ms) and shrank the pitch envelope from 3 semitones over 100 ms to under
2 semitones over 5 ms on the mid tom, 3 and 1.4 semitones over 15 ms on the
low and high. The mid tom was fitted first; the low and high start from
its result and move only pitch, decay and level (decision 1).

Main remaining differences, alike on all three:

- **0–5 ms above 2 kHz is 9–10 dB low**, and the >1 kHz click peaks at
  −17 to −22 dB against −10 to −12.5 dB re peak. The recording rises to its
  crest in about 0.25 ms; the engine's fastest edge is slower (engine
  limits, below).
- **Body H3 is 7–14 dB high at 5–30 ms**: the filter's drive (1.4–1.5) adds
  odd harmonics the recording does not have. The fit kept the drive because
  it helps the level envelope more than the H3 costs.
- **Late harmonics**: the recording's H2 and H3 rise to about −37 dB re the
  fundamental in the tail, at −75 dB absolute; the render stays a purer
  sine there (30–50 dB lower). Inaudible next to the fundamental.
- −40 dB lands 10 ms late on the mid and low toms.

### 909 mid tom (new)

The recording is two tones about 1:1.63 apart (92.7 and 56.9 Hz once
settled, each with its own odd harmonics), sharing one downward glide:
the upper tone reads 115.7 Hz at 10–30 ms, 104 Hz at 20–100 ms, 96.5 Hz at
100–300 ms and 92.7 Hz after 300 ms, plus noise through 2–12 kHz. The patch
is algorithm 7: A and C rounded triangles at those two settled ratios,
phase-locked, under the global pitch envelope (a 0.5 ms blip to +7.7
semitones, then +4.2 semitones gliding to 0 over 330 ms through the
trigger-mode breakpoint), and B noise, all through a 4.4 kHz lowpass with
drive 1.3. D is silent.

It took two fits. The first (`specs/tr909-tom-mid.json`, ratios free,
default weights) scored 2.374, but by moving both ratios off the
recording's tones (90.8 and 59.7 Hz at 100–300 ms, against 96.5 and 59.3)
to fit the beat-confused pitch track. The second
(`specs/tr909-tom-mid.stage2.json`) fixes the ratios at the measured
tones and zeroes the `pitch` and `harm` weights, which read the beat rather
than either tone; it scores 2.472 at the default weights, with both tones
on pitch through the glide. That one ships. A further fit at the matched
level found nothing better.

Main remaining differences:

- **Tail balance**: after 300 ms the lower tone leads (the upper one is
  20 dB under it); in the recording the upper leads by 5 dB.
- **Noise**: 2–6 kHz is 5–6 dB high at 30–150 ms and 0–5 ms is 4 dB low
  above 2 kHz. Noise and tones share the one filter, so the noise cannot be
  coloured on its own.
- **Lopsided cycles**: the recording's negative half-cycles peak 1.08–1.18
  of the positive ones; the render's are symmetric (engine limits).
- The level peaks at 5 ms against 30 ms: the recording's peak is where its
  two tones first line up, a beat the render places differently.

`tr909-tom-low` and `tr909-tom-high` have no reference. They are the mid's
fitted patch a fourth below and above (69.4 / 42.6 Hz and 123.7 / 75.9 Hz
on C4), the spacing the old set used (90 and 160 Hz, "a fourth apart"),
with the tones' decay and release times scaled by the old set's decay ratio
(0.40 s and 0.28 s about their geometric mean: ×1.20 and ×0.84), and each
level-matched to its old peak.

### 808 rim shot

Algorithm 6: A a sine at 1850 Hz on C4; C a sine at 438 Hz bent by its own
phase-locked modulator D at the same ratio, which gives the lower resonator
the recording's harmonics; B a 7 ms noise burst for the broadband snap; all
through a driven (2.2) 600 Hz highpass. The old patch had the upper
resonator at 1667 Hz and no broadband content; the recording's peak is
1820–1850 Hz.

Main remaining differences:

- **Polarity and lopsidedness**: the recording's negative half-cycles are
  the larger (1.34–1.41 of the positive); the render's are the smaller
  (0.64–0.73). The soft clip is odd-symmetric, so it cannot make one side
  bigger. A start with every tonal operator turned half a cycle (an exact
  polarity flip) fitted to 2.53, worse than the shipped 2.06.
- **Drive against level**: at the old patch's volume the fit reached 1.88
  with drive 3; matching the old peak (decision 4) needs a fifth of that
  volume, which takes the drive out of saturation, and the refit at that
  level reached 2.06 (engine limits).
- 150–600 Hz is 4.6 dB low at 5–30 ms.

### 808 claves

One phase-locked sine at 2575 Hz on C4 (the recording's frequency; the old
patch played 2500 Hz through a band-pass and an FM click), struck near its
crest with a curved 0.5 ms attack, falling through the trigger-mode breakpoint.
The band-pass and the modulator are off: the recording is a pure sine, its
harmonics at −60 dB. A first fit with the modulator left in scored 2.29 by
spending it on a click that the recording does not have; the shipped spec
leaves it out.

Main remaining differences:

- **The edge**: the recording jumps from 0.02 to 0.94 of peak in one
  sample; the render's first cycle and a half are a ramp, so the broadband
  click of that jump (above 4 kHz in the first 10 ms) is 10–30 dB low
  (engine limits).
- The tail bends at 22 ms and drops at 32 ms, where the recording falls
  straight to −40 dB at 33 ms.

### 808 cowbell

Algorithm 7: two Pulse operators at 540 and 817 Hz on C4 (1:1.51, the
recording's tones; the old patch had 587 and 845 Hz, 1:1.44) with duties of
0.22 and 0.31, which give the even harmonics both tones show, through a
860 Hz band-pass with drive 1.36 (the old one sat at 2.64 kHz). One shared
envelope: 10 dB down within 10 ms, then a long release, 40 dB down at
387 ms against 358. C and D are silent. The oscillators stay free-running
(`phaseFree: true`): on the 808 they run continuously, so a hit does not
start the same way twice, and decision 5 does not apply.

Main remaining differences:

- 30–150 ms is 2.3 dB loud; the tail ends 30 ms late.
- The tones' second harmonic is 4–5 dB high after 30 ms; above 6 kHz is
  2–7 dB low throughout.
- The toolkit's `pitch` (2.15) and `harm` scores read the two tones' beat,
  as on the 909 tom.

## Engine limits met (decision 6)

- **The fastest edge.** An envelope segment is at least 0.5 ms
  (`MIN_SEG_TIME`) and the amplitude moves at control rate, one step per
  32 samples (0.67 ms). The 808 toms reach their crest in about 0.25 ms and
  the claves in one sample. Gap: 9–10 dB above 2 kHz in the toms' first
  5 ms, 10–30 dB above 4 kHz in the claves' first 10 ms. windsor#301.
- **No asymmetric shape.** The only nonlinearity is the filter drive's
  odd-symmetric soft clip. The rim shot's negative half-cycles are 1.34–1.41
  of the positive in the recording and 0.64–0.73 in the render; the 909
  tom's 1.08–1.18 against 1.00–1.06. windsor#300.
- **Level and saturation are one control.** Volume and every operator level
  sit before the drive, so a patch cannot keep its saturation at a lower
  peak. The rim shot loses 0.19 of total score (1.88 → 2.06) to decision 4.
  windsor#300.
- **One filter for tones and noise.** The 909 tom's noise is 5–6 dB bright
  at 30–150 ms because its colour is the tones' lowpass.

## Toolkit notes

- `compare.py --png` fails on a reference shorter than its 30 ms waveform
  panel (the rim shot is 25 ms): `x and y must have same first dimension`.
  The rim shot's overlay was drawn against a scratch copy padded with 15 ms
  of silence; its scores are against the file itself.
- A per-cycle `pitch` and `harm` reading cannot follow two inharmonic tones
  (the 909 tom, the cowbell); spectral peaks per window did that job here.
- With a filter drive above 1 the score depends on `volume`, so a fit at one
  level and a level match afterwards are not the same patch. Each fit here
  ends with a short refit at the matched level (the `.stage2` / `.stage3`
  specs).

## Reproducing

From `scripts/sound-match/` with the toolkit's venv (its README), and the
two folders in the environment:

```bash
export SM_TR_REFS=<…>/windsor-tr-refs                      # tacowars's picks
export SM_808_HITS="<…>/808 From Mars/WAV/01. Individual Hits"
python fit.py ../../docs/research/2026-10-01-tr-percussion-fit/specs/<spec>.json
python compare.py "$SM_TR_REFS/<file>.wav" <patch-id> --png
```

`start/` holds each spec's start patch; a later stage starts from the
previous stage's `best.json`, or from the level-matched library patch, as
its file says. The order:

| Patch | Stages |
|---|---|
| `tr808-tom-mid` | `tr808-tom-mid` → `.stage2` (σ 0.06) → level match → `.stage3` |
| `tr808-tom-low`, `-high` | start from the mid's `.stage2` result → level match → `.stage2` |
| `tr909-tom-mid` | `tr909-tom-mid` (superseded, above) → `.stage2` → level match |
| `tr808-rimshot` | `tr808-rimshot` → level match → `.stage2` |
| `tr808-clave` | `tr808-clave` (no level-dependent drive) |
| `tr808-cowbell` | `tr808-cowbell` (stopped at 1415 of 1500 evaluations by a time limit; best taken from its log) → level match → `.stage2` |

The final library patch is each last stage's `best.json`, rounded to six
significant figures, with `volume` (or, for the cowbell, the two carrier
levels) set for the peak. CMA-ES with a fixed seed makes each run
repeatable on the same machine.

## Overlays

The toolkit's six panels per sound, reference in black, render in red:
`overlays/<patch>.png`.
