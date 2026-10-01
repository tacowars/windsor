# Fitting the 808 and 909 kicks to recordings

tacowars found the drum bank's kicks short of the machines' punch
(`docs/design/drum-bank.md`) and asked whether the engine could do better.
This fits the seven kick patches to clean recordings of the machines and
records how, and how close they come.

## The references

Samples From Mars *808 From Mars* and *TR-909 From Mars*, the clean digital
bass-drum one-shots (24-bit, 44.1 kHz, "group normalized per voice"),
supplied by tacowars. They are a commercial pack: they are **not** in the
repository, only the numbers measured from them. The pack's own names give
no knob map for the kicks, so the axes were read from the audio:

| Pack | Name part | Knob | How it was told |
|---|---|---|---|
| 808 | folder `A` / `B` | accent off / on | the pack's About file |
| 808 | letter `A`–`F` | Decay | time to −40 dB: 80 ms, 185 ms, 560 ms, 1.06 s, 2.3 s, 4.4 s |
| 808 | number `01`–`06` | Tone | the click above 1 kHz rises from 0.09 to 0.63 of the peak |
| 909 | `Short` / `Medium` / `Long` | Decay | time to −40 dB: 125, 255, 510 ms |
| 909 | letter `A`–`F` | Tune | the sweep lengthens: at 20 ms, 60 Hz on A and 176 Hz on F |
| 909 | number `01`–`06` | Attack | the click rises from 0.23 to 0.33 of the peak |

Each patch was fitted to one hit, accent off and every other knob at its
middle (letter `C`, number `03`), except 909 Kick Hard (Attack `06`):

| Patch | Reference |
|---|---|
| `tr808-kick-short` | 808 `A/BD A 808 Decay B 03` |
| `tr808-kick` | 808 `A/BD A 808 Decay C 03` |
| `tr808-kick-long` | 808 `A/BD A 808 Decay E 03` |
| `tr909-kick-short` | 909 `BD 909 Clean Short C 03` |
| `tr909-kick` | 909 `BD 909 Clean Medium C 03` |
| `tr909-kick-long` | 909 `BD 909 Clean Long C 03` |
| `tr909-kick-hard` | 909 `BD 909 Clean Long C 06` |

## What the old patches missed

`before-808.png` and `before-909.png` overlay the old patches on the
references (black the recording, red the render; each panel's third plot is
the part above 1 kHz, the click).

- **909: the sweep fell far too early.** 230 Hz at 5 ms and 160 Hz at 10 ms
  on the machine; 86 and 72 Hz on the old patch, whose −0.85 decay curve
  spent half its 26 semitones in the first 5 ms. The punch is the sweep
  staying high for 10–20 ms.
- **909: the body holds, then falls.** Full level for 50–80 ms, then an
  exponential tail; the old body decayed from the first cycle.
- **909: the attack is a sharp edge above the body.** The old click, a
  Noise operator at Level 0.3 (level is squared: 0.09) behind a 900 Hz
  lowpass, was nearly inaudible.
- **808: one fast cycle before the body.** The circuit's punch is one whole
  cycle of about 5.5 ms (about 180 Hz), then a kink into the body. The old
  pitch envelope fell away within 5 ms, so that cycle never completed.
- **808: the pitch settles within about 30 ms**, not over the whole decay
  (the old patch drifted a semitone across 500 ms with the LFO).
- **Both: the start phase.** Both machines start the waveform the same way
  every hit; `phaseFree: true` started each operator at a random phase, so
  the transient varied by about 1.2 dB from hit to hit.

## Method

`kick.mjs` renders a patch through the shipped
`worklet/generated/fm-processor.js` under Node at 48 kHz, as the worklet
harness does, one note-on at velocity 1 on G#3 (MIDI 56, the machines'
52 Hz). The Python side (`ana.py`, `fit.py`, `wfit.py`; numpy and scipy)
compares a render with a recording:

- **per cycle**: frequency from zero crossings two apart, and peak level,
  both on a 500 Hz lowpass copy (`fit.cyc`); pitch error in semitones over
  2–150 ms (808) or 4–150 ms (909), and the error in dB of the level
  envelope's shape out to about the recording's −40 dB point, floored at
  −40 dB. Each envelope is divided by its own body peak first, so this
  measures how the level moves over time, not the absolute level: the
  pack is normalised per voice, so its absolute level says nothing about
  the machine, and the patches' levels are set against the old kicks
  instead (below);
- **waveform**: mean squared error over the first 30 ms, both peak
  normalised, the best of any 0–3 ms lag (`wfit.wscore`); the 909
  recordings are aligned 1.5 ms before their attack edge, since they carry
  about 2.5 ms of near silence before it;
- **click**: the level above 1 kHz in 1 ms bins over the first 10 ms.

`fitvar.py` runs Nelder–Mead over the pitch envelope, the body envelope,
start phases and the click operator from a starting patch
(`python3 fitvar.py 909 tr909-kick <recording.wav> out.json 0.6 255`).
The patch's structure is fixed by hand; the fit finds the numbers.

