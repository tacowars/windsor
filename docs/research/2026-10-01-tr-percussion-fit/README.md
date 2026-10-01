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

These specs and start patches were written at patch format 2, where the
drive was `filter.drive`. Format 3 moved it to the voice's own stage
(`2026-10-01-voice-drive-stage`), and a bare patch's `filter.drive` is no
longer read, so the second pass (windsor#318, decision 5) points every spec
here at `drive.gain` and moves each start patch's `filter.drive` into
`drive` as the format's own upgrade does (the gain with the filter on, soft,
no bias, an open tone; unity with the filter off). The first-pass stages
above reproduce with them as they are now.

## Overlays

The toolkit's six panels per sound, reference in black, render in red:
`overlays/<patch>.png`. The 808 toms' and the 909 mid tom's are the second
pass's (below); the rest are the first pass's.

## Second pass (windsor#318)

tacowars's listen to the first pass: the cowbell good enough but missing a
little attack and some complexity; the 808 toms close but missing timbre
("more triangle wave than sine, or some air or noise that gives them the
wooden tom sound"); the 909 tom the furthest off, in its noise, its pitch
envelope and its timbre. Two engine changes had landed since the first
pass: the voice drive stage with bias (windsor#300) and envelope edges at
their own samples (windsor#301, so an attack of 0 is a step). Measured on
the same Apple M1 (macOS 26.5), Node 24.21, Python 3.14.5, against
`origin/main` at `66685a1`; the record is
`docs/log/2026-10-01-tr-percussion-second-pass.md`.

### Method

Each sound starts from its shipped patch, with the structural change named
below made by hand, and is then polished by Nelder–Mead (σ 0.03, seeds
1–4), which steps one control at a time from the start. CMA-ES, as in the
first pass, found nothing better than the start in 750–1100 evaluations at
σ 0.06–0.2 on the 808 mid tom and the 909 tom: the shipped patches sit in narrow
optima, and a whole-population step lands far outside them.

A candidate ships only if **every** component of its score is at or below
the shipped patch's (the first pass's rule). From each fit's log the
lowest total that meets it is taken (`fit.py` keeps the lowest total
alone), rounded to six significant figures and level-matched by `volume`
to the shipped peak.

### Scores, before and after

"Before" is the patch on `main` at `66685a1` (the first pass's patches,
moved a little by windsor#301's edges), "after" the library file in this
change. Toolkit default weights; the 909 tom's fits zero `pitch` and
`harm`, as the first pass did, since both read the beat of its two tones.

| Patch | total | stft | band (dB) | harm (dB) | pitch (st) | wave |
|---|---|---|---|---|---|---|
| `tr808-tom-low` | 0.741 → **0.596** | 0.119 → 0.078 | 1.74 → 1.53 | 10.57 → 8.67 | 0.079 → 0.077 | 0.0046 → 0.0015 |
| `tr808-tom-mid` | 0.650 → **0.444** | 0.155 → 0.093 | 1.46 → 0.86 | 7.81 → 6.00 | 0.128 → 0.108 | 0.0056 → 0.0017 |
| `tr808-tom-high` | 0.766 → **0.606** | 0.121 → 0.103 | 1.87 → 1.79 | 10.63 → 7.36 | 0.1218 → 0.1217 | 0.0045 → 0.0028 |
| `tr909-tom-mid` | 2.473 → **2.434** (fit weights 0.923 → 0.894) | 0.422 → 0.418 | 3.21 → 3.03 | 16.87 → 16.83 | 4.377 → 4.335 | 0.090 → 0.087 |
| `tr808-cowbell` | 1.456, **unchanged** | | | | | |

No component ends worse. `tr909-tom-low` and `-high` have no reference;
they are derived from the new mid as before.

### 808 toms

The recordings rise to their crest in 0.25–0.3 ms and fall from it faster
than a sine would: the first 0.3 ms is a strike. The first pass's 0.5 ms
attack could not make it; with windsor#301, the body's attack is 0 (a step
at the note-on sample, 0–44 µs after the polish), struck at about 0.32 of a
cycle. That is where the "wood" was, by measurement:

| Patch | above 2 kHz, 0–5 ms | click (>1 kHz) peak, re peak |
|---|---|---|
| `tr808-tom-low` | −10.9 → +1.5 dB | −16.4 → −12.6 dB (recording −12.5) |
| `tr808-tom-mid` | −9.3 → +3.1 dB | −17.4 → −10.9 dB (recording −10.5) |
| `tr808-tom-high` | −8.4 → +0.6 dB | −13.8 → −13.2 dB (recording −10.4) |

The other two candidates tacowars named were measured against the
recordings before they were used:

- **Triangle against sine.** The mid tom's recording has odd harmonics, but
  faint ones: H3 −42, H5 −49, H7 −60, H9 −66 dB re H1 over 30–200 ms (a
  triangle's are −19, −28, −34, −38). They hold at every level, where the
  drive's H3 fades with the level. The body is now a User wave with those
  partials (H3 about −44 dB after the polish), and `harm` falls by 1.8–3.3
  dB on all three. A triangle would put H3 23 dB above the recording.
- **Air or noise.** Above 2 kHz after 5 ms the mid tom's recording sits
  76–100 dB below its peak; there is no noise in the body to match. The fits kept
  the first pass's faint noise tick (the mid's 11 dB lower).

The low and high toms take the same two changes on their own shipped
patches and their own polish (the first pass derived them from the mid,
but the mid's polish does not transfer: the same change on the shipped
low and high first made `stft` worse, 0.119 → 0.160 and 0.121 → 0.217,
before their own polish brought it below the start). The low tom's polish
lowered its peak 2.3 dB, which `volume` restores.

Remaining: the mid tom's body H3 is still 11 dB high at 5–30 ms, the
drive's level-dependent part; −40 dB lands 3–11 ms late on the low and mid.

### 909 mid tom: the noise (decision 3)

The first pass's noise was a burst that stopped at 64 ms through the tones'
4.4 kHz lowpass: 5–6 dB hot at 30–60 ms, then 25–45 dB short after it, and
dull above 6 kHz at the onset. The recording's noise falls smoothly (2–6
kHz from −30 dB re peak at 0–5 ms to −50 at 50 ms and −80 at 190 ms), with
a gentle tilt to past 16 kHz.

Three structures were fitted with the tones held at the shipped patch's,
the noise and what colours it free (CMA-ES, σ 0.15, 800 evaluations each);
the prototype is in `docs/research/2026-10-01-tom-noise-colour-prototype/`:

| Structure | objective (fit weights) | 2–6 kHz, 0–5 ms | 2–6 kHz, 30–150 ms |
|---|---|---|---|
| shipped | 0.9230 | −2.3 dB | +5.6 dB |
| e: the shared lowpass, its envelope, the drive's tone | 0.8986 | +2.5 dB | +3.5 dB |
| d: e plus the prototype's per-operator noise lowpass and highpass | 0.8989 | +2.5 dB | +2.1 dB |
| **b: FM-coloured noise** | **0.8713** | **+0.3 dB** | **−0.3 dB** |

What exists closes it: in b (algorithm 6) the lower tone moves to B, C is a
sine fixed at 4.8 kHz and D a Noise operator modulating it, which spreads C
into a band of noise around its frequency, with its own envelope and no
use of the tones' filter (opened to 15.9 kHz). The prototype adds nothing
over e on the objective and stays 2 dB further from the recording than b;
its write-up is the proposed engine ticket, with the recommendation not to
schedule it for this work. b was then polished whole (Nelder–Mead, 1500
evaluations) and given a drive bias of +0.05 (below).

The shipped patch, against the recording (seeds 1–4):

| Reading | Before | After |
|---|---|---|
| 2–6 kHz, 0–5 ms | −2.3 dB | −0.3 dB |
| 2–6 kHz, 30–150 ms | +5.6 dB | −1.1 dB |
| above 6 kHz, 0–5 / 5–30 / 30–150 ms | −9.8 / −1.3 / +3.0 dB | −2.5 / −0.0 / −0.6 dB |

### 909 mid tom: the glide (decision 4)

Read by `tom909.py`: the strongest spectral peak between 40 and 300 Hz in a
Hann window around each time (0–20, 20–40, 70–130 and 240–360 ms),
zero-padded, against the recording's (111.4, 125.4, 99.7 and 94.4 Hz; the
lower tone 63.0 and 58.0 Hz in the late windows). The 20 ms windows cannot
part the two tones (93 and 57 Hz once settled), so the early readings are
a blend of both; a matrix-pencil reading of the same windows put the
recording's upper tone anywhere in 100–138 Hz there, depending on model
order, against stable values at 100 and 300 ms.

