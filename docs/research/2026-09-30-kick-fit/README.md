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

## Revisiting this

### Setting up again

- **Tools.** Node 24 (`.nvmrc`) for `kick.mjs` and `render.mjs`, which run
  the generated `worklet/generated/fm-processor.js`. Rebuild it
  (`node scripts/build-worklets.mjs`) first if the DSP has changed. Python 3
  with numpy and scipy for the fitting and analysis scripts; `overlay.py`
  also needs matplotlib.
- **The recordings.** tacowars's copy of Samples From Mars *808 From Mars*
  and *TR-909 From Mars*, the clean digital kick folders. Keep them
  outside the repository: they are a commercial pack, and `.gitignore` is
  not widened for them (root `CLAUDE.md`, invariants 6 and 7). The scripts
  take file paths; the folders as used here:
  - `SamplesFromMars__808_kicks_digital_clean/A/BD A 808 Decay C 03.wav`
    (folder `A` no accent, `B` accent);
  - `SamplesFromMars_909_kicks_digital_clean/02. Medium/BD 909 Clean Medium C 03.wav`
    (`01. Short`, `02. Medium`, `03. Long`).
- **Running a fit.** `python3 fitvar.py <808|909> <start patch: id or
  .json> <recording.wav> <out.json> <render seconds> <level window ms>`,
  for example `python3 fitvar.py 909 tr909-kick "<…>/BD 909 Clean Long C 03.wav" out.json 1.0 510`.
  The level window is about the recording's −40 dB time (the table under
  "The references"). The fitter writes only the patch; its renders are
  temporary files. To check a result, render the fitted patch, then
  overlay it on the recording:
  - `node render.mjs out.json 56 1 out.wav 1.0` (patch, note, velocity,
    WAV, seconds);
  - `python3 overlay.py out.png "label|<recording>|out.wav"`, with
    `EDGE=1` set for a 909 so the recording is aligned on its attack edge.
- **What `fitvar.py` assumes.** Its parameter vector is written per
  machine for the committed patches' operator layout (808: algorithm 4, C
  the square edge; 909: algorithm 6, B the square edge). A patch with a
  different layout needs its own `build()` there. Every fit renders G#3
  at velocity 1, so velocity sensitivity is not fitted.

### Sound work not yet done

Most promising first.

1. **909 Tune.** The letters A–F change the sweep's length: at 20 ms the
   Medium kicks sit at 60 Hz (A), 80 Hz (C) and 176 Hz (F). Every patch
   here fits C. Fitting the pitch envelope's amount and decay per letter
   would give a Tune mapping, or tuned variants.
2. **808 Tone.** The numbers 01–06 raise the click above 1 kHz from 0.06
   to 0.53 of the peak at Decay C (0.09 to 0.63 at Decay A); at 06 the
   recording opens with a flat pulse of about 1 ms at about 0.8. Every 808 patch fits 03. A bright variant
   could fit 06 with the `Square D` edge louder and longer.
3. **Accent and velocity.** The 808 pack has every hit with accent
   (folder `B`). Fitting operator `velSens` so a high velocity reproduces
   `B` and a lower one `A` would make the sequencer's accent behave like
   the machine's. The 909 pack has no accent axis.
4. **The 909's lopsided body.** Try a phase-locked second harmonic (a
   sine at ratio 0.5 against the body's 0.25) to make the positive and
   negative half-cycles unequal, 0.55 against 0.75 on the recording.
5. **The 909's first 1.5 ms.** The recording carries about 2.5 ms of near
   silence before its edge; our body swings positive at once. Worth one
   try, for example a short body attack with the square edge placed at
   its end; otherwise accept it.
6. **909 Kick Hard's click** against its body (above).
7. **The other TR voices.** The bank's snares, toms, congas, rims, claves,
   cowbells, claps, maracas, hats and cymbals were built from write-ups and
   never compared with recordings. The full *808 From Mars* pack covers
   every 808 voice the bank has (its About file); only its kicks were used
   here, and the 909 folders used hold only kicks. The method carries over to the tonal voices (toms, congas, rim,
   claves, cowbell). The noise voices (snares' snappy, claps, hats,
   cymbals) need a spectral score, band energy over time, in place of zero
   crossings.

### Engine candidates

For when a patch can go no further. Ranked by how much they would likely
help these sounds.

1. **Faster amplitude edges.** An operator's amplitude ramps linearly over
   each 32-sample control block (`CTRL_INTERVAL`, `worklet/fm/fmConstants.ts`),
   so no envelope edge is faster than about 0.67 ms. A per-sample attack
   segment, or a per-sample first block, would bring the 808's onset click
   (now about a sixth of the recording's) and the claps' and rims' edges
   closer. It adds per-sample work to the hot path and moves the goldens.
2. **Drive without the filter.** The soft clip runs only when the filter
   mode is not Off (`worklet/fm/voiceRender.ts`), so every kick keeps a
   wide-open lowpass just to get drive. A drive independent of the filter
   is a new patch field or mode, so a format question
   (`2026-09-28-format-versions-refuse-never-destroy`).
3. **A pitch envelope that falls in Hz.** The 909's sweep decays
   exponentially in Hz; the engine's pitch envelope moves in semitones
   along a curve. The fit still reached 0.6–0.7 semitones RMS, so this is
   low priority.
4. **A pulse source, probably not needed.** The 808's trigger pulse leaks
   a flat, one-sided pulse of about 1 ms into the output at high Tone.
   Two existing routes come first; neither has been tried yet:
   - **Width squeeze on `Square D`.** For any wave but Pulse, an
     operator's Width plays the wave in the first `width` of each cycle
     and silence for the rest (`worklet/fm/voiceRender.ts`). A `Square D`
     at a low fixed frequency, with a locked start phase of `width / 2`,
     sits at −1 for `width / 2` of a cycle, then at 0. For example, at
     10 Hz and Width 0.05 that is 2.5 ms, followed by silence the envelope
     outlasts. The pulse is negative; flip the body's phase by 0.5 if the
     sign matters.
   - **The Pulse wave** (wave 10, duty from Width). It is band-limited but
     zero-mean at any duty, so a narrow duty gives a spike with a small
     opposite offset across the rest of the cycle, not a one-sided pulse.

   An engine source is worth it only if neither shape is close enough.
5. **Pitch at control rate.** The pitch also moves once per 32 samples, so
   the 808's 4 ms punch steps about six times. Nothing measured here
   showed it; listed for completeness.

### Check these first when a kick sounds weak

From the first, sample-free pass over the old patches:

- **Level is squared.** An operator at Level 0.3 plays at 0.09 (−21 dB).
- **Several carriers are scaled down.** The carrier sum is divided by the
  square root of the carrier count, so algorithm 6's three carriers lose
  4.8 dB against algorithm 0's one.
- **The voice filter is shared.** A lowpass at a few hundred Hz removes
  the click from every operator, and drive needs the filter on (above).
- **The start phase.** `phaseFree` defaults to `true`, which randomises
  the transient by about 1.2 dB from hit to hit.
- **The master limiter.** The output stage defaults to a limiter at
  −1 dBFS with a 0.1 ms attack and an 80 ms release
  (`mixer/outputStageConstants.ts`). In a hot mix every kick triggers gain
  reduction on its own front. This was not measured in a song.

None of this is a listening verdict; that is tacowars's, in the console
and the PR preview.
