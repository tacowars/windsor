# The 909 kicks refitted: lopsided body, falling tail, Tune punch

windsor#325. The four 909 kicks are refitted with the sound-match toolkit
(`scripts/sound-match/`, record `2026-10-01-sound-match-toolkit`) to
tacowars's chosen hits from Samples From Mars *TR-909 From Mars*. The first
fit (`docs/research/2026-09-30-kick-fit/`) predates the voice drive
(windsor#300, #309), sample-accurate envelope edges (windsor#301) and the
toolkit; this one uses all three. The recordings are a commercial pack and
stay outside the repository; only numbers measured from them and the
overlays below are here. The numbers say where a render differs; whether it
sounds right is tacowars's call, by ear.

Everything was measured on an Apple M1 (macOS 26.5.1), Node 24.21.0,
Python 3.14.5 (numpy, scipy, matplotlib, cma from the toolkit's
`requirements.txt`), against `origin/main` at `66685a1`.

## The references and the conditions

| Patch | Reference | tacowars's note |
|---|---|---|
| `tr909-kick-short` | `BD 909 Clean Short C 04.wav` | short medium kick, general purpose |
| `tr909-kick` | `BD 909 Clean Medium C 03.wav` | medium; even, good for harder techno |
| `tr909-kick-hard` | `BD 909 Clean Medium F 05.wav` | maximum punch, for hard techno and EDM |
| `tr909-kick-long` | `BD 909 Clean Long A 04.wav` | long and soft, for EDM and slower trance |

Every render is C4 (MIDI 60), velocity 1, no gate. The recordings carry
about 2.5 ms of near silence before their attack edge, so each is aligned on
the edge (`--ref-threshold-db -6 --ref-lead-ms 1.5`, the toolkit's 909
setting). No patch depends on its seed, so each is scored once. The scores
are the toolkit's, at its default weights (`stft` 1, `band` 0.1, `harm`
0.04, `pitch` 0.2, `wave` 2), lower is closer.

## What the recordings show

- **The body settles at 49.2–49.9 Hz, not 52.** The toolkit's track reads
  49.0–49.7 Hz from 80 ms on in all four. An independent check, the peak of
  a zero-padded FFT over 150–300 ms, gives 49.4 (Medium C 03), 49.9
  (Medium F 05) and 49.2 Hz (Long A 04; 49.2 Hz over 300–500 ms too), and
  48.7–49.3 Hz over 40–100 ms on Short C 04, whose body ends at about
  72 ms. The issue's "about 46 Hz by 80 ms" is not what either reading
  gives: 49.0 Hz at 80 ms on Medium C 03. The old patches held 51.9 Hz, so
  their tail sat about 0.8 semitones sharp. The refit plays **49.4 Hz on
  C4** (body ratio 0.188819, from 0.198425), one ratio for all four, as
  Tune moves only the sweep.