## The patches

- **909**: algorithm 6 as before. A is the body: sine, feedback −0.13,
  start phase 0; its envelope decays to sustain 1 (the hold) and the
  trigger-mode release is the tail. B is the attack edge: `Square D` at a
  fixed 128–162 Hz with its phase set so the square's step lands at about
  1 ms, after the operator's first 32-sample amplitude ramp, decaying in
  2–5 ms. C and D, the old FM layer (D>C), stay at fitted levels (C 0.01–0.22, D 0.13–0.57). The pitch envelope is
  32 semitones over 45 ms at curve −0.32 in all four; the Decay variants
  differ in the hold and tail (50/112, 60/203, 70/475, 80/474 ms).
- **808**: algorithm 4 (D>C | B>A). A is the sine body; B a short FM knock
  into it; C a `Square D` at a fixed 36–46 Hz, phase near 0, 0.5 ms long:
  the Tone knob's edge. The pitch envelope starts at its peak (Init 1),
  holds 22 semitones for about 4.3 ms, drops to 8–13 semitones and releases
  to 0 over 22–27 ms.
- **Every operator is phase-locked** (`phaseFree: false`).
- **The filter stays on for its drive** (drive runs only when a filter mode
  is set), lowpass opened to 8 kHz (808) and 12 kHz (909).
- **Levels**: one Volume per machine, as the hardware's Decay knob
  changes length, not level: the 808s at 1.2 (drive saturates harder
  above that), the 909s at 0.9. Rendered with `renderHit` on G#3 at
  velocity 1, against the old 808 Kick (RMS 0.322 over the first 100 ms,
  peak 0.65) and the old 909 Kick (RMS 0.199, peak 0.46, which lost 4.8 dB
  to algorithm 6's three-carrier scaling):

  | Patch | Peak | RMS, 0–100 ms | Against the old 808 Kick | Against the old 909 Kick |
  |---|---|---|---|---|
  | `tr808-kick-short` | 0.59 | 0.205 | −3.9 dB | +0.3 dB |
  | `tr808-kick` | 0.61 | 0.301 | −0.6 dB | +3.6 dB |
  | `tr808-kick-long` | 0.62 | 0.405 | +2.0 dB | +6.2 dB |
  | `tr909-kick-short` | 0.67 | 0.294 | −0.8 dB | +3.4 dB |
  | `tr909-kick` | 0.66 | 0.325 | +0.1 dB | +4.3 dB |
  | `tr909-kick-long` | 0.66 | 0.344 | +0.6 dB | +4.8 dB |
  | `tr909-kick-hard` | 0.67 | 0.354 | +0.8 dB | +5.0 dB |

  The RMS differences within a machine are its decay: a short kick has
  less energy in its first 100 ms at the same peak.

## Results

Rendered from the committed library files against their references. The
level column is the envelope-shape error above, each side normalised to its
own peak; it does not compare absolute gain:

| Patch | Pitch RMS (st) | Level-envelope RMS (dB) | Waveform MSE, 0–30 ms |
|---|---|---|---|
| `tr808-kick` before | 1.54 | 1.90 | 0.806 |
| `tr808-kick-long` before (against Decay E) | 1.34 | 10.15 | 0.978 |
| `tr909-kick` before | 5.01 | 4.46 | 0.689 |
| `tr909-kick-hard` before (against Long C 06) | 4.23 | 4.73 | 0.407 |
| `tr808-kick-short` | 0.53 | 1.95 | 0.035 |
| `tr808-kick` | 0.57 | 1.46 | 0.033 |
| `tr808-kick-long` | 0.67 | 1.11 | 0.037 |
| `tr909-kick-short` | 0.57 | 0.44 | 0.053 |
| `tr909-kick` | 0.71 | 1.02 | 0.063 |
| `tr909-kick-long` | 0.69 | 1.28 | 0.061 |
| `tr909-kick-hard` | 0.65 | 1.23 | 0.094 |

`fit-808.png` and `fit-909.png` overlay the new patches on their
references.

## What the engine cannot match

- **Edges sharper than 0.67 ms from an envelope.** An operator's amplitude
  ramps linearly over each 32-sample control block, so the fastest attack
  is about 0.67 ms at 48 kHz. The 808's onset click reaches about a sixth (0.02 against 0.12)
  of the recording's level above 1 kHz. A square operator at a locked phase
  places a sharp edge after the ramp instead; the 909's attack uses that.
- **The 909's lopsided body.** The recording's positive half-cycles are
  about 0.55 of the peak and its negative ones about 0.75; ours are
  symmetric at about 0.75. A phase-locked second harmonic might close it;
  not tried.
- **The 909's first 1.5 ms**: our body swings positive before the edge,
  where the recording goes straight to its negative peak.
- **909 Kick Hard's click** stands above its body by less than the
  recording's (about 1 : 0.7 against 1 : 0.35).

None of this is a listening verdict; that is tacowars's, in the console
and the PR preview.
