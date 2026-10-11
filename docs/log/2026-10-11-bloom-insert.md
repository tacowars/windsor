# The Bloom insert: a harmonic pad generator

- **Date:** 2026-10-11
- **Status:** proposed (tacowars's design decisions of 2026-10-11; the
  card's mockup approved the same day, decision 15)
- **Links:** windsor#712 (the insert, epic windsor#710) · the wet-path slot record
  `2026-10-11-wet-path-slot` (epic windsor#686) · the switch lanes record
  `2026-10-06-insert-switch-lanes`, which decision 13 amends · the cost note
  `docs/research/2026-10-11-bloom-insert/`

## Context

Windsor can colour, delay and diffuse a part, but nothing turns a part into
a sustained harmonic layer of its own. The main use asked for is ambient
work: feeding a voice, a pluck or a field recording through an insert that
answers every note it hears with a held, string-machine-like pad.

Bloom is that insert. It follows the pitch of whatever goes through it in a
four-octave window, builds a band-limited waveform on every note it finds
and mixes the result back with the dry signal. Its behaviour at the
defaults is set by the design's target curves; the fitted constants live in
the kind's constants files, one file a module.

## Decisions

1. **A new insert kind, Bloom (`bloom`),** usable on any part strip, group,
   send bus and the master. It is a worklet insert, stereo in and out, with
   the generator mono in. It holds no reverb and no chorus: put a reverb
   after it, and a chorus in its slot (decision 10). Each stays a separate,
   reusable effect.
2. **One knob a function.** Each control does one thing and nothing is
   ganged into a macro. Bloom runs in a DAW with a screen and lanes, so the
   cost of more knobs is small and every continuous one can be automated.
3. **Default-neutral levers.** Swell, Sustain, Freeze, Spread, Shape,
   Bright, Octave, Scale, Low, High, Focus and Density each leave the core's
   output bit for bit at their defaults, and the core is what the target
   curves describe. A lever off its default costs only while it is engaged.
4. **The controls.** Every control is a k-rate parameter; the continuous
   ones are smoothed over 20 ms.

   | Control | Range | Default | What it does |
   |---|---|---|---|
   | Amount | 0–100 % | 100 % | The layer's level, squared law |
   | Mix | 0–100 % | 50 % | dry = min(1, 2(1 − Mix)), wet = min(1, 2·Mix): 50 % is dry plus the full layer |
   | Swell | 0–10 s | 0 | Attack on each band's level, 90 % of the way in Swell seconds |
   | Sustain | 0–30 s | 0 | A band whose input has left falls 60 dB in Sustain seconds, at its own pitch |
   | Freeze | off / on | off | Holds every sounding band: the chord becomes a drone, new input passes dry only |
   | Spread | 0–100 % | 0 | Even bands lean left, odd bands right, equal power. 0 is exactly mono |
   | Shape | 0–4 | 2 (saw) | One sweep: sine, triangle, saw, square, then a pulse narrowing from ½ to 0.1 |
   | Bright | −12…+6 dB/oct | 0 | Tilt on the partials, power kept within 0.35 dB |
   | Octave | −12, 0, +7, +12, +19, +24 st | 0 | Each band generated at that interval, as the just ratios ½, 1, 3/2, 2, 3, 4 |
   | Key | C…B | C | Root for Scale |
   | Scale | chromatic, major, minor, dorian, mixolydian, pentatonic major, pentatonic minor | chromatic | A band outside the scale is moved to the nearest scale note, ties down, before Octave |
   | Low, High | F2…E6 | F2, E6 | The lowest and highest active band. A narrow range is cheaper |
   | Focus | ×0.5…×2 | ×1 | Every band's width, at constant level. Narrow rings longer and speaks later (onset at 220 Hz: 86 / 49 / 11 ms at ×0.5 / ×1 / ×2) |
   | Density | 0–100 % | 1 − 1/1.8 (1.8:1) | The shared compressor's ratio, 1/(1 − Density), with makeup pivoted at −12 dBFS so the layer doesn't move |
   | On | | on | The standard `enabled` switch, faded over `INSERT_SWITCH_FADE_S` |

5. **The analysis** runs decimated, at the host rate over 4 (44.1, 48 kHz)
   or 8 (88.2, 96 kHz), about 12 kHz.
   - The input is summed to mono, (L + R)/2, and brought down by a cascade of
     four boxcars of the factor's length. Its nulls sit on the images, at
     least 68 dB down at 48 kHz. Its droop is made up in each band's gain.
   - **48 bands,** one per equal-tempered semitone from F2 to E6
     (87.3–1318.5 Hz at A440), fixed in Hz at every rate. Each is a two-pole
     complex Butterworth band-pass, half-bandwidth 0.0192·f + 0.93 Hz, whose
     output z gives the note's amplitude and phase directly.
   - **Selection.** A band sounds only while the input's frequency is inside
     its semitone: the angle of a smoothed z[n]·conj(z[n−1]) (4 ms) tested
     against the band's edges by cross products, no arctangent, behind a
     2 ms gate. A quarter tone belongs to the band below. Nothing below
     70 Hz or above 1409 Hz is used.
6. **Dynamics.** One compressor shared by every band, then a ceiling on each.
   - The detector is the decimated input through a linear-phase 1.7 kHz
     low-pass, its peak held over 100 ms, followed with a 20 ms attack and a
     100 ms release. The law is (1 + (e/T)²)^(−q/2) · e²/(e² + X²), with T and
     X at −60 dBFS and q from Density.
   - The ceiling holds each band's fundamental near −12.8 dBFS at Amount
     100 %, with the same attack and release.
7. **The envelope.** At the defaults each band follows its level instantly.
   - Swell is a one-pole attack. Sustain holds what the input charged over
     100 ms and lets it fall 60 dB in Sustain seconds. The input counts as
     gone about 6 ms after it stops at 220 Hz, read on the band's first
     filter stage.
   - A held band turns by the turn captured just before its input left, so
     it stays within a cent of its note. When the input comes back it
     crossfades over 20 ms. A band an onset only passed through, or one
     outside Low…High, is held 20 ms.
   - Freeze holds every sounding band, gates the input off over 50 ms, and
     lets go with a 60 dB fall over max(Sustain, 50 ms).
8. **Pitch.** Each band's phase is re-pitched by its ratio (Octave times the
   Scale correction).
   - A whole ratio is an exact power of the phase, locked to the input.
   - A fractional ratio drives a unit phasor per band from the input's turn,
     renormalised each sample so it can't drift.
   - Each band's partial count is capped under Nyquist at its centre × its
     ratio. An Octave, Key or Scale change fades the layer out over 5 ms,
     retunes and fades back in.
9. **Synthesis at the host rate.**
   - **Wavetables.** The band-limited saw and triangle at every partial
     count a band can need, up to 0.45 × the rate or 24 kHz (about 270
     partials at F2). About 0.5 MB a sample rate, built once when the
     worklet loads by an FFT on the portable sine and cosine, and shared by
     every Bloom. Square and pulse are two saw reads; Shape crossfades two
     reads, keeping the saw's power within 0.05 dB.
   - **Segments.** The synthesis renders segments of about 1/6000 s (8 host
     samples at 44.1/48 kHz, 16 at 88.2/96 kHz). Each band's level ramps
     linearly across a segment and its phase moves by one uniform increment,
     so its frequency is steady within it.
   - **Level-following darkening.** Each band runs through a one-pole
     low-pass whose corner follows its level after the shared compressor:
     about 20 kHz at −6 dBFS, 10 kHz at −12, 3.6 kHz at −24, 1.6 kHz at −36,
     400 Hz at −60. Its gain is 1 and its phase 0 at the band's fundamental,
     so it shapes only the partials above. A band recomputes the filter only
     when its corner has moved more than 0.5 % since it was last set
     (`cornerTolerance`); the filter and its phase lead are always updated
     together.
   - **Tone.** The summed layer runs through a fixed linear-phase FIR (13
     taps at 48 kHz, scaled with the rate) for the layer's 10.7 kHz roll-off.
     Bright adds a tilt of half-octave shelves pivoted at 1 kHz, within
     0.6 dB of the law up to 18 kHz, and a per-band gain, so partial k of
     every band moves by exactly k^β. The tilt is skipped at 0.
   - **Output.** The layer's gain is fitted so a −12 dBFS sine at 220 Hz
     gives a fundamental 3.3 dB under the input at Amount 100 %. Spread's
     pan, Amount and Mix follow.
10. **Timing and latency.** The dry path is stereo and undelayed. The layer
    is late by the bands' group delay, which is part of the sound (about
    50 ms at 220 Hz, 12 ms at 1175 Hz), plus 0.4 ms of its own: the
    decimator, one segment and the FIR. Bloom reports no latency.
