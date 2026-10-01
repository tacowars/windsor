# The TR snares fitted to recordings

windsor#353, Wave 3 of the TR fitting work: `tr808-snare` and `tr909-snare`
fitted with the sound-match toolkit (`scripts/sound-match/`, record
`2026-10-01-sound-match-toolkit`) to tacowars's picks from Samples From Mars
*808 From Mars* and *TR-909 From Mars*. The decision is
`docs/log/2026-10-01-tr-snares-fitted.md`. The recordings are a commercial
pack and stay outside the repository; only numbers measured from them, and
the overlays, are here. The numbers say where a render differs; whether it
sounds right is tacowars's call by ear.

Measured on an Apple M1 (8 cores, macOS 26.5), Node 24.21, Python 3.12.9,
against `origin/main` at `12c1ac3`, with two other fits sharing the machine.

| Patch | Reference | tacowars's note |
|---|---|---|
| `tr808-snare` | `SD A 808 Tone C 06.wav` | 808 snare with lots of snappy, medium tone |
| `tr909-snare` | `SD 909 Clean D 06.wav` | medium 909 snare, fair amount of snappy |

Every render is C4 (MIDI 60), velocity 1, no gate, aligned and normalised
by the toolkit's defaults, and scored over noise seeds 1–4 (the mean is
shown), as the toolkit does for a patch with a Noise operator. Only the
harness seeds the noise; the engine keeps it random live, so each hit
differs. Both recordings read as noise-like to the toolkit (spectral
flatness over 5–150 ms −19.5 and −15.3 dB, above its −25 dB line), so its
`pitch` and `harm` scores do not count; the tones are read from the model
fits below instead, and the toolkit's pitch score with the voice forced
tonal is shown as a diagnostic only.

## Measurements (decision 2)

How they were read, all outside the repository on the recordings:

- **Tones:** the 60–800 Hz band (zero-phase band-pass) fitted with two
  exponentially decaying sines per window (least squares, constant
  frequency per window), and over the whole hit with a shared exponential
  pitch envelope; cross-checked with the toolkit's pitch track and
  long-window spectral peaks. Levels are dB re the recording's peak at the
  window's start.
- **Snappy band:** Welch spectra (512 points) over 5–30 and 30–80 ms in
  third-octave bins, dB re the loudest bin above 1 kHz; the −6 dB edges are
  the outermost third-octaves within 6 dB of it.
- **Snappy envelope:** RMS above 1 kHz (4th-order zero-phase high-pass) in
  2 ms windows, dB re the peak.
- **Balance:** energy below 700 Hz against energy above 1 kHz.

| | 808 (`SD A 808 Tone C 06`) | 909 (`SD 909 Clean D 06`) |
|---|---|---|
| Length, level | 214 ms; peak at 2 ms; −20 dB at 38 ms, −40 dB at 94 ms | 250 ms; peak at 8 ms; −20 dB at 82 ms, −40 dB at 124 ms |
| Lower tone | **175.2 Hz** (track 175.0–175.4 Hz over 20–150 ms; windows 175.1–175.9 Hz after 12 ms). No pitch fall: the first two windows (2–12 ms) read 163–166 Hz on under two cycles. −15 dB at 2 ms, falling 0.30 dB/ms (τ 29 ms): −20 dB at 24 ms, −31 dB at 60 ms, −43 dB at 100 ms; still there at 200 ms (−78 dB) | **180.7–181.2 Hz settled** (after 60 ms). Falls with the upper tone: 260–264 Hz over 2–12 ms (+6 st), 197–198 Hz over 8–24 ms (+1.5 st), 184 Hz over 16–48 ms (+0.3 st), 181.8 Hz over 40–80 ms. A whole-hit model reads +16 to +18 st at the hit falling with τ 7 ms. −0.4 dB at 2 ms (it is the loudest thing in the hit), falling 0.33 dB/ms (τ 26 ms): −10 dB at 24 ms, −23 dB at 60 ms, −36 dB at 100 ms |
| Upper tone | **343–346 Hz**, 1:1.97 to the lower (not 1:1.83). −17 dB at 2 ms, falling 0.8 dB/ms (τ 8–11 ms): −24 dB at 12 ms, −35 dB at 24 ms, −49 dB at 40 ms | **290 Hz settled**, 1:1.60. Falls with the lower: 424 Hz over 4–12 ms, 380 over 8–16, 300 over 12–32, 289–291 after. 12–15 dB under the lower tone throughout, decaying at nearly its rate: −15 dB at 4 ms, −25 dB at 24 ms, −34 dB at 60 ms, −48 dB at 100 ms |
| Tone shape | both near-pure sines | the lower tone a sine with H2 at −19 dB and H3 under −59 dB, not a triangle; intermodulation products at 73, 109 and 253 Hz, −20 to −24 dB re the lower tone (a nonlinearity mixing the two) |
| Tone onset | at the hit, opening negative | about 1.5 ms after the hit (the first 1.5 ms is noise), building to its peak at 7 ms |
| Snappy band, 5–30 ms | **1.8–7.1 kHz** (−6 dB), peak 3.6–5.7 kHz; −12 to −23 dB below 1.5 kHz; −8 dB at 9 kHz, −14 dB at 14 kHz | **1.4–11.3 kHz**, near flat: within 8 dB from 0.6 to 11 kHz; −12 dB at 14 kHz, −18 dB at 18 kHz |
| Snappy band, 30–80 ms | 2.2–9.0 kHz | 2.2–11.3 kHz, tilting up a little |
| Snappy envelope (>1 kHz) | −13 dB at 3 ms, then a straight fall of 0.47 dB/ms (τ 18 ms): −20 at 20 ms, −33 at 40 ms, −56 at 80 ms, −68 at 120 ms. No hold | holds −16 to −18 dB to 30 ms, eases to −23 dB at 60 ms and −34 dB at 80 ms, then a cliff of 1.4 dB/ms to −60 dB at 100 ms, then a floor near −64 dB |
| Balance, tone re snappy | 0–5 ms +0.3 dB, 5–30 ms −1.5, 30–80 ms +4.9, 80–150 ms +14.2; whole hit **−0.5 dB** ("lots of snappy") | 0–5 ms +7.8 dB, 5–30 ms +6.7, 30–80 ms +1.2, 80–150 ms +4.7; whole hit **+5.7 dB** |
| Transient | click above 1 kHz peaks at −5.1 dB re peak; the first ms is as much noise as tone | click −8.4 dB re peak; 0–5 ms is tone-led (centroid 1.2 kHz) |

