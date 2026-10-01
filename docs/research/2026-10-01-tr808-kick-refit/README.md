# The 808 kicks refitted, click first

windsor#324: `tr808-kick-short`, `tr808-kick` and `tr808-kick-long` fitted
again, to tacowars's picks from Samples From Mars *808 From Mars*, now that
an operator envelope can step (windsor#301, `2026-10-01-envelope-edges-at-sample-rate`)
and the voice has its own drive (windsor#300 / #308 / #311,
`2026-10-01-voice-drive-stage`). The first fit
(`docs/research/2026-09-30-kick-fit/`) reached about a sixth of the
recording's click. The decision is `docs/log/2026-10-01-tr808-kicks-refitted.md`.

The recordings are a commercial pack and stay outside the repository; only
numbers measured from them, and the overlays, are here. The numbers say
where a render differs; whether it sounds right is tacowars's call by ear.

Measured on an Apple M1 (macOS 26.5.1), Node 24.21, Python 3.12.9, with the
sound-match toolkit (`scripts/sound-match/`, record
`2026-10-01-sound-match-toolkit`) at `origin/main` `66685a1`.

## References and conditions

| Patch | Reference (tacowars's `tr-refs.txt`) | Note |
|---|---|---|
| `tr808-kick-short` | `BD A 808 Decay A 03.wav` | medium tone, short; minimal Berlin hypnotic techno |
| `tr808-kick` | `BD A 808 Decay C 06.wav` | bright tone, medium decay; warm with a strong click |
| `tr808-kick-long` | `BD A 808 Decay D 04.wav` | medium/bright, long decay; slower 808-focused electro |

Every render is C4 (MIDI 60), velocity 1, no gate, seed 1 (no kick depends
on its seed), aligned and normalised by the toolkit's defaults. Scores are
the toolkit's at its default weights (`stft` 1, `band` 0.1, `harm` 0.04,
`pitch` 0.2, `wave` 2), lower is closer. "0–5 ms above 2 kHz" is the
report's level above 2 kHz over the first 5 ms, render minus recording.
The old patches were fitted to Decay B, C and E at Tone 03, so the short
and long "before" rows are against recordings they were not fitted to.

## Before and after

| Patch | total | stft | band (dB) | harm (dB) | pitch (st) | wave | 0–5 ms above 2 kHz |
|---|---|---|---|---|---|---|---|
| `tr808-kick-short` | 6.488 → **0.830** | 0.767 → 0.188 | 7.92 → 2.32 | 66.8 → 1.8 | 11.02 → 1.64 | 0.0270 → 0.0056 | −5.7 → **−0.6 dB** |
| `tr808-kick` | 1.308 → **0.527** | 0.301 → 0.187 | 3.26 → 2.25 | 12.5 → 2.0 | 0.71 → 0.11 | 0.0204 → 0.0078 | −18.9 → **−0.9 dB** |
| `tr808-kick-long` | 4.516 → **0.538** | 0.754 → 0.137 | 9.36 → 1.69 | 66.3 → 4.3 | 0.57 → 0.13 | 0.0291 → 0.0161 | −9.6 → **+1.2 dB** |

No score ends worse, in total or in any component. The short and long
`harm` and `pitch` before were mostly coverage penalties: the old decays
were three and two times the recordings'.

The click, more directly: the toolkit's click peak above 1 kHz over the
first 10 ms (dB re each signal's peak), and the largest change over 0.1 ms
at the onset and after it (0.6–2 ms, where the recording's trigger pulse
ends), as a share of the peak:

| Patch | Click peak, recording / before / after | Onset edge, recording / before / after | Pulse-end edge, recording / after |
|---|---|---|---|
| `tr808-kick-short` | −16.0 / −19.3 / −15.6 dB | 0.41 / 0.20 / 0.29 | 0.16 at 1.07 ms / no edge (0.11 slope) |
| `tr808-kick` | −5.3 / −19.9 / −6.7 dB | 0.85 / 0.19 / 0.71 | 0.32 at 1.05 ms / no edge (0.16 slope) |
| `tr808-kick-long` | −15.5 / −21.3 / −15.1 dB | 0.42 / 0.18 / 0.27 | 0.15 at 1.05 ms / no edge |

### Body pitch on C4, 40–150 ms

Acceptance: within 0.3 semitones of the recording. Two readings, since the
short recording's track alternates half-cycle to half-cycle (49.6, 46.7,
55.3, 44.8, 51.5 Hz over 40–80 ms) as its pitch sags: the median of the
toolkit's pitch track, and the spectral peak (Hann window over 40–150 ms,
zero-padded), as the TR percussion fit read its two-tone voices.

