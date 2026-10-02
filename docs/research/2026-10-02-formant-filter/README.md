# The Formant filter mode: what it costs, its makeup, and two voices to hear it on

windsor#331 gives the voice filter a sixth mode, Formant: three bandpass
peaks at a vowel's first three formants, in parallel from the same input,
which the filter's modulation moves together. The record is
`docs/log/2026-10-02-formant-filter-mode.md`. This folder holds the
measurements the ticket asks for (decisions 3 and 9, invariant 5), a
before/after parity check, and two patches for tacowars's listen. Nothing
here is shipping code.

Measured on an Apple M1 (8 cores, macOS 26.5.1), Node 24.21.0, in the FM
worklet bundle under Node, not in a browser. The "before" bundle is
`origin/main` at `99d5122`. Other sessions were running on the machine
during the benches (another Node process at 100 % of a core, a browser),
so each bench was run twice and both runs are given.

## The bench (decision 9)

`bench.mjs` renders eight held voices of `pad-drift` (spread 0, so one note
is one voice, every sustain at 0.6 or more so dormancy never engages, four
operators on algorithm 4) for 5 s, 40 rounds after two warm-up rounds, the
variants interleaved and their order rotated each round, as the #548 and
windsor#362 benches do. The patch keeps its own filter envelope (1.8
octaves, a 3 s attack), so the cutoff, or the Formant's three centres,
move through the render; "formant held" sets `envAmount` 0, a static
vowel. The vowel is 1.5 (between e and i). Reported: median ns per voice
per output sample, and each variant's median per-round difference from its
own bundle's Off (the filter's own cost), with its interquartile range.

```bash
mkdir -p <before>/packages/engine/src/worklet/generated <before>/packages/engine/src/patches
git show origin/main:packages/engine/src/worklet/generated/fm-processor.js \
  > <before>/packages/engine/src/worklet/generated/fm-processor.js
node bench.mjs <repo> <before>                 # every mode, both bundles
node bench.mjs <repo> <before> --formant 0     # the old modes alone
```

| ns per voice-sample | run 1 | filter alone | run 2 | filter alone |
|---|---|---|---|---|
| before, Off | 37.46 | | 38.93 | |
| before, LP 12 dB | 41.53 | +4.19 [3.52, 4.57] | 44.42 | +4.61 [3.83, 5.18] |
| before, BP 12 dB | 41.25 | +4.23 [3.14, 5.03] | 44.40 | +5.01 [3.95, 6.40] |
| before, LP 24 dB | 45.69 | +8.27 [7.52, 8.65] | 48.36 | +9.32 [7.31, 10.90] |
| engine, Off | 36.91 | | 39.68 | |
| engine, LP 12 dB | 42.10 | +5.07 [3.80, 5.77] | 44.39 | +4.79 [4.46, 5.59] |
| engine, BP 12 dB | 42.27 | +4.93 [3.77, 6.51] | 44.38 | +5.11 [4.35, 5.80] |
| engine, LP 24 dB | 45.21 | +8.25 [6.99, 9.26] | 46.88 | +7.68 [7.16, 8.83] |
| engine, **Formant** | 48.96 | **+11.90** [10.75, 13.23] | 51.25 | **+11.76** [10.67, 12.90] |
| engine, Formant held | 47.33 | +10.41 [9.24, 11.30] | 49.71 | +10.41 [8.72, 11.70] |

- **Against the 24 dB serial path (the ticket's 1.5× line):** the Formant
  filter alone costs **1.44× and 1.53×** the 24 dB pair's (1.26× and
  1.36× with the vowel held), on the edge of the line, as three sections
  against two predicts. The whole voice costs **1.08× and 1.09×** the same
  voice at 24 dB (1.05× and 1.06× held). The ticket's expectation, "about
  three bandpasses' worth", holds.
- **The old modes are unchanged:** Off, LP, BP and the 24 dB pair read the
  same on both bundles within the runs' spread, with Formant voices
  running in the same bundle.

### The first build: three inlined calls cost every mode 25 %

The first build wrote the sum as decision 5 spells it,
`gA · svfA.process(x, BP) + gB · svfB.process(x, BP) + gC · svfC.process(x, BP)`,
in both loops. Benched the same way (12 rounds of 3 s):

| ns per voice-sample | with a Formant variant in the run | without one |
|---|---|---|
| before, Off | 34.32 | 34.65 |
| engine, Off | **43.08** | 34.60 |
| before, LP 24 dB | 41.67 | 41.92 |
| engine, LP 24 dB | **63.81** | 41.84 |
| engine, Formant | 54.11 | — |

With a Formant voice anywhere in the bundle, which in the browser is every
FM part of the song (one `AudioWorkletGlobalScope`), every other voice ran
about 25 % slower, Off included, and the 24 dB pair cost three times what
it did: three more `Svf.process` sites with feedback spend the kernel's
inlining budget and push other inlining out. Without a Formant voice the
bundle matched the old one. Both loops now write `Svf.process`'s bandpass
out for each peak, its operations in its order, with no call, and the
first table above is that build.