**The 808's 130 Hz highpass** (`docs/design/drum-bank.md`: the patch kept
its 180 / 330 Hz resonators by highpassing at 130 Hz rather than at the
circuit's higher cutoff). It does not hold against this recording. Its
noise is highpassed near 1.8 kHz, but a shared highpass anywhere near that
takes the tones with it (a 12 dB/oct highpass at 1.8 kHz is about 40 dB
down at 175 Hz). With the cutoff free over 60–1500 Hz and then 30–1500 Hz,
both 808 fits put it at the bottom (60 and 32 Hz). With every other number
of the shipped patch held, the old 130 Hz / 0.8 scores worse in every
component than the fitted 32 Hz / 0.70 (total 1.733 against 1.621, the
transient 2.584 against 2.276), and 600 Hz worse still (2.523). The fitted
highpass is near-transparent but not nothing: off, the total is 1.637 and
the transient 2.315, so it stays.

## Scores, before and after

Default weights (`stft` 1, `band` 0.1, `wave` 2; `pitch` and `harm` do not
apply), seeds 1–4, lower is closer. **The transient** is the same scoring
against the recording's first 10 ms alone (a scratch cut of the file, never
committed), plus the toolkit's click and its 0–5 ms level above 2 kHz.

| Patch | total | stft | band (dB) | wave |
|---|---|---|---|---|
| `tr808-snare` | 4.038 → **1.621** | 2.992 → 1.185 | 8.83 → 3.77 | 0.0813 → 0.0295 |
| `tr909-snare` | 3.327 → **1.623** | 2.184 → 1.076 | 7.90 → 4.53 | 0.1762 → 0.0471 |

The transient, on its own:

| Patch | first 10 ms: total | stft | band (dB) | wave | click >1 kHz, recording / before / after | 0–5 ms above 2 kHz |
|---|---|---|---|---|---|---|
| `tr808-snare` | 3.118 → **2.276** | 2.191 → 1.704 | 8.36 → 5.34 | 0.0453 → 0.0187 | −5.1 / −6.3 / **−5.1 dB** | −0.9 → −0.5 dB |
| `tr909-snare` | 2.985 → **2.229** | 2.183 → 1.600 | 6.49 → 5.86 | 0.0767 → 0.0217 | −8.4 / −3.7 / **−8.9 dB** | +5.4 → −0.2 dB |

No score ends worse, in total or in any component, on the whole hit or on
the transient. The forced-tonal diagnostic moves the same way: pitch 2.47 →
1.70 st (808) and 5.12 → 1.46 st (909), harmonics 49.5 → 22.5 dB and 32.1 →
14.2 dB.

### Against the measurements

