# Classic string machines on the 4-op engine (#686)

Research note for the `str-*` patch bank: what each classic string machine
does mechanically, which engine feature carries each element, what the engine
cannot do and the substitute chosen, and the per-patch recipe as shipped in
`packages/client/src/audio/patches/str-<slug>.json`. The scoring bank's
strings (`docs/design/scoring-preset-library.md` § Strings) are atmosphere;
these are the bright, wide, chorused string machines dance music is built on.
Sound-design choices here are not decision records; the numbers that matter
are in the patch files, which are the source.

## The engine, as it bears on string machines

Facts verified against `packages/client/src/audio/worklet/fm/` on 2026-09-24:

- **`spread` (cents)** above zero runs **two** voices per note detuned
  `±spread` cents (so the pair is `2 × spread` apart) and panned
  `±0.35 × min(1, spread / 50)` (`fmProcessor.ts`). It doubles voice cost:
  a music part has `MUSIC_PART_MAX_VOICES = 12`, so a spread patch holds at
  most six notes including release tails. Every patch below is written for
  3–4-note chords.
- **Per-operator `detune` (cents) and `ratio`** are the second detune axis:
  four operators in the additive algorithm (7, `A|B|C|D`) are four
  oscillators, and with `spread` that is eight per note.
- **`userPartials`** on an operator builds any harmonic wave, peak-normalised
  and band-limited per octave: a pulse of duty `d` is `|sin(kπd)| / k`, a
  softened saw is `1 / k^p`. The built-in `SAW` is `1 / k`.
- **Levels are squared** before the envelope (`level 0.7` sounds at `0.49`);
  a modulator's level is its index (`level² × 4` cycles ≈ 25 rad at 1).
- **One LFO** per patch: `toPitch` (semitones), `toOp` (per-operator
  amplitude), `lfoAmount` on the filter. Effective amount is
  `amount + wheel × lfo.modWheelDepth`, so `amount 0, modWheelDepth 1` is a
  wheel-only vibrato (`voiceControl.ts`).
- **One SVF filter** (LP/HP/BP/notch, 12 or 24 dB) with its own envelope, key
  tracking, and `octaves = fenv × (envAmount + wheel × filter.modWheelDepth)`.
  The filter envelope's sustain must be above zero for the wheel to open a held
  note.
- **No PWM, no per-oscillator LFO, no second filter, no unison count above
  two.** See "Engine requests".
- **The ensemble stage is the song's**: the chorus insert
  (`inserts/chorusInsert.ts`) has two delay voices (centres 11 and 17 ms, LFO
  ratios 1 : 1.37), `rate` 0.05–5 Hz, `depth` 0–4 ms, `spread` 0–1 (right
  channel's LFO at `1 − 2·spread` of the left's), `mix` 0–1; a strip carries
  up to eight inserts, a `lowCut` of 20–500 Hz and sends to the `room` plate
  (spaces `plate`, `room`, `hall`, `cathedral`, `wash`, `shimmer`) and the
  `echo` delay. A patch description therefore names its chorus settings, low
  cut and plate send rather than carrying them.

## The machines

### ARP / Eminent Solina String Ensemble (1974)

**Mechanism.** Divide-down: twelve top-octave generators are frequency-divided
into every key, so the instrument is fully polyphonic with one phase-locked,
sawtooth-like divider wave per key — there is no beating between notes and no
per-voice filter ("Filter: none"). Six footage/timbre buttons (Violin, Viola,
Trumpet, Horn, Cello, Contra-Bass; the low two monophonic on the bottom 20
keys). Amplitude is a simple attack/release circuit: the **Crescendo** slider
is the attack, **Sustain Length** the release. The sound is the ensemble:
**three BBD delay lines** driven by **two three-phase LFOs**, a slow one
(≈0.6 Hz, "chorus") and a fast one (≈6 Hz, "vibrato"), each with three outputs
120° apart, so the three lines move out of phase with one another. Stage
counts and BBD part numbers differ between early Eminent and later ARP units.