11. **Rest and switch.** Off is the input to the bit, and switching on starts
    from rest. Bloom sleeps once its input has been silent for 300 ms and a
    whole block of the layer stays under its floor; it clears every state,
    so waking is bit-identical to a fresh insert. Nothing allocates after
    construction, and no transcendental `Math` (nor `**`) runs anywhere the
    render depends on, the constructor's tables included, so the golden
    holds on arm64 and x64 alike.
12. **Automation rows** (`automationInsertTables.ts`):
    - Amount, Mix, Spread, Density: linear, 0–1.
    - Swell and Sustain: `log`, in s, each with a small `floor` as Echo's
      Time has (`ECHO_TIME_LOG_FLOOR`); 0 sits below it. Swell's floor is
      10 ms (`BLOOM_SWELL_LOG_FLOOR`), under the 20 ms the controls are
      smoothed over, so the floor and 0 sound alike. Sustain's is 50 ms
      (`BLOOM_SUSTAIN_LOG_FLOOR`), the shortest fall Freeze lets go with
      (decision 7). The card's Swell and Sustain knobs take the same
      floors from these rows.
    - Shape: linear, 0–4. Bright: linear, dB/oct. Focus: `log`.
    - **Freeze: a `switch` lane** that holds and never ramps. Its own 50 ms
      gate keeps it click-free.
    - Octave, Low and High are stepped, and Key and Scale enums: none is a
      target.