Windows as in the measurement table; render seed 1.

| | Recording | Before | After |
|---|---|---|---|
| 808 tones | 175.2 and 343–346 Hz (1:1.97) | 180 and 330 Hz (1:1.83) | **174.8 and 345.2 Hz** (1:1.97) |
| 808 lower tone, 24 / 40 / 60 / 100 ms | −20.4 / −25.3 / −31.3 / −43.4 dB | | −20.4 / −25.7 / −30.7 / −39.1 dB |
| 808 upper tone, 12 / 16 / 24 ms | −24.2 / −28.7 / −35.3 dB | | −23.0 / −32.7 / −42.4 dB |
| 808 snappy, 3 / 20 / 40 / 80 / 100 ms | −13 / −20 / −33 / −56 / −63 dB | −16 / −21 / −26 / −33 / −37 dB | −17 / −23 / −36 / −55 / −74 dB |
| 808 balance, whole hit | −0.5 dB | +7.6 dB | +2.8 dB |
| 909 tones, settled | 181 and 290 Hz (1:1.60) | 180 and 330 Hz (1:1.83) | **179.1 and 287.0 Hz** (1:1.60; −0.15 and −0.18 st) |
| 909 lower tone, 8–16 / 12–24 / 16–32 / 24–48 / 40–80 / 100–180 ms | 197.8 / 197.0 / 184.2 / 184.3 / 181.8 / 181.2 Hz | | 197.2 / 191.7 / 191.0 / 187.8 / 183.6 / 179.7 Hz |
| 909 upper tone level, 24 / 40 / 60 / 100 ms | −24.5 / −28.1 / −34.2 / −48.3 dB | | −24.1 / −32.0 / −34.7 / −43.6 dB |
| 909 snappy, 10 / 30 / 60 / 80 / 90 / 100 ms | −17 / −18 / −23 / −34 / −41 / −60 dB | −13 / −15 / −22 / −27 / −29 / −31 dB | −20 / −22 / −25 / −31 / −40 / −68 dB |
| 909 balance, whole hit | +5.7 dB | −0.5 dB | +8.0 dB |

### Level

Peak at velocity 1 on C4, mean over seeds 1–8 (common to Wave 3: within
1 dB of `main`): `tr808-snare` −8.03 → −8.03 dBFS (`volume` 0.9 → 0.893),
`tr909-snare` −7.75 → −7.75 dBFS (`volume` 0.9 → 1.250, with the three
carrier levels scaled together so `volume` stays inside its knob's 0–1.5).

## The snappy: shared filter against FM-coloured noise (decision 3)

Each snare was fitted twice from the same hand-built start, once with white
noise through the voice's shared filter (algorithm 7, `specs/<id>.json`)
and once with FM-coloured noise as in windsor#327's 909 tom (algorithm 6: C a sine
at a fixed frequency, spread by D, a Noise operator; `specs/<id>.fm.json`),
each with the same budget (2500 evaluations on the 808, 3000 on the 909).

| | 808 white | 808 FM | 909 white | 909 FM |
|---|---|---|---|---|
| total (default weights) | 1.635 | **1.514** | 1.604 | **1.536** |
| first 10 ms | 2.319 | **2.025** | 2.137 | **2.128** |
| band shape error, 1–15 kHz, 5–30 / 30–80 ms | 5.8 / **4.9 dB** | **5.4** / 5.6 dB | **3.2** / 3.8 dB | 3.3 / **3.6 dB** |
| −6 dB band, 5–30 ms (recording 1.8–7.1 / 1.4–11.3 kHz) | 1.1–18 kHz | 5.7–5.7 kHz | 1.1–18 kHz | 2.2–4.5 kHz |
| strongest narrow line above 1 kHz | +10.9 dB | **+23 to +25 dB at 5.2 kHz** | +10.0 dB | **+17 to +20 dB at 4.8 kHz** |

The band shape error is the RMS difference of the third-octave spectrum
over 1–15 kHz, each side's mean removed; a narrow line is the strongest
Welch bin (4096 points) above its neighbours' median. The recordings'
strongest narrow peaks are +10 to +13 dB, the same as white noise's random
ones.

A Noise operator draws a fresh white sample every sample, so phase noise on
a sine is the sine's line plus a white floor, never a band: at the fitted
depths (±0.24 and ±0.35 of a cycle) the line keeps two thirds and a third
of the carrier's amplitude. Against the measured band the two tie, within a dB
either way across spans and seeds; FM adds a line that neither recording
has, 7–15 dB above the random peaks, which the toolkit's five-band envelope
score reads as the 2–6 kHz band filled. **Both snares ship white noise**:
FM wins the totals through that line and nothing else, and it spends an
operator. The FM fits are in `specs/` and `start/` for anyone who wants to
hear them.

