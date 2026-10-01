# Drum bank: TR-808, TR-909 and Elektron-style FM

Forty-one percussion patches in `packages/engine/src/patches/`
under the **Drums** category: sixteen `tr808-*`, fourteen `tr909-*` and eleven
`efm-*` (the Machinedrum's "Enhanced FM" drum family, the Elektron shape).
Each file's `description` is its audition note. This page records how the
originals make their sounds, which of those mechanisms the four-operator
engine can reproduce and how, and where the recipe had to bend.

## What the originals do

Sources read for this bank, all public: Werner, Abel and Smith's DAFx-14
physically-informed 808 bass-drum model and Werner's schematic notes; the
808 and 909 service notes on archive.org; Baratatronix's circuit write-ups
(808 clap, cymbal/hat, rimshot, toms, congas, maracas); Sound On Sound's
*Synth Secrets* on snares, cymbals and cowbells; Robin Whittle's TR-909
modification notes; the Machinedrum, Analog Rytm, Syntakt and Digitone II
manuals; Chowning's 1973 FM paper. Values marked "≈" were derived in forum
threads rather than measured in a paper.

| Voice | Mechanism | Numbers |
|---|---|---|
| 808 bass drum | A 1 ms trigger pulse rings a bridged-T band-pass; for the first ~5 ms the centre frequency jumps by more than an octave (the "punch"); a slow leak drops the pitch a little over the body. The output opens on a step, and at high Tone the trigger pulse leaks through as a flat ~1 ms pulse | measured at Decay A / C / D: body 49.6 / 51.2 / 52.3 Hz over 40–150 ms (lower at a short Decay, the pitch sagging as it fades); −40 dB at 80 / 556 / 1056 ms; opening step 0.4 / 0.85 / 0.4 of the peak at Tone 03 / 06 / 04 (write-ups: body 45–56 Hz, punch ≈ +16 semitones for 4–6 ms) |
| 808 snare | Two bridged-T resonators plus white noise through a highpass; "snappy" is the noise decay | measured (Tone C 06): 175 and 345 Hz (1:1.97), steady; the lower −20 dB re its start at about 67 ms, the upper gone within 40 ms; snappy a 1.8–7 kHz band falling 0.47 dB/ms from the hit, as loud as the tones over the hit (write-ups: 180 and 330 Hz, 1:1.83) |
| 808 handclap | White noise → band-pass → two VCAs: one driven by a sawtooth that restarts every 10 ms while a 30 ms pulse is high, so three ramps and a fourth uninterrupted discharge; the other a smooth 100 ms "reverb" decay | measured: bursts at 0, 10.9 and 23.4 ms, the tail from 30.5 ms; each burst 10 dB down in 1–2.5 ms; one band peaking about 1 kHz, 9–17 dB down at 500 Hz and 15–20 dB at 8 kHz, the tail darker; tail −40 dB 240 ms after its onset (write-ups: band-pass ≈ 1 kHz; 3 × 10 ms + 20 ms; tail 100 ms) |
| 808 hats and cymbal | Six square oscillators summed, band-passed in two bands, then highpassed per voice | 205.3, 304.4, 369.6, 522.7, 540, 800 Hz; bands 3440 and 7100 Hz; closed 50 ms, open 90–600 ms, cymbal 350–1200 ms. Measured hats: four line series at 819.55, 541.2, 903.4 and 636.35 Hz, each with every harmonic (the last two every third harmonic of 301.1 and 212.1 Hz), carry 75 % of the line energy, filled between the lines to 19–20 dB under them; closed centroid 11.5 kHz, opening on its loudest sample 7 dB above its body, −40 dB at 75 ms; open centroid 8.3 kHz, −20 dB at 531 ms, −40 dB at 613 ms |
| 808 cowbell | Two pulse oscillators through a band-pass; a loud impact then a tail | measured: 540 and 817 Hz (1:1.51), both with even harmonics; −10 dB within 10 ms, −40 dB at 360 ms (write-ups: 587 and 845 Hz, band-pass ≈ 2.64 kHz) |
| 808 rimshot / claves | Two resonators (rimshot) or one (claves) hit by a 10 ms pulse | measured: rimshot ≈ 1820–1850 and 440 Hz, gone in 15 ms, its negative half-cycles the larger; claves a pure 2575 Hz sine that starts at its crest, −20 dB at 17 ms (write-ups: 1667 and 455 Hz; 2500 Hz) |
| 808 toms / congas | A bridged-T resonator; toms add dark lowpassed noise, congas skip it; the diodes drift the pitch down as it fades | measured toms: 88 / 138 / 188 Hz, a near-pure sine starting at its crest, under a semitone of drift in the first 30 ms, −20 dB at 175 / 115 / 95 ms, no noise above 2 kHz after 5 ms; congas 185 / 280 / 400 Hz at 180 / 100 / 80 ms |
| 909 toms | Two rounded triangles about 1:1.63 apart sharing one pitch envelope, plus noise | measured mid tom: 92.7 and 56.9 Hz settled, the upper starting about 4 semitones sharp and gliding down over 300 ms; −20 dB at 233 ms |
| 808 maracas | White noise → VCA → highpass, an attack-release shape whose rise is ¾ of the length | 25–35 ms total |
| 909 bass drum | A triangle VCO rounded towards a sine by back-to-back diodes; a pitch envelope starts high and sweeps to the base; "attack" is a click plus a short filtered-noise burst | sweep decay set by Tune, ≈ 50–100 ms in use |
| 909 snare | Two tones sharing a short pitch pulse; a fixed short noise burst plus the "snappy" noise, whose envelope holds before decaying | measured (Clean D 06): 181 and 290 Hz settled (1:1.60), near-sines decaying together, about 6 semitones sharp at 5 ms and 1.5 at 15 ms; snappy flat over 1.4–11 kHz, holding for 30 ms and gone by 100 ms (write-ups: rounded triangles, pitch pulse 100–200 ms decay) |
| 909 handclap | As the 808 but four chained ramps, then the reverb path | measured: three bursts at 0, 11.3 and 23.8 ms, each holding 3–4 ms before it falls, the tail from 30.1 ms; the band peaking 850–1000 Hz, 12–22 dB down at 500 Hz, the tail darker (8 kHz at −42 dB); tail −40 dB 275 ms after its onset (write-ups: ≈ 11 ms apart; band-pass ≈ 1140 Hz, Q ≈ 1.95) |
| 909 hats, crash, ride | 6-bit samples in ROM, pitch by playback clock | not synthesised on the machine |
| Machinedrum EFM | Every machine: pitch, decay, modulation depth, modulator frequency, modulator decay. BD adds a pitch ramp and modulator feedback; SD noise and a highpass; XT a click; **CP a clap count and clap decay**; HH a tremolo; CB and CY feedback | no numeric defaults published |
| Chowning's FM drum | Carrier 200 Hz, modulator 280 Hz (1:1.4), index falling from its maximum to 0 over the note; a "wood drum" at 80 / 55 Hz with index 25 → 0 | 0.2 s |

## How the engine does it

The engine is four operators with per-operator envelopes, one global
filter, one global pitch envelope and one LFO per voice
(`.claude/skills/windsor-engine/references/synth-behavior.md`). The bank
leans on five of its features:

- **Trigger-mode envelopes.** Every drum envelope runs in `loopMode` 2
  (TRIGGER): note-off is ignored, the envelope runs attack → decay → release
  on its own, so a 1/32 grid gate and a held key give the same hit. Sustain
  level 0 and a 5 ms release end the voice; the pool is never tied up.
- **Exponential decays are negative curves.** `decayCurve` −0.7 … −0.85 is
  the capacitor-discharge shape; a positive curve holds then drops. A
  "hold flat then fall" envelope (the 909 snappy, the clap burst gate) is
  decay to sustain 1 with curve 0, then the fall as the release.
- **The analog claps' bursts are envelopes**
  (`docs/research/2026-10-01-tr-clap-fit/`, record
  `2026-10-01-tr-claps-fitted`), fitted to tacowars's picks (808 From
  Mars `Clap A 808`, TR-909 From Mars `Clap 909 Clean`). Both recordings
  are three bursts and a tail at uneven gaps, which one LFO period cannot
  place. Algorithm 5: D is the one Noise operator, held at level 0.353553,
  where a phase-modulated sine loses its carrier line and turns to white
  noise, so the fixed sines A, B and C are three noise sources with their
  own Trigger envelopes. A plays burst 1 (Init 1 falling through the
  attack) and burst 2 (a decay of 0 steps it to the sustain level at the
  burst's onset, the release is its fall); B and C are silent through an
  attack as long as their onset, step, and fall through the release: burst
  3 and the tail. The LFO is off, so every value sits inside the Rate
  knob. The colour is a 2-pole highpass (the band's steep low side and
  peak) and the drive's tone pole (its gentle high side); the 909 is
  driven hard. The EFM clap has no noise at all, as the Machinedrum's
  EFM-CP has no noise parameter: a square LFO at 100 Hz hard-gates a fixed
  1720 Hz carrier four times while a 1900 Hz carrier decays smoothly, both
  under two fed-back inharmonic modulators dense enough to read as noise;
  its rate is still above the Rate knob's 40 Hz.
- **Two Noise operators need an algorithm that evaluates D..A.** The voice's
  one noise stream is drawn in evaluation order, and the fixed-index kernel
  only takes a two-noise voice on algorithms 0, 3 and 8 (`fmProcessorKernel.test.ts`
  holds every factory patch to the kernel), at most two carriers. The 909
  snare folds its fixed burst into the snappy's opening so it needs one
  Noise operator; the claps take one Noise modulator into three sine
  carriers instead (above).
- **Kick bodies play the machine's pitch on C4.** The 808 kicks and the
  EFM kick sit at body ratio 0.198425 (2^(−4/12) of the old 0.25), so each
  plays 52 Hz on C4, the percussion note the sequencer defaults to. The
  909 kicks sit at 0.188819, 49.4 Hz on C4: the 909 recordings settle at
  49.2–49.9 Hz by the sound-match toolkit and an FFT
  (`2026-10-01-tr909-kicks-refitted`). Every other
  note-tracking ratio in those patches moved by the same factor, so the
  patch's internal ratios are unchanged. The old 0.25 followed the
  console's old ratio floor; the Coarse / Fine pair floors the stored ratio
  at `RATIO_MIN`, which is 0.0625 since #618 (`ratioSplit.ts`, and its test
  round-trips every library ratio), and the engine is unclamped
  (`2026-10-01-kicks-tuned-to-c4`). The FM Kick (`kick`, ratio 1) is not a
  machine voice and keeps its tuning. The 808 and 909 kicks have since
  moved to their own recordings' pitch (below), which tacowars kept at the
  listen.
