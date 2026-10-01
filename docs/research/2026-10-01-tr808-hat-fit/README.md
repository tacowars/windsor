# The 808 hats fitted to recordings

windsor#354, Wave 3 of the TR fitting work: `tr808-hat-closed` and
`tr808-hat-open` fitted with the sound-match toolkit
(`scripts/sound-match/`, record `2026-10-01-sound-match-toolkit`) to
tacowars's picks from Samples From Mars *808 From Mars*. The recordings
are a commercial pack and stay outside the repository; only numbers
measured from them, and the overlays below, are here. The numbers say
where a render differs; whether it sounds right is tacowars's call by ear.
The decision is `docs/log/2026-10-01-tr808-hats-fitted.md`.

Everything was measured on an Apple M1 (8 cores, macOS 26.5.1), Node
24.21, Python 3.14.5, fitted against `origin/main` at `12c1ac3` and
checked again after rebasing on `de83c06` (no DSP change between them).
Two other fits ran on the machine throughout, so wall times here are
loaded ones.

| Patch | Reference | tacowars's note |
|---|---|---|
| `tr808-hat-closed` | `CH A 808.wav` | 808 closed hihat |
| `tr808-hat-open` | `OH 808 Decay 05.wav` | 808 open hi-hat, long decay |

Every render is note 60 (C4), velocity 1, no gate, aligned and normalised
by the toolkit's defaults. Both hats' oscillators run free
(`phaseFree: true`), so every score is the mean over seeds 1–4, as the
toolkit does for a seed-dependent patch; live playback keeps drawing its
start phases at random, so no two hits are alike. The scores are the
toolkit's, at its default weights (`stft` 1, `band` 0.1, `wave` 2; both
recordings are noise-like by the toolkit's test, so `harm` and `pitch` do
not count), lower is closer.

## The recordings, measured before fitting

Both files are 24-bit, 44.1 kHz mono: nothing above 22.05 kHz.

### The metal: line series

A Hann-windowed FFT of the open hat over 30–550 ms (2^20 points, 0.04 Hz
bins) shows 242 lines above −25 dB re the loudest between 2 and 20 kHz.
Four harmonic series, each with every harmonic present (pulses, not
squares), carry 74.6 % of those lines' energy (43 lines). No fifth series
carries more than 6 %.

| Series | Strongest lines, Hz (harmonic, dB re loudest) | Nearest bank frequency |
|---|---|---|
| 819.55 Hz | 5738 (7, −9), 6557 (8, −7), 7377 (9, 0), 8196 (10, −5), 9016 (11, −11), 10656 (13, −12) | 800 Hz, 2.4 % sharp |
| 541.2 Hz | 6494 (12, −6), 7038 (13, −3), 7577 (14, −3), 8659 (16, −11) | 540 Hz |
| 903.4 Hz | 4518 (5, −16), 5422 (6, −15), 6325 (7, −4), 7229 (8, 0), 8132 (9, −7), 9036 (10, −9) | 3 × 301.1: 304.4 Hz, every third harmonic only |
| 636.35 Hz | 6362 (10, −9), 6999 (11, −4), 7635 (12, −3), 8271 (13, −15), 8907 (14, −9) | 3 × 212.1: 205.3 Hz, every third harmonic only |