- **The lopsided body lives in the first cycles.** The negative
  half-cycle's peak over the positive's, by the toolkit's regions:

  | Recording | 5–30 ms | 30–150 ms | body (5 ms to the last cycle within 6 dB) |
  |---|---|---|---|
  | Short C 04 | 1.37 | 1.19 | 1.29 |
  | Medium C 03 | 1.35 | 0.80 | 1.19 |
  | Medium F 05 | 1.35 | 0.94 | 1.23 |
  | Long A 04 | 1.35 | 0.88 | 1.11 |

  The punch cycles are negative-heavy by 1.35 on every hit; later the
  ratio flips below 1, which is the recording chain's coupling recovering
  from that asymmetry (the toolkit's README notes the same of the tail).
  On Short C 04 the same recovery is visible after the body stops: a dip
  to −0.08 at 74 ms, a positive bump to +0.14 at 84 ms, then a slow
  positive offset decaying to 0 by 125 ms.
- **The opening is a negative step.** On all four the waveform goes from
  near silence straight to its negative peak, then rises.
- **Tune is the sweep's length.** At 20 ms: 96 Hz on C, 166 Hz on F,
  67 Hz on A.

## The structure

All four keep algorithm 6 (A, B and C carriers; D modulates C), and every
operator stays phase-locked.

- **A, the body:** a sine at ratio 0.188819, its start phase fitted
  (0.56–0.71 cycles, so it starts on its falling side), feedback fitted, an
  attack of 0.004–0.19 ms (fitted from 0), a hold (decay to sustain 1) and
  the trigger-mode release.
- **B, the edge:** `Square D` at a fixed frequency, **attack 0** (a step
  since windsor#301), its locked phase in the square's negative half, so
  the voice goes straight to its negative edge on the first sample. The fit
  placed it two ways: a short click (135 Hz, 0.7 ms decay, on `tr909-kick`)
  or a low square (23–37 Hz, 4.5–11 ms decay, on the other three). On
  `tr909-kick-short` and `tr909-kick-hard` its negative half outlasts its
  decay, a negative pulse under the first cycle; on `tr909-kick-long` it
  steps negative for 2.7 ms, then positive while it decays.
- **The pitch envelope** starts at its peak (Init 1), decays to a sustain
  level, then the release runs on to the base: two segments, which is how
  the sweep keeps falling after the punch.
- **Route (a), shipped:** the voice drive on, `soft`, with bias and gain
  fitted and its tone fitted.
- **C and D are silent** (level 0), the old FM layer retired. The filter is
  **Off** (it was a 12 kHz lowpass, kept only for the old drive).

## Decision 2: the two routes

Each route fitted from the same start (the structure above; route (a) with
the drive on, route (b) with the drive off and C as a sine at twice the
body ratio, its phase and level fitted and its envelope tied to A's), the
same parameters otherwise, CMA-ES seed 1, 8000 evaluations
(`specs/<kick>-a.json`, `specs/<kick>-b.json`):

| Kick | Route | total | harm (dB) | wave | body neg/pos (recording) | 5–30 ms neg/pos (recording) | body H2 re H1 (recording) |
|---|---|---|---|---|---|---|---|
| short | (a) drive + bias | 2.046 | 7.43 | 0.0046 | 1.58 (1.29) | 1.58 (1.37) | −15.7 (−27.8) dB |
| short | (b) 2nd harmonic | 2.030 | 5.52 | 0.0079 | 1.00 (1.29) | 1.00 (1.37) | −31.4 (−27.8) dB |
| medium | (a) | **1.184** | 10.23 | **0.0067** | 1.35 (1.19) | **1.35** (1.35) | −22.9 (−30.6) dB |
| medium | (b) | 1.203 | 10.41 | 0.0097 | 1.06 (1.19) | 1.06 (1.35) | −29.5 (−30.6) dB |
| hard | (a) | **1.356** | 10.25 | **0.0051** | 1.35 (1.23) | **1.35** (1.35) | −22.6 (−28.7) dB |
| hard | (b) | 1.589 | 10.22 | 0.0575 | 1.07 (1.23) | 1.08 (1.35) | −28.9 (−28.7) dB |
| long | (a) | 1.116 | 11.31 | **0.0068** | 1.40 (1.11) | **1.40** (1.35) | −21.8 (−30.9) dB |
| long | (b) | 1.110 | 11.12 | 0.0109 | 0.99 (1.11) | 0.99 (1.35) | −32.6 (−30.9) dB |

- **Waveform:** route (a) is closer on all four (`wave` 0.005–0.007
  against 0.008–0.058).
- **Symmetry:** route (a) reproduces the punch cycles' 1.35 on medium,
  hard and long (5–30 ms within 0.05) and overshoots the body average,
  because it stays lopsided where the recording flips. Route (b) never
  leaves 0.99–1.08: a second harmonic at the recording's level
  (−28 to −31 dB) can tilt the peaks by 6–8 % at most, and its
  phase cannot also lengthen the negative half, which the recordings'
  duration ratio (1.03–1.07) asks for. What makes the recording lopsided is
  a negative offset that follows the level, which is what a biased shaper
  produces.
- **Harmonic profile:** route (b) is closer in body H2 (within 4 dB,
  against route (a)'s 6–12 dB too much), and its `harm` score is lower on
  short, hard and long, higher on medium.
- **Total:** route (a) on medium and hard; route (b) by 0.006–0.016 on
  short and long.

**Route (a) is kept**: closer in waveform on all four and in the lopsided
punch cycles on three, at the price of too much H2 in the later body.
Neither route gets the body-average half-cycle ratio within 0.05 of the
recording's; what remains is below.

Also tried, and not kept:

- **`tube` for route (a).** In two exploratory fits on Medium C 03 (3000
  and 5000 evaluations, from an earlier version of these specs, not
  committed), `tube` scored 1.368 and 1.721 against `soft`'s 1.222 and
  1.351.
- **A highpass after the drive**, the coupling's analogue (filter mode
  highpass, cutoff 30–150 Hz and resonance fitted). Route (b) with it on
  Medium C 03 scored 1.238 against 1.203 without. Route (a) with it, at
  stage 2 below (fit totals including the level penalty), scored 2.296
  against 1.847 (short), 1.240 against 1.161 (medium), 1.137 against 1.020
  (hard) and 1.137 against 1.100 (long). The filter stays **Off**
  (decision 5). The engine floors the filter at 20 Hz and the knob at
  30 Hz, above a coupling corner (the Short C 04 recovery decays over about
  40 ms).

## The fit, in stages

- **Stage 1** (`specs/<kick>-a.json`): the route comparison above.
- **Stage 2** (`specs/<kick>-a.stage2.json`): from stage 1's best, the
  drive's tone added, gain widened to 1–4 and bias to 0–0.6, CMA-ES σ 0.1,
  4000 evaluations, under the level rule. With the drive on nothing after
  the shaper sets the level (volume comes before it), so the peak follows
  the fit; `fit_constrained.py` wraps the toolkit's `fit.py` and adds 2 per
  dB that the peak at velocity 1 lies more than 0.7 dB from the old
  patch's. `scripts/sound-match/` is unchanged.
- **Stage 3** (`specs/<kick>-a.stage3.json`): from stage 2's best, the
  body's attack (0–1 ms) added, tone opened to 0–1 and the release floor to
  5 ms, σ 0.06, 4000 evaluations. This is the shipped fit for `tr909-kick`,
  `tr909-kick-hard` and `tr909-kick-long`.
- **Stage 4, short only** (`specs/short-a.stage4.json`): stage 3 left the
  short kick's `band` at 7.03, worse than the old patch's 6.09 (below). It
  starts from stage 3's best with the body's release set to 50 ms and curve
  −0.5, and `fit_constrained.py` adds 1 per unit of `band` above 6.0.
  4000 evaluations, σ 0.06.

## Scores, before and after

"Before" is the patch on `main` against the same reference.

| Patch | total | stft | band (dB) | harm (dB) | pitch (st) | wave |
|---|---|---|---|---|---|---|
| `tr909-kick-short` | 6.525 → **2.641** | 0.683 → 0.348 | 6.09 → 6.05 | 48.9 → 8.0 | 15.79 → 6.76 | 0.0597 → 0.0078 |
| `tr909-kick` | 1.862 → **1.131** | 0.422 → 0.268 | 4.44 → 3.37 | 14.2 → 10.3 | 1.56 → 0.50 | 0.0588 → 0.0059 |
| `tr909-kick-hard` | 6.577 → **1.020** | 1.340 → 0.292 | 9.06 → 2.83 | 44.0 → 8.8 | 9.80 → 0.41 | 0.3043 → 0.0050 |
| `tr909-kick-long` | 3.245 → **1.078** | 0.622 → 0.225 | 4.32 → 3.43 | 14.9 → 11.4 | 3.35 → 0.22 | 0.4626 → 0.0052 |

No score ends worse than it started, in total or in any component. The
short kick's unconstrained stage 3 scored a lower total (1.821: stft 0.329,
band 7.03, harm 7.6, pitch 2.38, wave 0.0054) but a worse `band`; the
shipped stage 4 holds `band` under the old patch's at the cost of `pitch`
(below).

### Symmetry and H2

| Patch | body neg/pos, before → after (recording) | 5–30 ms neg/pos (recording) | body duration neg/pos (recording) | body H2 re H1, before → after (recording) |
|---|---|---|---|---|
| `tr909-kick-short` | 1.00 → 1.60 (1.29) | 1.60 (1.37) | 1.02 (1.06) | −38.1 → −13.9 (−27.8) dB |
| `tr909-kick` | 1.00 → 1.37 (1.19) | 1.37 (1.35) | 1.01 (1.07) | −37.0 → −22.3 (−30.6) dB |
| `tr909-kick-hard` | 1.00 → 1.43 (1.23) | 1.43 (1.35) | 1.01 (1.03) | −45.6 → −21.2 (−28.7) dB |
| `tr909-kick-long` | 1.00 → 1.41 (1.11) | 1.41 (1.35) | 1.00 (1.04) | −43.8 → −21.7 (−30.9) dB |

### Pitch on C4

The toolkit's track, recording / render in Hz (error in semitones). "—"
where the track has no cycle there: Medium C 03 has none at 5 ms (its
first cycle is the edge), and Short C 04 none after its body ends at 72 ms.

| Patch | 5 ms | 10 ms | 20 ms | 40 ms | 80 ms | 150 ms |
|---|---|---|---|---|---|---|
| `tr909-kick-short` | 191.0 / 192.8 (+0.16) | 152.0 / 149.6 (−0.27) | 96.1 / 96.6 (+0.08) | 58.9 / 58.7 (−0.05) | — / 49.4 | — / — |
| `tr909-kick` | — / 192.3 | 152.6 / 154.0 (+0.16) | 96.4 / 96.0 (−0.08) | 58.9 / 59.6 (+0.20) | 49.0 / 49.4 (+0.15) | 49.7 / 49.4 (−0.11) |
| `tr909-kick-hard` | 234.1 / 239.9 (+0.43) | 210.0 / 207.1 (−0.24) | 165.8 / 165.7 (−0.01) | 111.0 / 111.1 (+0.01) | 66.9 / 67.7 (+0.23) | 51.0 / 50.6 (−0.17) |
| `tr909-kick-long` | 153.0 / 163.5 (+1.15) | 112.3 / 111.3 (−0.15) | 66.9 / 66.8 (−0.02) | 50.1 / 49.4 (−0.25) | 49.1 / 49.4 (+0.09) | 49.1 / 49.4 (+0.10) |

Before, the same checkpoints were off by up to +3.2 st (short), +1.5 st
(medium), −10.7 st at 40 ms (hard, whose sweep was the C kick's) and
+8.0 st (long, the same).

### Level

Peak at velocity 1 on C4 (decision 7: within 1 dB):

| Patch | Before | After |
|---|---|---|
| `tr909-kick-short` | 0.664 | 0.718 (+0.69 dB) |
| `tr909-kick` | 0.649 | 0.637 (−0.17 dB) |
| `tr909-kick-hard` | 0.669 | 0.626 (−0.57 dB) |
| `tr909-kick-long` | 0.654 | 0.644 (−0.13 dB) |

## Overlays

`overlays/<patch>.png` is the toolkit's six-panel overlay of each shipped
patch on its reference (`compare.py --png`), and `overlays/<patch>-before.png`
the old patch on the same reference: black the recording, red the render.

## What remains, measured

- **The body-average half-cycle ratio** is 0.17–0.31 above the
  recording's, because the render stays lopsided (1.24–1.60 over
  30–150 ms) where the recording flips to 0.80–0.94. On the punch cycles
  (5–30 ms) it is within 0.02 on `tr909-kick`, 0.06 on `tr909-kick-long`,
  0.08 on `tr909-kick-hard` and 0.23 on `tr909-kick-short`. The negative
  half's duration is 1.00–1.02 of the positive's against 1.03–1.07.
- **Too much H2 in the body:** 7–14 dB above the recording (the bias), and
  H3 about 5 dB above (2.5 dB on the short kick).
- **The click above 1 kHz** (0–10 ms, re each peak): −5.0 against −11.9 dB
  on `tr909-kick` (7 dB hot), −8.1 against −10.3 (hard), −8.5 against
  −10.9 (long), −11.9 against −10.9 (short).
- **The short kick's end.** The recording's body stops at about 72 ms and
  the coupling's slow positive bump follows. No operator here makes that
  bump; the toolkit's `band` asks for energy there and its `harm` and
  `pitch` refuse tonal cycles past the recording's. Shipped, the short
  kick rings on at 49 Hz to about 90 ms (−40 dB at 91 ms against the
  recording's 121 ms, which is the bump); its pitch track runs 25 % past
  the recording's, about 6 of its 6.76 st.
- **`tr909-kick-long`'s first 5 ms** sit 1.15 st sharp (164 against
  153 Hz).
- **The kicks play 49.4 Hz on C4, not 52 Hz**, as the recordings do. A
  song that kept a 909 kick in tune with its key at 52 Hz hears it about a
  semitone flat after it reloads these patches; its own saved snapshot
  does not change.

### Engine limits met

- **No gain after the drive.** Level and saturation are one control with
  the drive on, so the level rule had to be a constraint on the fit, not a
  `volume` match afterwards.
- **The console's Attack knob floors at 0.5 ms.** The edge's attack is 0
  and the bodies' 0.004–0.19 ms; the knob shows them at its floor, and
  turning it writes at least 0.5 ms.
- **The voice filter floors at 20 Hz** (30 Hz on the knob), too high to
  stand in for the chain's coupling.
- **The pitch envelope's levels are 0–1 on the console**, so the sweep
  cannot dip below the base; the recordings' tails do not ask it to.

### CPU

The filter is off (it was on); the drive was on before and stays on, now
with its tone pole running; C and D are silent. Nothing was measured.

## Reproducing

From `scripts/sound-match/`, with the toolkit's venv and
`SM_909_KICKS` pointing at the folder holding the four WAVs (the specs read
`$SM_909_KICKS/<name>.wav`):

```bash
python fit.py ../../docs/research/2026-10-01-tr909-kick-refit/specs/medium-a.json --out-dir <dir>
python ../../docs/research/2026-10-01-tr909-kick-refit/fit_constrained.py \
  ../../docs/research/2026-10-01-tr909-kick-refit/specs/medium-a.stage3.json --out-dir <dir>
python compare.py "$SM_909_KICKS/BD 909 Clean Medium C 03.wav" tr909-kick \
  --ref-threshold-db -6 --ref-lead-ms 1.5 --png
```

Each stage's start patch is in `start/`: stage 1's was built by hand from
the old patch (the structure above), each later one is the previous
stage's `best.json` (the short kick's stage 4 with its release moved as
described). Stage 1 and the route-(b) fits run under the toolkit's
`fit.py`; stages 2–4 under `fit_constrained.py`. The shipped files are
those `best.json` patches written at six significant figures; the scores
above are of the shipped files.