- **The 808 and 909 kicks are fitted to recordings**
  (`docs/research/2026-09-30-kick-fit/`), and since refitted: the 808s
  (next point) and the 909s (`docs/research/2026-10-01-tr909-kick-refit/`,
  record `2026-10-01-tr909-kicks-refitted`). The 909s are fitted to Short
  C 04, Medium C 03, Medium F 05 (the hard kick: Tune near the top) and
  Long A 04: a 25–28 semitone sweep from its peak (Init 1), decaying to a
  sustain level and then released to the base, so it keeps falling after
  the punch; Tune is that sweep's length (at 20 ms, 96 Hz on C, 166 Hz on
  F, 67 Hz on A). The body holds 56–69 ms before the tail. The 909's
  lopsided body, its negative half-cycles taller (1.35 of the positive in
  the first cycles on the machine), is the voice drive, `soft` with a bias
  of 0.29–0.45 and its tone fitted; the filter is Off. Its edge is a
  `Square D` with an attack of 0 and its locked phase in the square's
  negative half, so the voice goes straight to a negative step as the
  recordings do. Every kick operator is phase-locked (`phaseFree: false`),
  as the circuits start the same way every hit.
- **The 808 kicks are refitted click first**
  (`docs/research/2026-10-01-tr808-kick-refit/`, record
  `2026-10-01-tr808-kicks-refitted`), to tacowars's picks: Decay A Tone 03
  (`tr808-kick-short`), Decay C Tone 06 (`tr808-kick`) and Decay D Tone 04
  (`tr808-kick-long`). Algorithm 4: A the body sine and B a short FM knock
  at the same ratio, both phase-locked; C the click; D silent. The body
  starts at a locked phase with an attack of 0 to 1 ms, so the hit opens
  on a step; on `tr808-kick` a `Square D` at 1 Hz with Init 1 holds a flat
  1.9 ms pulse beside it (the trigger pulse the machine leaks at high
  Tone), on the short kick a zero-attack `Square D` edge adds a 0.1 ms
  tick, and on the long one C sits at level 0. The punch holds 13–18
  semitones for 6–7 ms, drops to 3–7 and glides 100–200 ms onto the
  recording's body pitch (body ratios 0.1876, 0.193888, 0.194085; 49–51 Hz
  on C4 once settled, as the machine sags lower at a short Decay). The
  filter is Off; the voice drive runs near unity gain with a small bias
  (Diode on `tr808-kick`, Soft on the others).