The closed hat's lines over 30–150 ms sit on the same frequencies within
its coarser resolution (6320, 6486, 6551, 7033, 7223, 7368, 7568, 7628,
8037, 8126, 8188 Hz, each within 0.1 % of the open hat's): one oscillator
bank, as on the machine. The 304.4 and 205.3 Hz oscillators show only as
every third harmonic of 301.1 and 212.1 Hz, and 369.6 and 522.7 Hz show as
no series at all; whatever the circuit does to them, the four series above
are what is heard.

Between the lines the spectrum is full: in a 4096-point (48 kHz) average
over 30–200 ms, the median bin of the 6–10 kHz bands sits 19–20 dB under
that band's loudest. The old patches' four unbandlimited squares leave it
31 dB under.

### The band

Peak level per band (fourth-order Butterworth band-passes, 1 ms RMS), dB re
the loudest band, and the level per band in the first millisecond:

| Band | Closed: peak | Closed: first ms | Open: peak | Open: first ms |
|---|---|---|---|---|
| 2–4 kHz | −23.4 | −23.4 | −21.4 | −24.1 |
| 4–6 kHz | −15.0 | −17.2 | −8.8 | −22.4 |
| 6–8 kHz | −2.4 | −8.7 | 0.0 | −4.6 |
| 8–10 kHz | −5.8 | −6.1 | −4.0 | −11.4 |
| 10–12 kHz | −6.1 | −6.1 | −5.5 | −11.0 |
| 12–16 kHz | 0.0 | −5.7 | −8.4 | −14.3 |
| 16–20 kHz | −7.1 | −9.0 | −17.5 | −23.5 |

Spectral centroid (toolkit): closed 11.4–11.7 kHz in every region, open
8.2–8.5 kHz. The toolkit's bands, dB re peak:

| Region | Closed <150 / 150–600 / 600–2k / 2–6k / >6k | Open |
|---|---|---|
| 0–5 ms | −35 / −53 / −54 / −29 / −12 | −51 / −33 / −46 / −27 / −12 |
| 5–30 ms | −63 / −76 / −60 / −35 / −18 | −79 / −55 / −54 / −24 / −12 |
| 30–150 ms | −101 / −103 / −83 / −53 / −37 | −101 / −88 / −55 / −27 / −14 |

The closed hat is the brighter by 3 kHz with the same lines: more of its
energy is in 12–16 kHz.

### Decay per band

Milliseconds from each band's own peak to −10, −20 and −40 dB:

| Band | Closed −10 / −20 / −40 | Open −10 / −20 / −40 |
|---|---|---|
| 2–4 kHz | 5 / 29 / 59 | 21 / 250 / 577 |
| 4–6 kHz | 9 / 39 / 72 | 13 / 322 / 601 |
| 6–8 kHz | 7 / 35 / 64 | 33 / 332 / 604 |
| 8–10 kHz | 13 / 32 / 70 | 32 / 296 / 607 |
| 10–12 kHz | 17 / 31 / 63 | 7 / 227 / 589 |
| 12–16 kHz | 7 / 35 / 64 | 32 / 251 / 605 |
| 16–20 kHz | 3 / 38 / 69 | 64 / 413 / 611 |

The bands decay together, within a few milliseconds on the closed hat: one
envelope for the whole sound, not a band that closes. The open hat drops
about 10 dB in its first 30 ms, holds a slow decay, and falls away after
500 ms (−20 dB at 531 ms, −40 dB at 613 ms overall).

### The opening transient

| | Closed | Open |
|---|---|---|
| Edge | a step: 10 % to 90 % of the first millisecond's peak in 0.04 ms (2 samples at 44.1 kHz) | 0.67 ms |
| First 0.5 ms peak, dB re the sound's peak | 0.0 (the sound's peak is at 0.3 ms) | −12.1 |
| 0.5–5 ms peaks, per 0.5 ms | −3.5 −2.2 −3.5 −1.6 −5.0 −9.5 −7.4 −1.7 −0.9 | −2.0 −3.0 −3.6 −3.7 −4.3 −6.5 −5.4 −4.4 −0.8 |
| RMS 0–2 ms re 5–30 ms | +7.0 dB | −0.3 dB |
| Click (>1 kHz, 0–10 ms) peak, toolkit | −0.7 dB | −1.6 dB |

The closed hat opens on its loudest sample, 7 dB above its own body; the
open hat opens at about its body's level. Neither opens with a low
thump: in 0–5 ms everything below 2 kHz is 5 dB or more under the 2–6 kHz
band, and that band 15 dB or more under the top one.

How these were read: line series by searching fundamentals from 150 to
1000 Hz in 0.05 Hz steps for the one whose integer multiples (within
2.5 Hz) carry the most energy among the lines not yet explained, four
times over; bands by fourth-order Butterworth band-passes run forwards and
backwards; the transient from the first millisecond's 10 % and 90 %
crossings, the peak per 0.5 ms over 0–5 ms, and RMS over 0–2 ms against
RMS over 5–30 ms, after the toolkit's own alignment.

