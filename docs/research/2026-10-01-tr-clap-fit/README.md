# The 808 and 909 claps fitted to recordings

windsor#352, Wave 3 of the TR matching: `tr808-clap` and `tr909-clap`
fitted with the sound-match toolkit (`scripts/sound-match/`, record
`2026-10-01-sound-match-toolkit`) to tacowars's picks from Samples From
Mars, and their bursts moved off the LFO so the Rate knob covers every
value they ship. The decision is `docs/log/2026-10-01-tr-claps-fitted.md`.

The recordings are a commercial pack and stay outside the repository; only
numbers measured from them, and the overlays, are here. The numbers say
where a render differs; whether it sounds right is tacowars's call by ear.

Measured on an Apple M1 (macOS 26.5.1), Node 24.21, Python 3.14.5. The
fits ran against `origin/main` at `12c1ac3`; the final scores were read
again after rebasing onto `f1d5562`, whose FM worklet bundle is the same,
and came out identical.

## References and conditions

| Patch | Reference | tacowars's note |
|---|---|---|
| `tr808-clap` | `Clap A 808.wav` (808 From Mars) | 808 clap, non-accented |
| `tr909-clap` | `Clap 909 Clean.wav` (TR-909 From Mars) | 909 clap, essential sound for hard techno |

Both are 44.1 kHz, 32-bit, mono, 1148 and 1213 ms long. Every render is C4,
velocity 1, no gate, aligned and normalised by the toolkit's defaults.
Both patches draw noise, so each is scored over seeds (the toolkit's 4 in
the fits; 16 in the tables below, seeds 1–16, since a fit's own 4 seeds
read optimistic). Live playback keeps `Math.random`: every hit differs.
Scores are the toolkit's at its default weights (`stft` 1, `band` 0.1,
`wave` 2; `harm` and `pitch` do not apply to a noise voice), lower is
closer.

## Structure of the recordings (decision 2)

`structure.py` (this folder) splits each recording at its onsets (a rise of
12 dB or more in the 0.25 ms peak envelope, in the first 45 ms, above
−20 dB) and reads each segment: its peak and first-millisecond RMS re the
file's peak, how long its RMS takes to fall 10 and 20 dB, and the colour of
its noise over its first 8 ms (the tail over 0–60 and 60–250 ms): the
1/3-octave-smoothed spectral peak, its −3 dB band, the centroid, and the
level at 0.5, 1, 2, 4 and 8 kHz re the peak.

### 808 clap

| Segment | Onset | Gap | Peak | First ms | −10 / −20 dB | Peak Hz | −3 dB band | Centroid | dB at 0.5 / 1 / 2 / 4 / 8 kHz |
|---|---|---|---|---|---|---|---|---|---|
| burst 1 | 0 ms | — | 0.0 dB | −10.0 dB | 1.0 / 4.0 ms | 1612 | 1476–1921 | 3336 | −8.7 / −3.9 / −4.2 / −8.8 / −19.1 |
| burst 2 | 10.9 | 10.9 | −4.0 | −9.9 | 2.5 / 7.5 | 1352 | 1159–1526 | 2851 | −15.1 / −1.5 / −8.3 / −13.6 / −15.2 |
| burst 3 | 23.4 | 12.5 | −0.3 | −9.9 | 1.5 / — | 941 | 764–1097 | 2419 | −16.5 / −0.6 / −4.9 / −12.8 / −20.0 |
| tail, 0–60 ms | 30.5 | 7.1 | −3.4 | −15.3 | 33 / 57 | 1085 | 910–1225 | 2897 | −16.5 / −0.2 / −6.7 / −11.5 / −18.7 |
| tail, 60–250 ms | | | | | | 972 | 789–1159 | 1322 | −10.0 / −0.2 / −14.1 / −21.4 / −29.2 |

Tail level, 5 ms RMS re its loudest 5 ms (its first): −20 dB at +70 ms,
−40 dB at +240 ms (0.12 dB/ms between them). The first 0.5 ms is the
loudest moment of the hit: full level within 4 samples, then down about
14 dB by 0.6 ms.

### 909 clap