### Two block-rate savings

A section whose centre and Q are those it was last tuned to keeps its
coefficients (no `Math.tan`), and a peak whose level in dB is unchanged
keeps its power of ten (no `Math.pow`). Neither changes a coefficient's
bits; both answer the inputs, so a live switch of mode or vowel retunes
(`synth/fmProcessorFilterFormant.test.ts`). Measured once (8 rounds of
3 s), dropping the three powers of ten took the filter alone from 11.49 to
10.67 ns; "formant held" above is the coefficients' saving on top.

## The makeup (decision 3)

`makeup.mjs` renders one held lone Noise carrier (white noise) for 20 s,
seeds 1 to 4, through the vowel "a" at the default resonance (0.707,
Q 5.66) and through the Bandpass mode at the same resonance, and reports
the RMS ratio times the `FORMANT_MAKEUP` the bundle was built with.

```bash
node makeup.mjs <repo>                 # the shipped reference: Bandpass at 1 kHz
node makeup.mjs <repo> --cutoff 8000   # against the patch's default cutoff
```

| seed | 1 | 2 | 3 | 4 | pooled |
|---|---|---|---|---|---|
| makeup | 1.7855 | 1.7815 | 1.7912 | 1.7900 | **1.7870** |

`FORMANT_MAKEUP` is **1.787**; rebuilt with it, the two RMS agree to
0.3 % on every seed. The Bandpass reference needs a cutoff, and white
noise through a bandpass grows with its centre: at 1 kHz it sits in the
vowels' range (between "a"'s F1 and F2, near `ai-voice`'s 900 Hz), which
is where a patch moving from one bandpass to Formant has its peak. Against
the patch's default cutoff, 8 kHz, the same measurement reads 3.777, and
an FM voice, whose energy is low, would then jump 6.5 dB louder on the
switch. tacowars may retune by ear.

## The response (acceptance)

The vowel "a" at the default resonance, from the voice's tuned sections
(`synth/fmProcessorFilterFormant.test.ts`, which also holds white noise
through the voice to this response within 0.09 dB from 200 Hz to 6 kHz):

| | F1 | F2 | F3 |
|---|---|---|---|
| table | 600 Hz, 0 dB | 1040 Hz, −7 dB | 2250 Hz, −9 dB |
| Q 5.66 (resonance 0.707) | 596.0 Hz, 0 | 1056.0 Hz, −6.27 | 2293.5 Hz, −8.47 |
| Q 40 (resonance 5 and up) | 599.9 Hz, 0 | 1040.5 Hz, −6.98 | 2251.1 Hz, −8.99 |

Each peak alone stands at its table level at every Q (the 1/Q
normalisation, within 0.01 dB); summed, each one's skirt adds to its
neighbours', which moves the third peak of "a" 1.9 % up at the default Q
and lifts F2 and F3 by about 0.5–0.7 dB. At Q 40 the skirts are gone.
Both are inside the ticket's 2 % and 1.5 dB.

## Parity: the old modes render as before

`parity.mjs` renders `ai-voice`, `pad-drift`, `lead-bell` and
`score-ghost-formants`, each forced through modes 0–4 at 12 and 24 dB with
no `vowel` field, on the before bundle and this branch's (2 s, a note-off
at 1.2 s, seed 1), and hashes each render: **40 of 40 are bit-identical**.
The golden test (every factory preset in all three paths) passes with
`fmGolden.json` untouched.

```bash
mkdir -p <before>/scripts/sound-match
git show origin/main:scripts/sound-match/render.mjs > <before>/scripts/sound-match/render.mjs
node parity.mjs <repo> <before>
```

## The audition (for tacowars's listen)

`audition/formant-audition.song.json` is a song to import on the Settings
tab of the PR's preview. 8 bars at 72 BPM in D natural minor, a chord
every two bars (i, VI, iv, v):

1. **Chant (Formant, a)**, `formant-chant`, from bar 1: a mono saw with a
   0.12 s glide, vowel 0 ("a"), resonance 1.4 (Q 11), the filter envelope
   +0.3 octaves (attack 0.12 s, decay to 0.35), key track 0, a delayed
   vibrato. A grid line of quarter notes in the third octave, with ties
   and slides.
2. **Choir (Formant, o)**, `formant-choir`, from bar 3: two detuned saws,
   vowel 3 ("o"), resonance 1.2 (Q 9.6), no filter envelope, a slow
   attack and release. The Chord Player holds each bar's chord at octave 4.

`audition/formant-chant.patch.json` and `audition/formant-choir.patch.json`
are the same two patches alone, for the Parts tab's JSON dialog (Load). The
console has no Vowel knob yet (the editor ticket), so to hear another vowel
edit `filter.vowel` in that dialog (0 a, 1 e, 2 i, 3 o, 4 u, a fraction between).