**Port.** Additive algorithm 7 with `phaseFree: false` on every operator
(the divider lock), footages as ratios — 1 (viola 8'), 1 with a 25 % pulse
(violin body), 2 (violin 4'), 0.5 with a 50 % pulse (cello 16') — and a
gentle 12 dB lowpass at 2.6 kHz standing in for the Solina's fixed formant
network. `spread 4` is deliberately small: the animation is meant to come
from the song's chorus. Attack 0.45 s / release 0.7 s are the Crescendo and
Sustain sliders at their classic positions.

**What the engine cannot do.** A triple BBD with two LFOs. Substitute: two
chorus inserts in series — rate 0.6 Hz, depth 3 ms, spread 1, mix 0.5, then
rate 5 Hz (the insert's ceiling; the Solina's is ≈6 Hz), depth 0.5 ms,
mix 0.3.

**Recipe.** `str-solina-ensemble`: alg 7; A SAW 1.0 lvl 0.62; B USER
pulse(0.25) 1.0 +5 c lvl 0.50; C SAW 2.0 −4 c lvl 0.40; D USER pulse(0.5)
0.5 +2 c lvl 0.30; all envelopes A 0.45 (curve −0.2) D 0.5 S 1 R 0.7; LP 12 dB
2600 Hz Q 0.5 keyTrack 0.3 envAmount 0.6 (env A 0.5 S 1 R 0.7) wheel 1.2
oct; LFO sine 5.8 Hz toPitch 0.25 wheel-only; spread 4; tone 0.9. Mixer:
chorus ×2 as above, low cut 120 Hz, plate 0.25.

### Oberheim OB-X / OB-Xa (1979 / 1980)

**Mechanism.** True polyphony, one discrete voice card per voice (4/6/8):
**two VCOs per voice**, each saw or variable-width pulse, with cross-mod and
sync. The OB-X's filter is the SEM's 12 dB/oct state-variable lowpass; the
OB-Xa moved to CEM3320 filters switchable **12 / 24 dB**. Strings and brass
are both VCOs, saw against pulse, slightly detuned, a slow VCA attack and a
moderate filter envelope; the OB-Xa's factory strings/brass (the "Jump" preset
is OB-Xa A1) are the reference for "wide and warm".

**Port.** Additive algorithm 7 with two saws 11 cents apart and a 35 % pulse
9 cents the other way (the two VCOs plus the pulse choice), a quiet octave saw
for the Oberheim shimmer, a 24 dB lowpass at 1.5 kHz with a 1.6-octave
envelope that opens over 0.7 s and settles at 60 %, keyTrack 0.5.
`spread 9` is the second VCO's drift across voices.

**Recipe.** `str-ob-strings`: alg 7; A SAW 1 lvl 0.70; B SAW 1 +11 c lvl
0.66; C USER pulse(0.35) 1 −9 c lvl 0.50; D SAW 2 +6 c lvl 0.28; envelopes
A 0.55 (curve −0.3) D 1.2 S 0.85 R 1.4; LP 24 dB 1500 Hz Q 0.8 keyTrack 0.5
envAmount 1.6 (env A 0.7 D 2.5 S 0.6 R 1.4) wheel 1.5 oct; LFO sine 5.2 Hz
toPitch 0.2 wheel-only; spread 9. Mixer: chorus 0.35 Hz / 2.5 ms / spread
0.8 / mix 0.4, low cut 60 Hz, plate 0.3.

### Roland Juno-60 / Juno-106 (1982 / 1984)

**Mechanism.** Six voices, **one DCO per voice** offering saw, variable-width
pulse (PWM from the LFO or the envelope) and a square sub-oscillator one octave
down, plus noise; a 24 dB/oct resonant lowpass (IR3109) with a non-resonant
highpass ahead of it; one ADSR. The sound is the **BBD chorus** (MN3009 /
MN3101): two delay lines, left and right, the right LFO inverted; **Chorus I
≈ 0.513 Hz**, **Chorus II ≈ 0.863 Hz**, delay swinging ≈ 1.66–5.35 ms;
**I + II** is a fast ≈ 9.75 Hz mono Leslie-like mode.