13. **Freeze needs the switch-row rule generalised.** Decision 3 of
    `2026-10-06-insert-switch-lanes` gives `enabled` alone a switch row and
    keeps every other switch out. This record lifts that for a kind's own
    boolean fields: a kind may list one in `INSERT_AUTOMATION_FIELDS` with
    scale `switch`, and it behaves as the `enabled` lane does (decisions 1,
    2 and 5 there). `enabled` still comes from `insertKindFields`.
14. **The slot comes in a second PR,** on Windsor's built wet-path contract
    (`2026-10-11-wet-path-slot`). The first PR ships Bloom without `slot`.
    The second makes Bloom a host: `slot` in its fields, its `normalise`
    returning `slot: null`, and a `wetPath` whose `send` is the processor's
    second output (the stereo layer after Amount, before Mix) and whose
    `ret` is a native gain driven by the third output (Mix's wet share × the
    switch). Bloom's table entry becomes its own rows and then
    `slotRows('bloom')`. With an empty slot the output stays bit for bit.
    The field is additive, so neither PR moves `ARRANGEMENT_VERSION`.
15. **The card is drawn fresh in Windsor** as a mockup at the rack's height,
    and tacowars approves it before the card ticket is written (guide §4.7).
    tacowars approved `docs/design/bloom-card-mockup.html` on 2026-10-11
    (windsor#711), and the card is built to it: rules between the five
    groups and no captions, Octave a six-step knob, Freeze a latching button
    under Swell and Sustain, and Low and High never crossing. The kind is
    named **Bloom**, capitalised as the other kinds are, in pickers and
    tooltips. Its `INSERT_GROUPS` group is a new one, **Generate**, last
    after Space, holding Bloom alone: Bloom adds a layer rather than
    processing the sound.
16. **The song format gains one kind,**
    `{ kind: 'bloom', enabled, amount, mix, swell, sustain, freeze, spread,
    shape, bright, octave, key, scale, low, high, focus, density }`. It is
    additive. Octave snaps to its nearest step, and Low and High round to
    whole notes, each with a correction.

## Cost

Windsor's own bench, one instance at the defaults, ms per 128-frame quantum,
after the 0.5 % darkening tolerance:

| Rate | 48 bands sounding | A four-note chord (about 8 bands) |
|---|---:|---:|
| 48 kHz | 0.151 (5.7 % of the quantum) | 0.052 (1.9 %) |
| 96 kHz | 0.089 (6.7 %) | 0.033 (2.5 %) |

- **Method.** Node 22 on an Apple M1, the generated bundle in a minimal
  AudioWorkletGlobalScope. Two inputs looped for 4 s: one sine on each
  band's centre (the worst case), and A3, C♯4, E4, A4. Best of passes 2–4.
  The full method and the per-stage breakdown go in the research note.
- **Where it goes.** The worst case is the synthesis's per-band setup each
  segment, the darkening most of all; the sample loop and table reads are a
  small share. The typical case is mostly fixed costs: the 48-band bank
  runs every step. 96 kHz costs less a quantum than 48 kHz, because the
  analysis and the segments are counted per second.
- **Levers.** Sustain, Swell and Freeze run the envelope for all 48 bands
  while engaged; Sustain 2 s nearly doubled the typical case before the
  tolerance. Fractional Octave ratios cost about 15–25 % more. Shape off
  saw costs a second table read. Low and High lower the cost.

**Real time, Chrome 155** (Apple M1, headless; four instances at the
defaults on a looping input, metered by the bundle's own load sampler for
16 s after 3 s unmetered; two passes, 0 underruns, peaks at the sampler's
1 ms resolution). Per instance in ms a quantum, and four instances as a
share of the quantum:

| Rate | Input | Per instance, ms/q | Four instances |
|---|---|---:|---:|
| 48 kHz | a sine on every band (worst) | 0.211 / 0.196 | 31 % |
| 48 kHz | a four-note chord (typical) | 0.127 / 0.105 | 17 % |
| 96 kHz | a sine on every band (worst) | 0.102 / 0.105 | 31 % |
| 96 kHz | a four-note chord (typical) | 0.061 / 0.054 | 17 % |

96 kHz costs no more than 48 kHz because the analysis
runs at about 12 kHz at both.

## Known limits and open items

- **CPU is above the first target,** which was four worst-case Blooms within
  about 9 % of the 48 kHz quantum. tacowars accepted the current cost on
  2026-10-11. Ranked savings remain for later tickets: the darkening as a
  pre-pass, the bank's state packed into one array, and skipping idle bands
  under Sustain are each bit-exact.
- **A 12-TET grid at A440.** The bands are fixed equal-tempered semitones.
  A source tuned elsewhere falls between bands.
- **Quarter-tone level dips.** An input a quarter tone off the grid is half
  selected and comes out quieter: about 3 dB at the low end, about 7 dB
  above 700 Hz. It is part of the target curves and kept.
- **Two notes in one band** beat against each other; notes in different
  bands don't.
- **An A4 reference control** (tuning the band grid) is a possible later
  enhancement, an additive field.

## Consequences

- One more worklet bundle, `generated/bloom-processor.js`, loaded with the
  others. The wavetables add about 0.5 MB a sample rate in use, once.
- Bloom's per-sample `log2` and `2^x` are `worklet/fm/portablePowers.ts`'s,
  imported; `bloomPortable.ts` keeps only Bloom's own `bloomExp` and
  `bloomOnePoleStep`. An edit to `fm/portablePowers.ts` rebuilds both
  `fm-processor.js` and `bloom-processor.js`.
- **Amends** `2026-10-06-insert-switch-lanes` decision 3: a kind's own
  boolean field may be a switch target. Other switches, enums and stepped
  fields stay out.
- Once Bloom is in the registry, `slotRows` offers it as a child of every
  host, Echo included, with its own slot forced to none.
- The PR is `reviewed`: a new insert and a new worklet. tacowars listens to
  each lever before it merges.
