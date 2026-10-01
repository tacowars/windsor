# Drum bank: TR-808, TR-909 and Elektron-style FM

Forty percussion patches in `packages/engine/src/patches/`
under the **Drums** category: sixteen `tr808-*`, thirteen `tr909-*` and eleven
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
| 808 bass drum | A 1 ms trigger pulse rings a bridged-T band-pass; for the first ~5 ms the centre frequency jumps by more than an octave (the "punch"); a slow leak drops the pitch a little over the body | body 45–56 Hz; punch ≈ +16 semitones for 4–6 ms; decay 50–800 ms |
| 808 snare | Two bridged-T resonators plus white noise through a highpass; "snappy" is the noise decay | 180 and 330 Hz (1:1.83), body ~60–120 ms, noise 100–600 ms |
| 808 handclap | White noise → band-pass → two VCAs: one driven by a sawtooth that restarts every 10 ms while a 30 ms pulse is high, so three ramps and a fourth uninterrupted discharge; the other a smooth 100 ms "reverb" decay | band-pass ≈ 1 kHz; 3 × 10 ms + 20 ms; tail 100 ms |
| 808 hats and cymbal | Six square oscillators summed, band-passed in two bands, then highpassed per voice | 205.3, 304.4, 369.6, 522.7, 540, 800 Hz; bands 3440 and 7100 Hz; closed 50 ms, open 90–600 ms, cymbal 350–1200 ms |
| 808 cowbell | Two pulse oscillators through a band-pass; a loud impact then a tail | 587 and 845 Hz (1:1.44); band-pass ≈ 2.64 kHz |
| 808 rimshot / claves | Two resonators (rimshot) or one (claves) hit by a 10 ms pulse | 1667 and 455 Hz; claves 2500 Hz |
| 808 toms / congas | A bridged-T resonator; toms add dark lowpassed noise, congas skip it; the diodes drift the pitch down as it fades | toms 90 / 135 / 185 Hz at 200 / 130 / 100 ms; congas 185 / 280 / 400 Hz at 180 / 100 / 80 ms |
| 808 maracas | White noise → VCA → highpass, an attack-release shape whose rise is ¾ of the length | 25–35 ms total |
| 909 bass drum | A triangle VCO rounded towards a sine by back-to-back diodes; a pitch envelope starts high and sweeps to the base; "attack" is a click plus a short filtered-noise burst | sweep decay set by Tune, ≈ 50–100 ms in use |
| 909 snare | Two rounded triangles, the lower with the longer decay, sharing a short pitch pulse; a fixed short noise burst plus the "snappy" noise, whose envelope holds flat 24 ms before decaying | pitch pulse 100–200 ms decay |
| 909 handclap | As the 808 but four chained ramps, then the reverb path | ≈ 11 ms apart; band-pass ≈ 1140 Hz, Q ≈ 1.95 |
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
- **The clap's burst gate is the LFO.** A saw-down LFO at 100 Hz (808) or
  91 Hz (909), retriggered on note-on, with `toOp` depth 1 on the burst
  noise operator: the operator's amplitude ramps 2 → 0 every period, the
  808's restarting sawtooth. The burst operator holds 30 ms (808) or 41 ms
  (909) then falls in 12 ms, so the third or fourth ramp is the uninterrupted
  discharge; the tail noise operator has no LFO and a 110–170 ms exponential
  decay. `lfo.modWheelDepth` is 0 so the wheel cannot wreck the gate. The
  EFM clap has no noise at all, as the Machinedrum's EFM-CP has no noise
  parameter: a square LFO hard-gates a fixed 1720 Hz carrier four times
  while a 1900 Hz carrier decays smoothly, both under two fed-back inharmonic
  modulators dense enough to read as noise.
- **Two Noise operators need an algorithm that evaluates D..A.** The voice's
  one noise stream is drawn in evaluation order, and the fixed-index kernel
  only takes a two-noise voice on algorithms 0, 3 and 8 (`fmProcessorKernel.test.ts`
  holds every factory patch to the kernel). The analog claps therefore sit on
  algorithm 8, Series + Tap, whose two carriers A and B are the burst and the
  tail with C and D silent; the 909 snare folds its fixed burst into the
  snappy's 24 ms hold so it needs one Noise operator.
- **Kick bodies play the machine's pitch on C4.** The 808 and 909 kicks
  and the EFM kick sit at body ratio 0.198425 (2^(−4/12) of the old 0.25),
  so each plays 52 Hz on C4, the percussion note the sequencer defaults
  to; the recordings the kicks were fitted to settle at 52 Hz. Every other
  note-tracking ratio in those patches moved by the same factor, so the
  patch's internal ratios are unchanged. The old 0.25 followed the
  console's old ratio floor; the Coarse / Fine pair floors the stored ratio
  at `RATIO_MIN`, which is 0.0625 since #618 (`ratioSplit.ts`, and its test
  round-trips every library ratio), and the engine is unclamped
  (`2026-10-01-kicks-tuned-to-c4`). The FM Kick (`kick`, ratio 1) is not a
  machine voice and keeps its tuning.
- **The 808 and 909 kicks are fitted to recordings**
  (`docs/research/2026-09-30-kick-fit/`), three Decay settings each plus
  the 909 at full Attack. The 808's punch is the pitch envelope starting at
  its peak (Init 1) and holding +22 semitones for about 4.3 ms, so one fast
  cycle sounds before the body, then a two-step fall over about 30 ms. The
  909's is a 32-semitone sweep over 45 ms at curve −0.32, which stays high
  for 10–20 ms; its body holds full level 50–80 ms before the tail. Each
  attack edge is a `Square D` operator at a fixed frequency and a locked
  phase, whose step lands after the operator's first 0.67 ms amplitude
  ramp. Every kick operator is phase-locked (`phaseFree: false`), as the
  circuits start the same way every hit.
- **Diode rounding is negative feedback.** The 909 toms carry `feedback`
  −0.35 … −0.6 on the body operator, and the 909 kicks about −0.13: odd
  harmonics that fade as the level does, which is what the diodes do to
  the triangle.
- **Noise colour is the global filter only.** The Noise wave is white per
  sample and ignores pitch, and a Noise operator ignores any modulator (so a
  modulator into a Noise op is wasted); an FM carrier driven by white noise
  gives a line plus a white floor, never a band. Coloured noise therefore
  comes from the voice's one SVF, which the tonal operators share — the 808
  snare keeps its 180 / 330 Hz resonators by highpassing at 130 Hz rather
  than the circuit's higher cutoff.
- **Metal is a square bank or an inharmonic stack.** The 808 hats and
  cymbal sum four of the six bank frequencies as unbandlimited squares
  (Square D) through a resonant highpass or the 3440 Hz band with the
  7100 Hz band envelope-opened for 100 ms. The 909's sampled hats and
  cymbals are FM stand-ins: a 1.41-ratio modulator into three square
  carriers, or fed-back inharmonic sines. The EFM hats are an 11.3-ratio
  modulator with positive feedback into a low carrier.

Kicks, snares, toms, congas, cowbells, rims and the zap **track the key**
with C4 (MIDI 60, the percussion note) as the reference tuning: on C4 the
machine kicks play 52 Hz, as above. Hats,
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