**Port.** Additive algorithm 7: saw, a 50 % pulse (+3 c), the square sub at
ratio 0.5, and a 20 % pulse (−4 c) whose amplitude the LFO breathes at 0.5 Hz
(`toOp[3] = 0.6`) — the substitute for PWM, since the engine has no pulse
width. LP 24 dB at 2 kHz, one octave of envelope, keyTrack 0.4. `spread 6`
gives the DCO a little of the drift a Juno never had; the chorus does the rest.

**What the engine cannot do.** PWM (see "Engine requests"); the I + II
9.75 Hz mode is above the chorus insert's 5 Hz ceiling.

**Recipe.** `str-juno-strings`: alg 7; A SAW 1 lvl 0.68; B USER pulse(0.5) 1
+3 c lvl 0.48; C SQUARE 0.5 lvl 0.34; D USER pulse(0.2) 1 −4 c lvl 0.42;
envelopes A 0.6 (curve −0.2) D 0.8 S 0.9 R 1.1; LP 24 dB 2000 Hz Q 0.6
keyTrack 0.4 envAmount 1.0 (env A 0.6 D 1.5 S 0.8 R 1.1) wheel 1.2 oct; LFO
tri 0.5 Hz amount 1 toOp [0, 0, 0, 0.6] toPitch 0.03 wheel 0.6; spread 6.
Mixer: Chorus II = chorus 0.86 Hz / 3.5 ms / spread 1 / mix 0.5 (Chorus I:
0.5 Hz / 2 ms), low cut 40 Hz, plate 0.2.

### Roland D-50 (1987) — LA synthesis strings and pads

**Mechanism.** Linear Arithmetic: a patch is two tones, each tone two
**partials**, each partial either a **PCM sample** (47 in ROM, mostly attack
transients and loops) or a **synth** waveform (saw / square / PWM) through
the **TVF** (a digital lowpass with its own envelope) and a TVA. Seven
**structures** combine the partials, one of them a ring modulator. The classic
"Fantasia" pad is a bright PCM attack over a slowly evolving synth sustain,
and the onboard **chorus and reverb** are half the sound.

**Port.** Two Stacks (algorithm 4): stack `B>A` is the synth partial — a
tilted saw (`1 / k^1.2`) with a sine at ratio 2 whose index blooms over a
second (the TVF opening); stack `D>C` is the PCM attack partial — a sine at
ratio 3 modulated by a sine at ratio 3.5 (inharmonic, so it rings like struck
glass) with 5 ms attack, 0.35 s decay, sustain 0, and `velSens 0.7` so
velocity brings the transient forward the way the D-50's velocity-to-PCM does.

**Recipe.** `str-d50-glass`: alg 4; A USER tiltSaw(1.2) 1 lvl 0.72 (A 0.35
D 1.5 S 0.85 R 1.6); B SINE 2 lvl 0.22 (A 1.0 D 2 S 0.6 R 1.6); C SINE 3
lvl 0.50 velSens 0.7 (A 0.005 D 0.35 S 0 R 0.3); D SINE 3.5 lvl 0.42
(A 0.002 D 0.2 S 0 R 0.2); LP 24 dB 3200 Hz Q 0.7 keyTrack 0.5 envAmount 0.8
(env A 0.4 D 1.5 S 0.7 R 1.6) wheel 1.2 oct; LFO sine 5.5 Hz toPitch 0.2
wheel-only; spread 8. Mixer: plate 0.45 (`hall`), chorus 0.5 Hz / 2 ms /
spread 0.7 / mix 0.45, low cut 80 Hz.

### Roland Jupiter-8 (1981)

**Mechanism.** Eight voices, **two VCOs per voice** (saw / pulse / PWM) with
cross-modulation and sync; a fixed non-resonant **highpass** ahead of a
resonant lowpass switchable **12 / 24 dB**; two envelopes (one invertible,
attacks down to ~1 ms) and a multi-wave LFO; a **unison** mode that stacks all
sixteen oscillators on one key. Its strings are brighter and cleaner than the
Oberheim's, the HPF thinning the bottom.