## Before and after

"Before" is the patch on `main`. Mean over seeds 1–4 at the default
weights.

| Patch | total | stft | band (dB) | wave |
|---|---|---|---|---|
| `tr808-hat-closed` | 2.400 → **1.868** | 1.781 → 1.515 | 5.50 → 2.82 | 0.0342 → 0.0354 |
| `tr808-hat-open` | 4.925 → **2.146** | 3.487 → 1.615 | 12.30 → 3.40 | 0.1037 → 0.0952 |

What a perfect match would score, roughly: a second hit of the shipped
patch (seed 9) scored against seeds 1–4 of the same patch gives 0.989 for
the closed hat and 1.250 for the open hat. Two hits of free-running metal
never share a waveform, so neither score can reach 0.

**The closed hat's `wave` is 0.0012 higher, inside its own spread over
the four seeds (± 0.0043).** With phases that never line up, the 0–30 ms
waveform error is the sum of the two signals' energies (each normalised to
its own peak) less a chance correlation: the recording's energy is
0.0281, the old patch's 0.0141 and the new one's 0.0174, and the scores
are 0.0342 and 0.0354 against sums of 0.0423 and 0.0455. The term rewards
a render that is quieter in its first 30 ms than the recording; the new
patch is the closer of the two to the recording's energy, and so scores
the higher. A last stage with `wave` weighted 3× (`tr808-hat-closed.final`)
moved it up, not down. Every other component, and the transient, is
closer than before. It is reported, not chased.

### The opening transient, on its own

Same readings as the recording's table above; patches over seeds 1–4.

| | Recording | Before | After |
|---|---|---|---|
| Closed: RMS 0–2 ms re 5–30 ms | +7.0 dB | +10.1 | **+6.9** |
| Closed: first ms peak re the sound's peak | 0.0 dB | −1.1 | −3.5 |
| Closed: edge, 10 % to 90 % | 0.04 ms | 0.34 | 0.40 |
| Closed: 0–5 ms above 2 kHz (toolkit, render − recording) | | −2.2 dB | −2.2 |
| Closed: click >1 kHz, 0–10 ms peak (toolkit) | −0.7 dB | −1.0 | −0.8 |
| Open: RMS 0–2 ms re 5–30 ms | −0.3 dB | +2.2 | **−0.5** |
| Open: first ms peak re the sound's peak | −2.0 dB | −2.4 | −9.6 |
| Open: edge, 10 % to 90 % | 0.67 ms | 0.40 | 0.44 |
| Open: 0–5 ms above 2 kHz (toolkit, render − recording) | | −1.9 dB | −3.0 |
| Open: click >1 kHz, 0–10 ms peak (toolkit) | −1.6 dB | −1.2 | −1.7 |

The closed hat's opening was fixed first and the rest fitted around it
(below): left free, the fit gave the opening away (about +1.5 dB over the
body instead of +7). Both edges stay slower than the closed recording's
two-sample step: an attack of 0 steps the operator envelope, but the
pulses' own edges and the 24 dB highpass round the first 0.4 ms. The open
hat's first millisecond peaks lower against its later, random spikes.

### The metal

| | Recording | Before | After |
|---|---|---|---|
| Of the open hat's 30 strongest lines (4–12 kHz), present in the render (within 3 Hz, above −20 dB) | 30 | 1 | **17** |
| Share of 4–12 kHz energy within 3 Hz of the four series | 53.4 % | 2.1 % | 82.3 % |
| Median bin under the band's loudest, 6–8 / 8–10 kHz | −19.9 / −18.7 dB | −31.2 / −31.7 | −22.0 / −20.0 |
| Centroid, closed (toolkit, by region) | 11.4–11.7 kHz | 9.7–10.0 | 10.4–11.2 |
| Centroid, open | 8.2–8.5 kHz | 9.3–9.6 | 9.6–9.8 |