| Segment | Onset | Gap | Peak | First ms | −10 / −20 dB | Peak Hz | −3 dB band | Centroid | dB at 0.5 / 1 / 2 / 4 / 8 kHz |
|---|---|---|---|---|---|---|---|---|---|
| burst 1 | 0 ms | — | −0.4 dB | −7.6 dB | 3.5 / 4.5 ms | 1016 | 807–1323 | 2571 | −11.8 / −0.0 / −5.0 / −10.7 / −16.1 |
| burst 2 | 11.3 | 11.3 | −0.2 | −5.0 | 4.0 / 7.5 | 843 | 723–983 | 1941 | −22.0 / −3.5 / −12.0 / −15.2 / −25.3 |
| burst 3 | 23.8 | 12.5 | −0.6 | −7.0 | 5.0 / — | 941 | 789–1122 | 2507 | −14.0 / −0.4 / −7.1 / −14.4 / −18.5 |
| tail, 0–60 ms | 30.1 | 6.3 | 0.0 | −6.5 | 17.5 / 35 | 972 | 825–1122 | 2120 | −15.6 / −0.4 / −7.8 / −15.3 / −22.3 |
| tail, 60–250 ms | | | | | | 755 | 627–1085 | 956 | −8.5 / −1.4 / −16.1 / −29.0 / −41.6 |

Tail level: its loudest 5 ms at +5 ms, −20 dB at +60 ms, −40 dB at +275 ms
(0.09 dB/ms). The 909's bursts hold near full level for 3–4 ms before they
fall, where the 808's fall at once.

### What the structure says

- **Three bursts and a tail, unevenly spaced**, on both machines: gaps of
  10.9, 12.5 and 7.1 ms (808) and 11.3, 12.5 and 6.3 ms (909). One LFO
  cannot place them: its period is one number, and the tail's onset 6–7 ms
  after the third burst is not on its grid.
- **One band, about 1 kHz, with steep low and gentle high sides**: below
  the peak the level drops 9–22 dB by 500 Hz, above it 5–12 dB by 2 kHz and
  15–25 dB by 8 kHz, and the late tail is darker still (8 kHz at −29 and
  −42 dB). The bursts' −3 dB bands give a Q of about 3, but their skirts are
  those of a much broader filter.

## Decision 3: the bursts from envelopes, not the LFO

Three structures, each fitted for 700 evaluations from a start built from
the table above, with the same filter (2-pole bandpass) and drive:

- **(a) `init`**, shipped: algorithm 5. D is the one Noise operator; A, B
  and C are sines it phase-modulates into white noise (below), each under
  its own envelope. A plays burst 1 and burst 2: Init 1 falling through
  the attack to 0, then a step up to the sustain level at burst 2's onset
  (a decay of 0), and the release is burst 2's fall. B is burst 3 and C the
  tail: silent through an attack as long as the onset, a step, and the
  release as the fall. All Trigger mode. The LFO is off.
- **(a′) `loop`**: A in Loop mode (attack 0, the decay its fall), so bursts
  1–3 are one period apart; a one-shot square LFO at 14–20 Hz mutes it
  after the third; B the tail; C a 0.5 ms tick on burst 1.
- **(b) `lfo`**: the shipped structure (a saw-down LFO gating the burst
  noise, a separate tail operator), its rate free over 70–120 Hz, as a
  widened Rate knob would allow.

Combined objective (the full recording plus its first 40 ms, below), fit's
4 seeds:

| | (a) `init` | (a′) `loop` | (b) `lfo` |
|---|---|---|---|
| `tr808-clap` | **2.009** (full 1.568, head 2.450) | 2.058 (1.552, 2.563) | 2.353 (1.813, 2.893) |
| `tr909-clap` | 2.009 (1.509, 2.509) | 2.006 (1.561, 2.452) | **1.944** (1.534, 2.354) |

Onsets of the fitted renders (`structure.py`, seeds 1 and 2), against the
recordings' 0 / 10.9 / 23.4 / 30.5 and 0 / 11.3 / 23.8 / 30.1 ms:

| | (a) `init` | (b) `lfo` |
|---|---|---|
| `tr808-clap` | 0 / 11.1–11.3 / 23.3–23.5 / 30.8 | 0 / 7.6–9.1 / 18.3 / 27.0 / 36.4: five even bursts, no tail onset |
| `tr909-clap` | 0 / 10.8 / 24.6 / 30.7 | 0 / 10.8–11.0 / 22.3 / 42.6 (seed 1); seven segments (seed 2): no tail onset |