**Port.** Stack + Two (algorithm 6, `D>C | B | A`): saw, a 40 % pulse
+13 cents, and a second saw −11 cents carrying a low-level sine modulator at
ratio 1 (index ≈ 0.5 rad — the cross-mod grit). LP 24 dB at 2.8 kHz, Q 0.9,
keyTrack 0.6. The JP-8's HPF is the strip's low cut at 180 Hz. Unison is not
available (see "Engine requests"); `spread 7` is the two-VCO drift.

**Recipe.** `str-jp8-strings`: alg 6; A SAW 1 lvl 0.70; B USER pulse(0.4) 1
+13 c lvl 0.58; C SAW 1 −11 c lvl 0.60; D SINE 1 lvl 0.14 (S 1); envelopes
A 0.4 (curve −0.2) D 1 S 0.9 R 1.2; LP 24 dB 2800 Hz Q 0.9 keyTrack 0.6
envAmount 1.2 (env A 0.5 D 2 S 0.5 R 1.2) wheel 1.5 oct; LFO sine 5 Hz
toPitch 0.25 wheel-only; spread 7. Mixer: low cut 180 Hz, chorus 0.7 Hz /
2 ms / spread 0.9 / mix 0.4, plate 0.3.

### Roland JP-8000 Super Saw (1996)

**Mechanism.** One oscillator mode summing **seven saws**: a centre saw the
Detune knob leaves alone and six side saws, three above and three below.
Szabo's measurements (2010) give the side offsets at full detune as roughly
−0.110, −0.063, −0.020, +0.020, +0.062, +0.107 of the frequency, scaled by a
steep 11th-order **Detune curve** (shallow to 0.5, steep past 0.9); the
**Mix** knob lowers the centre linearly (`0.998 − 0.554x`) while the sides
rise on a parabola (`−0.738x² + 1.284x + 0.044`); a **highpass tracking the
fundamental** follows the sum to remove the sub-fundamental beat energy. The
synth's filter is a 12 / 24 dB multimode; eight voices.

**Port.** Eight saws per note is exactly what four saw operators plus
`spread` give: operators at ±7 and ±23 cents with `spread 15` land the pair
sets at ±8 (twice), ±22 and ±38 cents — Szabo's set at a Detune near 0.7 (about
±7, ±22, ±38 cents), with the outer pair quieter (levels 0.62 / 0.50, the Mix
curve near 0.5). The fundamental-tracking HPF has no engine equivalent
(see "Engine requests"); the strip's fixed low cut at 120 Hz is the
substitute. LP 24 dB at 5.5 kHz keeps the top from fizzing.

**Recipe.** `str-supersaw-trance`: alg 7; A SAW +7 c lvl 0.62; B SAW −7 c lvl
0.62; C SAW +23 c lvl 0.50; D SAW −23 c lvl 0.50; envelopes A 0.12 D 0.5 S
0.95 R 0.9; LP 24 dB 5500 Hz Q 0.5 keyTrack 0.4 envAmount 1.0 (env A 0.3 D
1.5 S 0.6 R 0.9) wheel 1.5 oct; LFO sine 5.5 Hz toPitch 0.15 wheel-only;
spread 15. Mixer: low cut 120 Hz, chorus 0.3 Hz / 1.5 ms / mix 0.25, plate
0.35, sidechain compressor to the kick.

### The general string-machine shape (SOS)

Sound On Sound's recipe for an "old string synth" on a modern polysynth:
two or three saws in unison, animated by independent slow LFOs rather than a
fixed detune (the emulation of separate delay lines), a slow-attack,
full-sustain, long-release amplitude envelope, a mild lowpass, and chorus,
reverb and a mid boost after. Two shipped patches follow that shape rather
than one machine:

- **`str-ambient-evolve`** (slow evolving ambient strings): Two Stacks
  (alg 4); A SAW 1 lvl 0.70 (A 2.8 curve −0.4, D 3, S 0.85, R 4.5); B SINE 2
  lvl 0.30 (A 6, D 4, S 0.5, R 4) — brightness blooms over six seconds; C USER
  tiltSaw(1.3) 1 +6 c lvl 0.62 (A 3.5, S 0.8, R 5); D TRI 3 lvl 0.20 (A 8,
  S 0.6, R 4); LFO Drift 0.12 Hz amount 1 toPitch 0.08 toOp [0, 0.4, 0, 0.5]
  wheel 0.5; LP 24 dB 900 Hz Q 1.0 keyTrack 0.3 envAmount 2.4 (env A 6 D 6
  S 0.6 R 5) wheel 2 oct; spread 11. Hold 8 s or longer. Mixer: chorus
  0.15 Hz / 3 ms / spread 1 / mix 0.5, plate 0.55 (`cathedral` or `wash`),
  low cut 50 Hz.
- **`str-edm-stab`** (tight EDM string stab): alg 7; A SAW 1 lvl 0.72; B SAW
  +12 c lvl 0.62; C USER pulse(0.3) −10 c lvl 0.50; D SAW 2 +5 c lvl 0.40;
  envelopes A 0.004 D 0.4 (curve 0.5) S 0.3 R 0.22; velSens 0.6; LP 24 dB
  700 Hz Q 1.4 keyTrack 0.5 envAmount 2.8 (env A 0.002 D 0.32 S 0.15 R 0.22)
  wheel 1.5 oct; spread 9. Gates of 60–150 ms. Mixer: chorus 0.8 Hz / 1.5 ms
  / spread 0.8 / mix 0.3, plate 0.2 (`plate`) or echo 0.3, low cut 90 Hz,
  sidechain compressor to the kick.

## Measured output

Harness renders (`__fixtures__/workletHarness.ts`, velocity 0.9, seed
`0xa204`, gate = longest attack + 1.2 s capped at 9 s, tail rendered to the
end of the longest release). "dry" is the patch with `spread` forced to 0;
"spread" is as shipped. The `headroom` column is the file's record from
`sweep-headroom.mjs` (16,384 seeds, C4, quarter-second gate — which a slow
patch has barely begun by, so it is a clip bound, not a loudness).

| Patch | Gate s | Headroom | C3 dry / spread | C4 dry / spread | C5 dry / spread | C4 held RMS | 4-note C4 | 4-note C3 |
|---|---|---|---|---|---|---|---|---|
| `str-solina-ensemble` | 1.8 | 0.089 | 0.105 / 0.180 | 0.124 / 0.202 | 0.132 / 0.237 | 0.076 | 0.479 | 0.512 |
| `str-ob-strings` | 1.9 | 0.162 | 0.107 / 0.178 | 0.110 / 0.221 | 0.134 / 0.224 | 0.058 | 0.460 | 0.463 |
| `str-juno-strings` | 1.9 | 0.144 | 0.123 / 0.183 | 0.123 / 0.191 | 0.122 / 0.243 | 0.078 | 0.495 | 0.393 |
| `str-d50-glass` | 2.2 | 0.214 | 0.102 / 0.187 | 0.101 / 0.191 | 0.100 / 0.196 | 0.072 | 0.630 | 0.554 |
| `str-jp8-strings` | 1.7 | 0.186 | 0.100 / 0.212 | 0.127 / 0.216 | 0.149 / 0.211 | 0.056 | 0.592 | 0.423 |
| `str-supersaw-trance` | 1.5 | 0.252 | 0.111 / 0.188 | 0.114 / 0.194 | 0.123 / 0.205 | 0.056 | 0.441 | 0.432 |
| `str-ambient-evolve` | 9.0 | 0.062 | 0.132 / 0.200 | 0.131 / 0.220 | 0.124 / 0.221 | 0.053 | 0.558 | 0.480 |
| `str-edm-stab` | 1.2 | 0.415 | 0.167 / 0.221 | 0.169 / 0.218 | 0.174 / 0.208 | 0.025 | 0.446 | 0.536 |