| Patch | Track median, recording / after | Spectral peak, recording / after | Before (track) |
|---|---|---|---|
| `tr808-kick-short` | 49.62 / 49.88 Hz (+0.09 st) | 50.17 / 49.62 Hz (−0.19 st) | +0.78 st |
| `tr808-kick` | 51.20 / 51.41 Hz (+0.07 st) | 51.45 / 51.64 Hz (+0.06 st) | +0.24 st |
| `tr808-kick-long` | 52.33 / 52.27 Hz (−0.02 st) | 52.37 / 52.37 Hz (+0.00 st) | −0.14 st |

### Level

Peak at velocity 1 on C4 (decision 5: within 1 dB of the patch on `main`).
`volume` was set by bisection for `main`'s peak before the last fit of each,
which then moved the peak a little:

| Patch | Before | After |
|---|---|---|
| `tr808-kick-short` | 0.578 (−4.76 dBFS) | 0.626 (−4.07 dBFS, +0.69 dB) |
| `tr808-kick` | 0.604 (−4.39 dBFS) | 0.624 (−4.10 dBFS, +0.29 dB) |
| `tr808-kick-long` | 0.615 (−4.22 dBFS) | 0.636 (−3.93 dBFS, +0.29 dB) |

## The click candidates (decision 2)

Three candidates, plus (n) no click operator, for operator C, a `Square D`
carrier beside the body (algorithm 4, D>C | B>A, with D silent):

- **(a)** tacowars's width squeeze: a low fixed frequency (5–200 Hz) squeezed
  to Width 0.05–0.3, at a locked phase, a decay of 1–100 ms;
- **(b)** a zero-attack edge: a fixed 10–400 Hz, locked phase, attack 0, a
  decay of 0.1–2 ms;
- **(c)** a flat pulse: a `Square D` at 1 Hz (a DC level), its envelope
  starting at 1 (Init 1), held 0.2–2 ms by the attack segment, then a
  0.05–1 ms decay to 0.

In every candidate the body (A) may also step: its attack may be 0 and its
locked start phase is free, so a body that starts mid-swing opens on a
step by itself.

**Stage 2, the comparison.** One body per kick (that kick's best stage-1
fit), each candidate fitted on it with only the onset free: the body's and
knock's start phases, the body's attack and its curve, the drive's tone
and the candidate's own numbers (800 evaluations each,
`specs/<kick>.click-<a|b|c|n>.json`):

| Kick | (a) wave / 0–5 ms >2 kHz | (b) | (c) | (n) none | Kept |
|---|---|---|---|---|---|
| `tr808-kick-short` (Decay A 03) | 0.0026 / +1.9 dB | **0.0024 / +1.4 dB** | 0.0033 / +2.6 dB | 0.0026 / +1.5 dB | (b) |
| `tr808-kick` (Decay C 06) | 0.0163 / −5.6 dB | 0.0341 / +4.0 dB | **0.0158 / −0.2 dB** | 0.0315 / −8.7 dB | (c) |
| `tr808-kick-long` (Decay D 04) | **0.0178 / +1.2 dB** | 0.0224 / −0.6 dB | 0.0178 / +5.3 dB | 0.0184 / +2.5 dB | (a), which fitted itself silent |

Totals in the same order: short 0.698, 0.702, 0.690, 0.696; kick 0.557,
0.662, 0.546, 0.686; long 0.765, 0.768, 0.765, 0.767.

- **Decay C 06, the strong click:** (c) is closest on both. Its fit holds
  the pulse 1.9 ms and lets it fall over 1 ms while the body, starting at
  0.41 of a cycle (+0.51, falling) with no attack, makes the opening step.
  (a) reached a similar waveform with a decaying step rather than a hold,
  and missed 5.6 dB above 2 kHz; (b)'s spike overshot the high band and
  doubled the waveform error.
- **Decay A 03:** the four are within 0.0009 in waveform and 1.2 dB above
  2 kHz: this recording's click is mild (−16 dB above 1 kHz against −5 dB
  at Tone 06) and the body's own onset carries it. (b) is closest on both
  and ships, a 0.1 ms tick at level 0.235.