| Time | Before | After |
|---|---|---|
| 10 ms | +0.77 st | +0.72 st |
| 30 ms | −3.30 st | −3.34 st |
| 100 ms | +0.33 st (lower −0.09) | +0.32 st (lower −0.16) |
| 300 ms | −0.17 st (lower −0.19) | −0.18 st (lower −0.21) |

The glide is the first pass's: the polish left the pitch envelope where it
was, and nothing tried moved the 30 ms reading without making `stft`,
`band` and `wave` worse. A hand-shaped two-segment glide fitted to those
readings (+16 semitones at 5 ms, +4.5 at 30) scores 2.99 against 2.43 on
the shipped patch (`wave` 0.087 → 0.311): the
energy the 20–40 ms window reads at 125 Hz is the beat and the upper tone's
strong second harmonic (−12 dB in the recording's body), not a higher
pitch. The tones share one glide in the recording (their ratio reads
1.62–1.63 at 15–45, 70–130 and 240–360 ms), which the global pitch
envelope models, so the per-operator pitch-envelope depth decision 3 also
named was not prototyped.

### 909 mid tom: the timbre

The recording's cycles are lopsided, the negative half the larger
(1.08 in the body, 1.18 at 30–150 ms). A drive bias makes that: +0.05 moves
the body's reading from 1.01 to 1.05 and still beats the shipped patch in
every component. At the polish's level the totals are 2.415 with no bias,
2.430 at +0.05 and 2.447 at +0.1; the scores prefer −0.1 (2.404), which
turns the cycles the other way (0.93), so it is not used. After the level
match the shipped total is 2.434.

Remaining: the attack is still the furthest-off part (150 Hz–2 kHz is 9 dB
low at 5–30 ms, the >1 kHz click −15.9 against −11.7 dB re peak);
the level peaks at 6 ms against 30.

### 808 cowbell: unchanged

No candidate the toolkit could find beats the shipped cowbell in every
component by a margin worth a change:

- The polish (Nelder–Mead from the shipped patch plus a silent noise strike,
  900 evaluations) reached 1.401, but with `pitch` 2.19 against 2.15; only
  2 of its 900 candidates beat the shipped patch everywhere, the best at
  1.451.
- A second stage with `pitch` weighted 1 (500 evaluations) found none.
- By hand: an attack of 0.5 or 1.5 ms (the recording peaks at 2 ms, the
  patch at 4) scores 1.539 and 1.501; a noise strike at level 0.15, 1.461;
  a lower band-pass Q (resonance 1.0, 0.8, 0.6) 1.454–1.597 with `harm` up
  0.4–2.2 dB.

What tacowars hears missing is real in the measurements but not in the
score: the recording's 540 Hz oscillator keeps its upper harmonics (H4–H13
at −25 to −43 dB re the 818 Hz tone, where the patch's are 7–24 dB lower
through its 860 Hz band-pass), and it has intermodulation products
(1357.5 Hz = 540 + 817.6, −43 dB; 833 Hz, −32 dB) that a two-oscillator
patch through a symmetric drive does not make. The cowbell is left for a
pass with a measure of those, or for tacowars's hand.