### What would make the band: per-operator noise colour (proposed ticket)

The shared filter cannot shape the snappy without taking the tones, and FM
colour gives a line. windsor#327's prototype (`docs/research/2026-10-01-tom-noise-colour-prototype/`:
a one-pole lowpass and highpass on a Noise operator's own noise, `noiseLp` /
`noiseHp`) was reused here, not rebuilt, and refitted on
both snares (`specs/<id>.noise-colour.json`, white-noise structure plus the
two fields):

| | 808 shipped | 808 prototype | 909 shipped | 909 prototype |
|---|---|---|---|---|
| total | 1.621 | **1.241** | 1.623 | **1.383** |
| stft | 1.185 | **0.891** | 1.076 | **0.848** |
| band (dB) | 3.77 | **2.89** | 4.53 | **4.40** |
| wave | **0.0295** | 0.0301 | 0.0471 | 0.0475 |
| first 10 ms | 2.276 | **1.708** | 2.229 | **1.741** |
| band shape error, 5–30 / 30–80 ms | 5.8 / 4.9 dB | **4.1 / 3.1 dB** | 3.2 / 3.8 dB | **2.9 / 3.5 dB** |
| the fit's noise filters | | highpass 2550 Hz, lowpass 6570 Hz | | highpass 374 Hz, lowpass 8960 Hz |

The 808 is the sound that asks for it: its snappy is a band and it is half
the hit. The gain is 0.38 of total (23 %) and 0.57 on the transient, from
the snappy alone; the one-pole slopes still leave its skirts 3–4 dB off
(`overlays/tr808-snare.noise-colour-prototype.png`), so the ticket should
consider a 12 dB/oct option. The proposed ticket is windsor#327's text (a Noise
operator gains `noiseLp` and `noiseHp`, additive fields whose 0 default
reproduces today's noise bit for bit), with these numbers as its case.

**A note on windsor#327's own measurement of the prototype.** Its `build.py` lays
the toolkit mirror out with the Python files symlinked to the repository's.
Python resolves a symlinked script's directory to the target's, so
`fit.py` run in the mirror imports the repository's `renderer.py`, which
renders through the repository's `render.mjs` and the shipped bundle: the
new fields are ignored. Run that way here, the snare's start (with
`noiseHp` 2 kHz and `noiseLp` 9 kHz) scored exactly what the same patch
scores without them, and 918 evaluations found nothing; with the Python
files copied instead of linked, the same start scored 1.757 against 1.914
on the fit's objective.
The tom's prototype row in windsor#327 (0.8989 against 0.8986, its filters drifting
to 9.1 kHz and 21 Hz) looks like the shipped bundle measured twice, so its
"gained nothing" is unproven rather than shown.

## What was fitted

The structure is chosen by hand; the optimizer moves only the numbers each
spec names. Tones are phase-locked (`phaseFree: false`), as the earlier TR
fits did: an analog resonator is struck at the same point every hit. Every
amplitude envelope is in trigger mode (decay to a sustain level, then the
release carries on without a note-off). The drive stays off (gain 1, no
bias): no fit tried it, and the measured differences it could address
(the 909's intermodulation) are small. Times under one sample are written
as exactly 0 (none of the shipped values fell there).

### 808

Algorithm 7 (all four operators carriers): A a sine at 174.8 Hz on C4
(ratio 0.668124), B a sine at 345.2 Hz (1.3196), C white noise, D silent;
the shared highpass at 32 Hz. A falls to 0.48 in 10 ms and then releases
over 132 ms; B decays to nothing over 23 ms; the noise starts
within half a millisecond and falls fast to 0.29 in 18 ms and then over
76 ms, which gives the recording's straight fall in dB. The ratios were held
at the measured tones in stage 2: the FM fit had moved them 0.2 semitones
apart to suit the STFT.

Stages: `tr808-snare` (white) and `tr808-snare.fm` (FM) from hand-built
starts; `tr808-snare.stage2` from the white result, σ 0.1, 2000 evaluations.
The level match moved only `volume`.

### 909

Algorithm 7: A a sine at 179.1 Hz on C4 (0.684565) and B a sine at 287.0 Hz
(1.09688), sharing one envelope shape (B 13.9 dB under A) and the global
pitch envelope: 11.5 semitones at the hit, down to 1.6 semitones in 8 ms on
a +0.5 curve, then released over 123 ms, which is the measured slow fall of
the last 0.3 semitone. C white noise, starting over 2 ms, easing 5 dB over
17 ms and holding, then a 75 ms release on a +0.22 curve, which puts the
fall late: the recording's cliff. The shared highpass at 58 Hz. D silent.

The lower tone was a User wave with the measured H2 for the fits; stage 2
took H2 to −45 dB, and a plain sine scores the same (total 1.621 either
way), so it ships as a sine. Setting the measured H2 (−19 dB) back scored a
little worse (1.628).

Stages: `tr909-snare` (white) and `tr909-snare.fm` (FM) from hand-built
starts. The white stage-1 fit scored 1.604 but spent the upper tone on a
6 ms blip, so the 290 Hz tone was gone after 10 ms where the recording holds
it at −13 dB through 150 ms. `tr909-snare.stage2` took the FM fit's tones
and pitch envelope with the white fit's noise (σ 0.1, 2500 evaluations,
the reference forced tonal with `pitch` at 0.1 to keep the tones on their
measured pitch); `tr909-snare.stage3` tied B's envelope to A's, as measured
(σ 0.08, 1500 evaluations). Stage 3 ships: 1.623 against stage 2's 1.621,
but its transient is the closest (click −8.9 dB against −10.9, recording
−8.4; 0–5 ms above 2 kHz −0.2 dB against −2.1) and its upper tone follows
the recording's level within 4 dB through 100 ms.