Every render was finite, audible over the last half-second of its gate at
C3, C4 and C5, and silent (< 1e-9) at the end of its release tail. The
chorus insert and the plate are Web Audio graph nodes, not worklet DSP, so
they render only in a browser (`sfx/offlineRender.ts`); their audition is the
console's, with `strings-audition.json` carrying the recommended settings.

## Engine requests

None of these is added in this ticket; each is a nearest-substitute in the
recipes above and a candidate for its own ticket.

1. **Unison count per patch** (`unison: 1..8`, cents and pan spread per
   voice). `spread` gives exactly two voices; the supersaw spends all four
   operators on saws to reach eight, leaving none for a sub or a pulse, and a
   Jupiter-8-style 16-oscillator unison is out of reach.
2. **Pulse width as a modulation destination.** No PWM exists: the Juno and
   OB-Xa pulses are static `userPartials`, animated only in amplitude. A
   `pulseWidth` on the `SQUARE` wave (or a duty parameter on the User wave)
   with LFO and envelope destinations would carry the Juno's PWM strings.
3. **A second LFO, or a per-operator LFO rate.** One LFO serves vibrato, PWM
   substitute and drift; the SOS recipe of one slow LFO per oscillator and the
   Solina's slow + fast pair both need two rates.
4. **A key-tracked highpass alongside the lowpass.** The Jupiter-8's HPF and
   Szabo's fundamental-tracking HPF are per-note; the strip's `lowCut` is
   per part and fixed. A `filter.highpass` with `keyTrack` would do it.
5. **Chorus insert: rate ceiling above 5 Hz and a three-voice mode.** The
   Solina's fast LFO is ≈6 Hz and its ensemble is three lines 120° apart; the
   Juno's I + II is ≈9.75 Hz. Two voices at ≤ 5 Hz is the closest today.

## Sources

- ARP String Ensemble: <https://www.vintagesynth.com/arp/solina-string-ensemble>,
  <https://en.wikipedia.org/wiki/ARP_String_Ensemble>; the triple-chorus
  topology: <http://jhaible.com/legacy/triple_chorus/triple_chorus.html>
  (discussed at <https://www.modwiggler.com/forum/viewtopic.php?t=51471>).
- Oberheim OB-X / OB-Xa: Sound On Sound,
  <https://www.soundonsound.com/reviews/oberheim-obx-obxa-ob8>;
  <https://en.wikipedia.org/wiki/Oberheim_OB-X>;
  <https://en.wikipedia.org/wiki/Oberheim_OB-Xa>.
- Juno-60 / 106: <https://en.wikipedia.org/wiki/Roland_Juno-106>; service
  notes,
  <https://archive.org/stream/roland_JUNO-106_SERVICE_NOTES/JUNO-106_SERVICE_NOTES_djvu.txt>;
  the chorus measurements,
  <https://github.com/pendragon-andyh/Juno60/blob/master/Chorus/README.md>.
- D-50: <https://en.wikipedia.org/wiki/Roland_D-50>;
  <https://rolandcorp.com.au/blog/roland-icon-series-the-d-50-linear-synthesizer>.
- Jupiter-8: <https://en.wikipedia.org/wiki/Roland_Jupiter-8>;
  <https://support.roland.com/hc/en-us/articles/201945109-JUPITER-8-Technical-Specifications>.
- JP-8000 Super Saw: Adam Szabo, *How to Emulate the Super Saw* (KTH, 2010),
  <https://www.adamszabo.com/internet/adam_szabo_how_to_emulate_the_super_saw.pdf>;
  <https://en.wikipedia.org/wiki/Roland_JP-8000>.
- The general shape: Sound On Sound,
  <https://www.soundonsound.com/sound-advice/q-how-do-re-create-sound-those-old-string-synths>.
- Engine facts: `packages/client/src/audio/worklet/fm/fmProcessor.ts`
  (`spread`), `voiceControl.ts` (wheel maths), `fmConstants.ts`
  (`MOD_INDEX_SCALE`), `audioConstants.ts` (`MUSIC_PART_MAX_VOICES`),
  `inserts/insertConstants.ts` (the chorus ranges), `mixer/reverbSpace.ts`
  (the plate spaces).