(a) reproduces the measured bursts: three, at their own onsets, and a tail
that starts on its own. (b) can only space them evenly; on the 808 its fit
went to 110 Hz and five bursts, and on the 909 it scores 0.065 better by
smearing the tail into a fourth burst 11 ms after the third. (a) ships for
both; the LFO is off and its Rate (5 Hz) is inside the knob. The two TR
claps leave `KNOWN_MISSES`; `efm-clap` stays, its 100 Hz square gate
untouched (the Rate knob is not widened). (a′) scored with (a) but breaks
the bank's Trigger-mode rule: a note-off before the third burst would end
the loop, so a very short gate would lose bursts.

### Why sines and a Noise modulator

The fixed-index kernel renders a voice with two or more Noise operators
only on algorithms 0, 3 and 8, which have at most two carriers, and
`fmProcessorKernel.test.ts` holds every library patch to the kernel; four
Noise carriers on algorithm 7 fall back to the generic loop. A sine
phase-modulated by uniform noise of half-width β is
`sin θ · sin β / β` plus white noise, so at β = π (Noise level
√(1/8) = 0.35355, since the modulation is level² × 4 cycles) the carrier's
line vanishes and the output is white noise under the carrier's own
envelope (`fm_noise_probe.py`):

| Source (1 kHz carrier, filter off) | Line share | −3 dB band | dB at 0.5 / 1 / 2 / 4 / 8 kHz |
|---|---|---|---|
| FM, Noise level 0.2 | 0.73 | the line | −25.6 / −0.5 / −25.5 / −24.9 / −24.8 |
| FM, Noise level 0.3 | 0.16 | the line | −14.0 / −0.5 / −14.0 / −13.5 / −13.4 |
| FM, Noise level 0.35355 | 0.01 | flat | −2.2 / −0.7 / −2.2 / −1.8 / −1.6 |
| FM, Noise level 0.5 | 0.01 | flat | −1.4 / −0.4 / −2.3 / −1.3 / −1.9 |
| Noise into the 2-pole bandpass, Reso 2 | 0.05 | 764–1225 | −10.0 / −0.8 / −9.2 / −18.2 / −24.7 |

So one Noise operator feeds three independently enveloped noise carriers,
and the kernel takes the voice.

## Decision 4: noise colour from the filter, not FM

FM-coloured noise is a line plus a white floor at every depth (the table
above), never a band; its "band" is the line. The comparison, on the
shipped structure:

- **Filter shape** (each 700 evaluations from the same start, combined
  objective): 2-pole highpass with the drive's tone pole **1.885 / 1.925**
  (808 / 909), 2-pole bandpass 2.009 / 2.009, 4-pole highpass with the tone
  pole 1.913 / 2.102, 4-pole bandpass 2.280 / 2.449. The highpass's
  resonance makes the peak and its steep low side, the tone pole the gentle
  high side: the recordings' shape.
- **The noise held white against left free** (stage 2, 1000 evaluations
  each from the highpass fit): free, the Noise level went to 0.394 (808)
  and 0.428 (909), which lets a 1 kHz line through, and scored better over
  16 seeds on the full recording (808 1.515 against 1.538, 909 1.553
  against 1.583) and the same or better on the head (2.268 against 2.317,
  2.282 against 2.279). The line is a tone: over 30–200 ms its strongest
  bin within 990–1010 Hz stands 18.4 and 21.0 dB above the median of
  800–1200 Hz, where the recordings show 7.6 and 6.9 dB (the largest of a
  few noise bins) and the white fits 2.0 and 2.4 dB. The recordings have no
  line, so the scores' gain is the line standing in for the narrow band;
  the noise ships white (Noise level 0.353553) and the filter colours it.

## The transient and the head reference