Each fit weighted the transient: the spec's second reference is the
recording's first 10 ms at half weight, and `wave` (0–30 ms) is at 4.

## What remains

- **The snappy's band** (808 most): white noise through a near-open filter
  is too loud below 2 kHz and above 9 kHz and 4–6 dB short at 3–6 kHz
  (`overlays/tr808-snare.png`, spectrogram panel). Engine limit; see the
  proposed ticket above.
- **The 808's balance** reads 3.3 dB more tonal than the recording over the
  whole hit; part of that is the white noise's energy below 700 Hz, which
  the recording's highpassed snappy does not have.
- **The 808's upper tone** fades 4–7 dB faster than the recording after
  16 ms.
- **The 909's tone onset**: the recording's tones enter about 1.5 ms after
  the noise and build to their peak at 7 ms; the render's peak at 2 ms. The
  envelopes' attack could be fitted longer, but the fits preferred the
  struck start; the first 30 ms waveform is where the `wave` error lives.
- **The 909's early pitch**: over 12–48 ms the render is 0.3–0.6 semitones
  sharp of the recording, which falls faster through that span; settled it
  is 0.15 semitones flat.
- **The 909's intermodulation** products (73, 109, 253 Hz at −20 to
  −24 dB) are absent: the render's tones never meet a nonlinearity.
- **Tails** below −60 dB end sooner than the recordings' (both scores
  floor there).

## Reproducing

From `scripts/sound-match/` with the toolkit's venv (its README). The
references come from tacowars's folder; the 10 ms heads are cut from them
into a scratch folder:

```bash
export SM_TR_REFS=<…>/windsor-tr-refs
export SM_SNARE_HEADS=<scratch>
python -c "
import os, numpy as np, scipy.io.wavfile as w, audio
for name, f in (('sd808', 'SD A 808 Tone C 06.wav'), ('sd909', 'SD 909 Clean D 06.wav')):
    x = audio.load_wav(os.path.expandvars('\$SM_TR_REFS/' + f))
    on = int(np.argmax(np.abs(x) > np.abs(x).max() * 0.01))
    w.write(os.path.expandvars(f'\$SM_SNARE_HEADS/{name}-head10.wav'), 48000, x[:on + 480].astype(np.float32))"
python fit.py ../../docs/research/2026-10-01-tr-snare-fit/specs/<spec>.json
python compare.py "$SM_TR_REFS/<file>.wav" <patch-id> --png
```

`start/` holds each spec's start: `tr808-snare.stage2.json` is the white
stage-1 `best.json`; `tr909-snare.stage2.json` is the FM fit's patch with
the white fit's noise operator on algorithm 7; `tr909-snare.stage3.json` is
stage 2's `best.json` with B's envelope set to A's and B's level at 0.39.
The shipped patch is the last stage's `best.json` rounded to six
significant figures, then level-matched as above. The `.noise-colour`
specs need windsor#327's prototype bundle, built with its `build.py` changed to
copy the toolkit's Python files rather than link them (above). CMA-ES with
a fixed seed makes each run repeatable on the same machine.

## Overlays

The toolkit's six panels per sound, recording in black, render in red,
seed 1: `overlays/<patch>.png` (shipped), `overlays/<patch>.before.png`
(`main`), and `overlays/tr808-snare.noise-colour-prototype.png`.