### Envelope and level

| | Recording | Before | After |
|---|---|---|---|
| Closed: −20 / −40 dB | 40 / 75 ms | 28 / 47 | 45 / 76 |
| Open: −20 / −40 dB | 531 / 613 ms | 184 / 318 | 578 / 612 |

Peak at velocity 1 on C4, mean over seeds 1–8 (within 1 dB of `main`):
closed −11.35 → −10.97 dBFS, open −10.21 → −10.42 dBFS.

Overlays: `overlays/tr808-hat-closed-1.png` and
`overlays/tr808-hat-open-1.png` (the toolkit's six panels, seed 1).

## What ships

Both hats are one sound, algorithm 7 (four carriers, no FM):

- **The metal.** Four Pulse operators (wave 10, bandlimited) at the four
  measured series, 819.55, 541.2, 903.4 and 636.35 Hz, fixed and
  free-running (`phaseFree: true`). Duties 0.16, 0.25, 0.83 and 0.80;
  levels 1.0, 0.52, 0.91 and 0.89. A pulse off a 50 % duty has every
  harmonic, as the recording's series do.
- **The drive makes the fill.** The voice drive, Soft, at gain 7.8: the
  four pulses clip together and intermodulate, which fills the spectrum
  between the lines to within about 2 dB of the recording's depth. With
  the drive off, stage a's open hat scores 3.455 instead of 2.087.
- **A 24 dB highpass** (two SVF stages): 8 kHz with resonance 0.88 on the
  open hat, 7 kHz with 0.56 on the closed. A 12 dB slope lets the drive's
  difference tones through (open hat 2.146 → 3.339).
- **The drive's tone pole sets the level**: 0.53 on the open hat (a
  one-pole lowpass at about 4.8 kHz), 0.9 on the closed (14.2 kHz). It is
  the only control after the shaper, so with the drive saturating it is
  what keeps each peak within 1 dB of `main`.
- **Envelopes, all four operators alike** (one VCA on the machine).
  Closed: attack 0 (a step), 3 ms to 0.35 on a curve of 1, then the
  trigger-mode release over 78 ms. Open: 1.4 ms attack, 198 ms to 0.37,
  release 416 ms.
- **Velocity.** `velSens` 1 on every operator (was 0.6): the drive
  flattens level changes before it, so full sensitivity keeps more of the
  old dynamics (below). Velocity 1 renders the same either way.

The two hats share everything but the envelopes, the highpass and the tone
pole. With the open hat's highpass and tone, the closed hat's envelope
scores 2.107 and peaks at −13.3 dBFS, 2 dB under `main`'s window; with its
own it scores 1.868 at −10.97 dBFS. The closed recording is also the
brighter by 3 kHz.

### Velocity

Peak and 0–300 ms RMS, dB re velocity 1, mean over seeds 1–8:

| | v 0.7 peak / RMS | v 0.4 peak / RMS |
|---|---|---|
| Closed, before | −1.7 / −1.7 | −3.9 / −3.9 |
| Closed, after | −0.8 / −1.7 | −2.8 / −4.5 |
| Open, before | −1.7 / −1.7 | −3.9 / −3.9 |
| Open, after | −0.7 / −1.0 | −2.8 / −3.2 |

### Render cost

One 1 s hit through `render.mjs`, median of 40 interleaved renders each,
under the load noted above: closed 3.83 → 5.56 ms, open 4.33 → 7.23 ms.
The Pulse waves, the second filter stage and the drive account for it.
The Tube shape fitted 0.05 better on the open hat (stage a3, 2.035) at
12.9 ms against Soft's 6.7 for the same patch, so Soft ships.

## How it was fitted

Specs and start patches are in `specs/` and `start/`;
`start/*.shipped.json` are the shipped patches. Stages in order, with the
default-weight total of each one's best:

| Stage | What moved | Best |
|---|---|---|
| `tr808-hat-open.a` | the four pulses (levels, duties), one envelope, highpass, drive gain and tone; frequencies fixed at the series | 2.087 (start 2.496) |
| `tr808-hat-open.b` | algorithm 4, two FM pairs, no drive; modulator frequencies free | 2.073, but 6 of 30 lines |
| `tr808-hat-open.c`, `.c2` | algorithm 10, a sine near 7.5 kHz modulated by three pulses | 2.444 and 2.409, stopped at 840 and 675 evaluations by a time limit |
| `tr808-hat-open.a2` | stage a, `band` weight doubled | no better than its start |
| `tr808-hat-open.a3` | stage a, Tube drive | 2.035, not used (cost) |
| `tr808-hat-open.a4` | stage a with the tone pole fixed at 0.4 for level | 2.192 |
| by hand | highpass 8 kHz and tone 0.5, the darker of the level-keeping pairs tried | 2.195 |
| `tr808-hat-open.a5` | the pulses and the envelope around that pair | 2.143; tone 0.53 for level: **2.146** |
| `tr808-hat-closed.own`, `.shared` | on stage a4's metal: the envelope with and without the filter | 2.032 and 2.018, but the opening at about +1.5 dB |
| onset grid, by hand | decay 3–12 ms × sustain 0.15–0.35 × curve 0–1 | a +7 dB opening costs about 0.13 |
| `tr808-hat-closed.onset` | the onset frozen at 3 ms to 0.35, curve 1; tail, filter and tone | 2.003, but peaking at −23.6 dBFS |
| `tr808-hat-closed.level` | tone 0.99 and highpass 7 kHz for level; tail and resonance | 2.028 |
| `tr808-hat-closed.wave` | `wave` weighted 3×: envelope and resonance | not used (its `wave` rose) |
| by hand | stage a5's metal, and volume 1 as on the open hat | 1.878 |
| `tr808-hat-closed.final` | tail and resonance, `wave` weighted 3× | 1.846 at −10.26 dBFS; tone 0.9 for level: **1.868** |

Every envelope time a fit left under one sample (1/48000 s) ships as
exactly 0: the closed hat's attack, fitted at 1.3e-5 s, scores the same
at 0.

## What remains

- **The envelope acts before the drive.** The operator envelopes come
  before the voice drive, and the drive saturates, so it partly flattens
  the envelope's shape, the level and the velocity, and the
  intermodulation fill fades as the envelope takes the sum under the
  knee: the closed hat's 30–150 ms is tonal (flatness −29 dB against the
  recording's −10). On the machine the metal is mixed at a constant level
  and the VCA comes after.
- **Measured: an envelope after the drive.** A prototype holds the
  operator envelopes flat at 1, so the drive and the highpass see the
  metal at a constant level, and multiplies the output offline by a
  two-exponential envelope with a cosine fade, fitted by Nelder–Mead to
  the toolkit's total over seeds 1–4. On the shipped patches: closed
  1.868 → **1.468** (stft 1.515 → 1.117), open 2.146 → **1.889**
  (stft 1.615 → 1.442). A gain after the drive would also free the tone
  pole from setting the level. The PR proposes the engine ticket; nothing
  here changes the engine.
- **The open hat is 1.2–1.5 kHz bright** (centroid 9.6–9.8 kHz against
  8.2–8.5). Darker pairs scored worse: highpass 7.5 kHz with tone 0.5,
  level kept, 2.246; lower cutoffs 2.39–2.60, and under `main`'s level.
  Its first millisecond peaks 7.6 dB further under its own peak than the
  recording's does.
- **The closed hat ends at 80 ms**, where the recording fades on to
  110 ms at −60 dB, and it is 0.2–1.2 kHz dark.
- **13 of the 30 strongest lines are missing.** A pulse's duty sets the
  balance of its harmonics, not where they fall, and the drive's
  intermodulation lines land between the recording's.
- **Two series are every third harmonic of 301.1 and 212.1 Hz**, which
  the four operators play as fundamentals of 903.4 and 636.35 Hz, and
  the 369.6 and 522.7 Hz oscillators show no series of their own. Four
  operators carry the four series heard; no engine change for the
  oscillator count is proposed.