- **Decay D 04:** (a) and (c) tie on waveform and (a) is closer above
  2 kHz; (b) is closer above 2 kHz but 26 % worse on waveform. (a) was
  kept, but its fit put the squeezed square's start phase (0.59) past its
  width (0.13), so the operator is silent until 14 ms, long after its
  1.7 ms envelope: the result is (n) with a better-fitted onset. The
  shipped patch has C at level 0 (rendering bit for bit the same), its
  width and phase reset so that raising it gives a plain step.

**Stage 1, each candidate in a full fit** (`specs/<kick>.<a|b|c>.json`,
every number free, 2500 evaluations): total, wave, 0–5 ms above 2 kHz.

| Kick | (a) | (b) | (c) |
|---|---|---|---|
| short | 0.757, 0.0019, −3.4 dB (C at level 0.006: off) | 1.240, 0.0092, +4.4 dB | 1.227, 0.0136, +2.4 dB |
| kick | 0.787, 0.0112, +1.2 dB | 0.733, 0.0088, +1.3 dB | 0.596, 0.0244, −3.6 dB |
| long | 0.799, 0.0162, +1.3 dB | 0.799, 0.0145, +0.5 dB | 0.772, 0.0218, +0.2 dB |

The full fits land on different bodies, so they confound the click with
the rest; stage 2 holds the body fixed, and its numbers made the choice.
tacowars's width squeeze, as a mechanism, works: it gives a one-sided
pulse at a locked phase. On these recordings a held DC level (c) or the
body's own step fitted closer.

## How the patches were fitted

Algorithm 4 as before: A the body sine, B a short FM knock into it at the
same ratio, both phase-locked (decision 3); C the click; D silent. The
filter is Off and the voice drive on (`drive.on`). Each stage starts from
the previous stage's best; `start/` holds every spec's start patch.

| Stage | What moves | Specs |
|---|---|---|
| 1 | everything, per candidate, filter Off, drive Soft | `<kick>.a`, `.b`, `.c` |
| 2 | the onset and each candidate's click, on that kick's best stage-1 body | `<kick>.click-a`, `-b`, `-c`, `-n` |
| level | `volume` set by bisection for `main`'s peak | (`stage4-frozen` starts) |
| 4 | the body, knock, pitch envelope and drive bias, with the click, the body's start phase and attack and the drive tone frozen at stage 2; `wave` weighted 6 and `pitch` 0.5 | `<kick>.stage4-frozen` |
| shape | stage 4 again from its result with another drive shape; ships for the 808 Kick only | `<kick>.shape-diode`, `tr808-kick.shape-tube` |
| checks | stage 4 with the drive off; the filter on (from stage 3) | `<kick>.drive-off`, `tr808-kick.stage3-filter` |
| short | stage 5 (ratio down to 0.15, pitch amount to 36), level match, stage 7 (pitch weighted 2, ratio fixed at 0.1905), level match, stage 8 (the same) | `tr808-kick-short.stage5`, `.stage7-fixed`, `.stage8` |

- **Why stage 4 freezes the onset.** A refit with everything free at the
  default weights (`tr808-kick.stage3`) gave up the click for the body:
  total 0.571, but 0–5 ms above 2 kHz fell to −19.2 dB, the body's attack
  grew to 1.1 ms, and the waveform error rose to 0.0218. Decision 2 puts
  the click first, so the stage-2 onset stays and the rest is fitted around
  it.
- **The short kick's pitch.** Its stage-5 fit scored 0.617 but sat its body
  at 51.9 Hz, 0.78 semitones above the recording's 40–150 ms track: the
  toolkit's scores prefer it there, the acceptance criterion does not. The
  ratio was fixed lower (stages 7 and 8, body 50.7 Hz), then a sweep of
  stage 8's ratio found 0.1876 better in total and on the body (total
  0.901 → 0.830, track +0.37 → +0.09 st, waveform 0.0069 → 0.0056), though
  the toolkit's `pitch` score rose from 1.10 to 1.64, and that is the
  shipped patch
  (`start/tr808-kick-short.stage9.json`; a refit at that ratio,
  `specs/tr808-kick-short.stage9.json`, scored 0.989 at the default
  weights and was not used).
- **Rounding.** The library files carry six significant figures.

## Drive and filter (decision 3)