The first 40 ms of each recording (bursts 1–3 and the tail's onset) is a
second reference in every spec, at the same weight as the whole: a
`$SM_CLAP_HEADS/clap808-head.wav` and `clap909-head.wav`, cut outside the
repository by

```bash
python -c "
import audio, numpy as np, scipy.io.wavfile as w
for n, f in (('clap808', 'Clap A 808.wav'), ('clap909', 'Clap 909 Clean.wav')):
    x = audio.load_wav(f'$SM_TR_REFS/{f}')
    w.write(f'$SM_CLAP_HEADS/{n}-head.wav', 48000, x[:int(0.040 * 48000)].astype(np.float32))"
```

(from `scripts/sound-match/`). The full recording's scores are still the
ones reported below.

## Scores, before and after

"Before" is the patch on `main`. Seeds 1–16, mean; every component of the
shipped patch is at or below the old one, against the whole recording and
against its first 40 ms.

| Patch | Reference | total | stft | band (dB) | wave |
|---|---|---|---|---|---|
| `tr808-clap` | whole | 2.404 → **1.549** | 1.643 → 1.107 | 6.17 → 3.76 | 0.0718 → 0.0331 |
| | first 40 ms | 3.509 → **2.331** | 2.142 → 1.464 | 12.23 → 8.01 | 0.0718 → 0.0331 |
| `tr909-clap` | whole | 1.860 → **1.625** | 1.043 → 0.946 | 6.13 → 5.29 | 0.1022 → 0.0751 |
| | first 40 ms | 2.737 → **2.302** | 1.615 → 1.378 | 9.18 → 7.72 | 0.1022 → 0.0758 |

### The transient, on its own

The toolkit's 0–5 ms region (level, and level above 2 kHz, render minus
recording, each normalised to its own peak) and its click (the peak above
1 kHz in the first 10 ms, dB re the signal's peak):

| Patch | 0–5 ms level, before / after | 0–5 ms above 2 kHz | Click, recording / before / after |
|---|---|---|---|
| `tr808-clap` | +6.0 / **+0.4 dB** | +1.9 / **+0.9 dB** | −2.9 / −3.0 / −5.5 dB |
| `tr909-clap` | +1.0 / −2.9 dB | −1.4 / **−1.0 dB** | −2.1 / −2.8 / −5.1 dB |

Mixed. The 808's first 5 ms come to within half a decibel of the
recording's level, and both are closer above 2 kHz; but the first burst is
quieter against the hit's peak than on either the recording or the old
patch, by 2.5–3 dB at the click. The recordings open at full level within
4 samples, the loudest moment of the 808 hit; here burst 1 rises over the
first control block (below), and the loudest moment is burst 3. Two
attempts to bring it closer found nothing better:

- **Burst 1 on a step** (`<clap>.edge`, level held): A in Loop mode with an
  attack of 0, which steps at the first sample, its decay the fall, so it
  steps again one decay later for burst 2; a one-shot square LFO at 22–40 Hz
  mutes it after that. The fits turned A down (level 0.50 and 0.38) rather
  than up: whole recording 1.587 and 1.586, first 40 ms 2.324 and 2.425
  (16 seeds), click −6.1 dB on both. It also breaks the bank's Trigger-mode
  rule.
- **The first 40 ms at three times the weight** (`<clap>.stage4`, level
  held, 600 evaluations from the shipped fit): no evaluation beat its start.

### Level

Peak at velocity 1 on C4, mean over seeds 1–8 (decision: within 1 dB of
`main`): `tr808-clap` −9.54 → −10.22 dBFS, `tr909-clap` −7.84 →
−8.35 dBFS. The fits held the peak over their own seeds 1–4 (−9.70 and
−8.10); seeds 5–8 sit lower.

### Onsets of the shipped patches

`structure.py` on renders at seeds 1–4, against the recordings:

| Patch | Bursts 2 and 3, tail (ms after burst 1) | Recording |
|---|---|---|
| `tr808-clap` | 10.5–10.9, 22.6–22.8, 30.6–30.8 | 10.9, 23.4, 30.5 |
| `tr909-clap` | 10.5–10.7, 22.6–22.8, 29.7–30.1 (seeds 1 and 3; on 2 and 4 the tail merges with burst 3) | 11.3, 23.8, 30.1 |

Each step lands up to 0.67 ms late in the envelope's own terms (below), so
the fit moved the onsets earlier than measured.

## What ships

Algorithm 5 with D the Noise modulator at 0.353553 (velocity sensitivity 0,
so its depth, and the noise's whiteness, holds at every velocity; held flat
1.5 s, past each tail). Three fixed 1 kHz sines, free-running, the
carriers. The filter is a 2-pole highpass with a small upward envelope;
the drive (Soft) and its tone pole are on.

| | `tr808-clap` | `tr909-clap` |
|---|---|---|
| A: burst 1, burst 2 | Init 1 falling over 11.1 ms (curve −0.72), step to 0.69, release 19.8 ms (−0.84); level 0.826 | over 11.2 ms (−0.94), step to 1.0, release 12.4 ms (−0.86); level 0.996 |
| B: burst 3 | onset 23.3 ms, release 12.5 ms (−0.97); level 0.977 | 23.1 ms, 8.5 ms (+0.90, held then dropped); level 0.464 |
| C: tail | onset 31.1 ms, release 177 ms (−1.00); level 0.615 | 31.2 ms, 124 ms (−0.99); level 0.827 |
| filter | highpass 589 Hz, Reso 1.98, env +1.06 oct over 414 ms | highpass 407 Hz, Reso 0.62, env +1.74 oct over 42 ms |
| drive | gain 1.35, tone 0.39; volume 1.27 | gain 5.85, tone 0.098; volume 1.47 |

## What remains, measured

- **Burst 1** is 2.5–3 dB low against the hit's peak at the click, and on
  the 909 2.9 dB low over 0–5 ms (above).
- **The tail ends early.** A release falls to 0 at its time, so the tail
  reaches −40 dB at 169 and 147 ms against 216 and 377 ms (the toolkit's
  level envelope), and nothing is left past 200 ms where the recordings run
  on at −50 to −60 dB. The tail carrier's envelope has one segment after
  its step; the trigger-mode breakpoint the toms use for a long tail needs
  a second.
- **The late tail is too bright.** The recordings darken as the tail goes
  on (60–250 ms: 8 kHz at −29 and −42 dB re the peak); the render keeps
  the bursts' colour (−16 dB), since one static filter colours the whole
  hit. The 808's tail is 7.5 dB high above 6 kHz.
- **Below 150 Hz** the render is 10–33 dB under the recordings, which carry
  a little low rumble (−40 dB and lower re the band); the highpass removes
  it.

## Engine limits met

- **A step is a ramp from the start of its control block.** An envelope
  segment of 0 inside a 32-sample block ends on the same sample as the
  segment before it, and the amplitude knot keeps only the later level
  (`voiceAmpRamp.ts`: "two ends on one sample keep the later"), so the
  carrier ramps from the block's first sample to the step's sample rather
  than stepping: 0–31 samples, wherever the onset falls (measured: the step
  at 10.89 ms ramps over 11 samples). Likewise a carrier whose envelope
  starts at Init 1 ramps up over the voice's first block (0.67 ms). The
  recordings reach full level within 4 samples. Proposed ticket: keep both
  breaks when a zero-length segment ends on a sample (land on the earlier
  level, then step), and start a carrier's ramp at its Init level, so an
  envelope edge is a step anywhere in the block. The goldens of every
  patch with a zero-length segment, or an Init above 0 on a carrier, would
  change. Not prototyped here.
- **Level and saturation are one control** (windsor#300). The 909's
  colour comes from the drive's tone pole, which follows the shaper, so its
  peak could reach `main`'s only with the drive at 5.8.
- **One filter for the whole hit**: the tail cannot darken on its own.

## Reproducing

From `scripts/sound-match/` with the toolkit's venv, and the folders in the
environment:

```bash
export SM_TR_REFS=<…>/windsor-tr-refs                      # tacowars's picks
export SM_CLAP_HEADS=<…>                                   # the two heads, above
python fit.py ../../docs/research/2026-10-01-tr-clap-fit/specs/<spec>.json
python ../../docs/research/2026-10-01-tr-clap-fit/fit_level.py ../../docs/research/2026-10-01-tr-clap-fit/specs/<spec>.json
python ../../docs/research/2026-10-01-tr-clap-fit/structure.py "$SM_TR_REFS/Clap A 808.wav"
python ../../docs/research/2026-10-01-tr-clap-fit/fm_noise_probe.py
```

`start/` holds each spec's start patch; a later stage starts from the
previous stage's `best.json` as its start file shows. CMA-ES with a fixed
seed makes each run repeatable on the same machine.

| Stage | Specs | Script |
|---|---|---|
| 1, structure | `<clap>.init`, `.loop`, `.lfo` | `fit.py` |
| 1, filter | `<clap>.init-hp12` (kept), `.init-hp24`, `.init-bp24` | `fit.py` |
| 2, noise | `<clap>.stage2` (white, kept), `.stage2-fm` (free) | `fit.py` |
| 3, level | `<clap>.stage3` | `fit_level.py` |
| 4, transient | `<clap>.stage4` (no gain), `<clap>.edge` (not kept) | `fit_level.py` |

The library patch is stage 3's `best.json`, rounded to six significant
figures, its Noise modulator's hold set to 1.5 s, with this note's
description.

## Overlays

The toolkit's six panels per clap against the full recording, reference in
black, render in red: `overlays/<patch>.png`.