### Levels (decision 6)

Peak at velocity 1 on C4, mean of the peaks over seeds 1–8, before and after:

| Patch | Before | After |
|---|---|---|
| `tr808-tom-low` | −7.47 dBFS | −7.48 |
| `tr808-tom-mid` | −8.01 | −7.77 |
| `tr808-tom-high` | −7.96 | −7.91 |
| `tr909-tom-low` | −6.15 | −6.15 |
| `tr909-tom-mid` | −6.07 | −6.06 |
| `tr909-tom-high` | −6.11 | −6.11 |

### Reproducing the second pass

As above, with `tom909.py` run from `scripts/sound-match/` as
`python ../../docs/research/2026-10-01-tr-percussion-fit/tom909.py "$SM_TR_REFS/Tom Mid 909 Clean 03.wav" <patch>`.
Each stage's start is in `start/`. A later stage starts from the previous
stage's chosen candidate (the lowest total at or below the shipped patch in
every component) for the 808 mid and low toms, and from the previous
stage's `best.json` (its lowest total) where no candidate met the rule yet:
the 808 high tom, the 909 tom and the cowbell.

| Patch | Stages |
|---|---|
| `tr808-tom-mid` | `.pass2` → `.pass2.stage2` |
| `tr808-tom-low`, `-high` | `.pass2` → `.pass2.stage2` → level match (the low tom only) |
| `tr909-tom-mid` | `.pass2b-noise` → `.pass2b.stage2` → `drive.bias` +0.05 → level match |
| `tr909-tom-low`, `-high` | the new mid a fourth below and above, tones' decay and release × √(10/7) and × √0.7, level match |
| the noise experiment | `.pass2e-noise`, `.pass2b-noise`, and `.pass2d-noise` (prototype bundle) |
| `tr808-cowbell` (not shipped) | `.pass2` → `.pass2.stage2` |