- **Diode rounding is negative feedback.** Three 909 kicks carry
  `feedback` −0.18 to −0.22 on the body operator: odd harmonics that fade
  as the level does, which is what the diodes do to the triangle (the
  short kick's fit landed on +0.28). The fitted 909 toms
  round their two Triangle operators with `tone` 0.07 instead, the lower
  tone with feedback −0.79 and the upper +0.3.
- **The tonal percussion is fitted to recordings**
  (`docs/research/2026-10-01-tr-percussion-fit/`): the three 808 toms, the
  rim shot, the claves and the cowbell, and the 909 mid tom, whose low and
  high siblings are it a fourth down and up. A long, exponential-looking
  tail is the trigger-mode breakpoint: decay to a sustain level, then the
  release runs on to zero with no note-off. The 808 toms, rim shot and
  claves and the 909 toms are phase-locked; the cowbell's oscillators run
  free, as on the machine. The 909 tom is two tones about 1:1.63 apart under
  the one pitch envelope, so they beat as the recording does.
- **Noise colour is the Noise operator's own, or the global filter.** The
  Noise wave is white per sample and ignores pitch, and a Noise operator
  ignores any modulator (so a modulator into a Noise op is wasted); an FM
  carrier driven by white noise gives a line plus a white floor, never a
  band (at Noise level 0.353553 the line vanishes and the carrier is white
  noise under its own envelope, which the claps use). Since windsor#362 a
  Noise operator has its own two-pole Butterworth lowpass and highpass,
  `noiseLp` and `noiseHp` (Hz, 0 off), on its noise before its level and
  envelope, so a snare, clap or hat can shape its noise without the voice's
  one SVF, which the tonal operators share, and without a second operator
  (`2026-10-02-operator-noise-colour`). The shipped snares predate the
  fields: their snappy is still white above a near-open highpass (32 and
  58 Hz), because a voice highpass high enough to shape it (the 808's
  measures near 1.8 kHz) would take the tones with it
  (`2026-10-01-tr-snares-fitted`), and their refit to the fields is its own
  ticket (windsor#365). The 909 tom keeps its FM-coloured noise, which
  windsor#361 measured closer than the operator's own filters
  (`docs/research/2026-10-01-tom-noise-colour-prototype/`).
- **Metal is a square bank or an inharmonic stack.** The 808 hats and
  cymbal sum four of the six bank frequencies as unbandlimited squares
  (Square D) through a resonant highpass or the 3440 Hz band with the
  7100 Hz band envelope-opened for 100 ms. A fit of the 808 hats to their
  recordings (`2026-10-01-tr808-hats-fitted`) put four Pulse operators at
  the recordings' four line series, driven hard together so they
  intermodulate; at the listen they read as tonal FM hats, not the 808's
  noise burst, so they ship as the FM Closed Hat and FM Open Hat
  (`fm-hat-closed`, `fm-hat-open`) and the 808 hats stay as they were. The 909's sampled hats and
  cymbals are FM stand-ins: a 1.41-ratio modulator into three square
  carriers, or fed-back inharmonic sines. The EFM hats are an 11.3-ratio
  modulator with positive feedback into a low carrier.

Kicks, snares, toms, congas, cowbells, rims and the zap **track the key**
with C4 (MIDI 60, the percussion note) as the reference tuning: on C4 the
808 kicks play 52 Hz and the 909 kicks 49.4 Hz, as above. Hats,
cymbals and claps are **fixed** or pitch-independent, as on the machines.
Everything is `mono` with retrigger, so a closed hat on the same part chokes
an open one.

## Verification and what it cannot say

Each file is one `packages/engine/src/patches/<id>.json` at patch format 2,
with no headroom record (record `2026-09-28-retire-the-headroom-record`); a
new or edited file needs `node scripts/patch-library-index.mjs --write`, and
no sweep. The lab used to author the bank measured, per patch, the
peak, the time to −20 / −40 / −60 dB, spectral centroid over the first,
mid and late windows, the strongest partials and a 1 ms amplitude view of
the clap bursts, so the numbers in the descriptions are what the engine
renders, not what the knobs suggest. None of that is a listening verdict;
that is tacowars's, in the console with velocity and the keyboard.