- **Drive.** Every fit kept the drive near unity gain (1.0004–1.14) with a
  small positive bias (0.07–0.17): the body's lopsided half-cycles and its
  H2 come from the bias. Since `volume` and `drive.gain` meet only as a
  product before the shaper, level matching set how hard each kick is
  driven. Each kick's last stage was also refitted with the drive off
  (`<kick>.drive-off`, from the matched level, 1500 evaluations): total,
  wave and 0–5 ms above 2 kHz against the shipped patch, the 808 Kick
  0.591, 0.0143, +1.6 dB against 0.527, 0.0078, −0.9 dB; the long kick
  0.835, 0.0146, +1.2 dB against 0.538, 0.0161, +1.2 dB, with its body
  0.40 semitones sharp; the short kick 0.834, 0.0086, +1.6 dB against 0.830,
  0.0056, −0.6 dB, its body 0.43 semitones sharp. The drive stays on.
- **Shape.** On the 808 Kick, the Diode shape refitted to 0.527 against
  Soft's 0.585, closer on both click numbers (waveform 0.0078 against
  0.0100, −0.9 against +1.5 dB above 2 kHz) and H2 (body H2 −3.7 dB against
  −6.8 dB); it ships. Tube refitted to 0.598. On the long kick, Diode
  refitted to 0.450 against 0.538 but further on both click numbers
  (0.0168, +2.1 dB against 0.0161, +1.2 dB), so Soft stays; on the short
  kick it scored worse everywhere (0.976). The Diode shape costs about five
  times a bypassed voice render
  (`docs/research/2026-10-01-voice-drive/README.md`), here on one mono
  voice.
- **Filter.** With a lowpass on (cutoff and resonance free) the 808 Kick's
  refit scored 0.583 against 0.571 Off (`tr808-kick.stage3-filter` against
  `.stage3`). Every kick ships with the filter Off.

## Remaining differences

- **The trigger pulse's end.** The recording drops by 0.32 of its peak
  within 0.1 ms at 1.05 ms; the 808 Kick falls over about 1 ms instead.
  By hand, on the fitted patch: a hold of 0.9–1.1 ms, a decay of
  0.05–0.2 ms, C's level 0.4–0.85 and the body's start phase 0.38–0.44 (108
  renders) at best scored waveform 0.0165 and total 0.649 against the
  Soft patch's 0.0100 and 0.585. The body's first half-cycle after the pulse
  differs from the machine's, and a sharp end leaves a gap the slow fall
  bridges. Not an engine limit: the envelope can make that edge.
- **The first cycle is the loudest.** The renders peak at 4 ms in the punch
  cycle; the recordings at 16 ms in the body (the toolkit's level envelope).
  The punch's level is the drive's ceiling.
- **Body harmonics.** H3 is about 8 dB high in the body of the 808 Kick
  and long kick (5–67 and 5–124 ms), and the negative half-cycles are
  1.11–1.12 of the positive against 1.30–1.31 in 5–30 ms: an
  odd-symmetric curve with a small bias does not make the body as lopsided
  as the recording without more H3.
- **Decay shape.** The 808 Kick reaches −20 dB at 230 ms against 279 and
  −40 dB at 536 against 556; the long kick −40 dB at 1154 ms against 1056.
- **5–30 ms above 2 kHz** is 13.5 dB low on the 808 Kick and 6.6 dB on the
  long kick: the recordings' clicks ring longer than the fitted edges.
- **Pitch at control rate.** The pitch envelope moves once per 32 samples
  (0.67 ms), so the 6–7 ms punch steps about ten times. Nothing measured
  here points at it.

## Engine limits met

None new that the numbers isolate. The two the first fit met are gone: an
envelope edge is now a step (the 808 Kick's onset measures 0.71 of the
peak against the recording's 0.85, from 0.19), and the drive runs with the
filter Off. What may be one is the body's lopsidedness: Soft and Diode
are odd-symmetric and get their even harmonics only from the bias, which
stayed at 0.07–0.17 though up to ±0.6 was open to every fit; Tube adds an
even term of its own and refitted worse on the 808 Kick (0.598). The
negative half-cycles stay at 1.11 of the positive against the recording's
1.31.

## Reproducing

From `scripts/sound-match/`, with the toolkit's venv (its README) and
tacowars's picks in the environment:

```bash
export SM_TR_REFS=<…>/windsor-tr-refs
python fit.py ../../docs/research/2026-10-01-tr808-kick-refit/specs/<spec>.json
python compare.py "$SM_TR_REFS/BD A 808 Decay C 06.wav" tr808-kick --png
```

A later stage's start is the earlier stage's `best.json`, with `volume` set
for `main`'s peak where the table says "level match"; `start/` holds each
as used. CMA-ES with a fixed seed repeats on the same machine.

## Overlays

The toolkit's six panels per kick, recording in black, render in red:
`overlays/<patch>.png`.
