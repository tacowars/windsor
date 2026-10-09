# Hard sync: folded alias and CPU (windsor#646)

Record `docs/log/2026-10-09-operator-hard-sync.md`, decision 13. Two
readings of the shipped FM bundle under Node: how much folded alias energy
the two-sample polyBLEP removes from a reset, and what a synced voice costs
against the same voice unsynced. A Codex consult on the first round's
results is recorded beside this note, in `codex-consult.md`.

**What ships.** The polyBLEP corrects the Sine, Triangle and User waves,
with the step taken at the reset instant. At MIDI 84, ratio 3.7, 48 kHz it
takes a synced sine from −24.8 to −40.8 dB of alias under the signal, and a
triangle from −24.2 to −38.8 dB. **The Saw, Square and Pulse ship
uncorrected, pending tacowars's listen.** A synced saw there sits at
−26.5 dB, a square at −26.7 dB and a 0.3 Pulse at −28.1 dB.

**A synced voice costs 2.3 to 3.3 times the same voice unsynced.** Almost
all of that is the generic loop (decision 7). The resets themselves add 4
to 12 % over the generic loop without sync.

## Machine and method

| | |
|---|---|
| Machine | Apple M1, 8 cores, macOS 26.7.1 |
| Runtime | Node 24.21.0 (V8). No browser: the bundle evaluated under Node, as the #548 method does |
| Backend | `packages/engine/src/worklet/generated/fm-processor.js` from this branch, a stand-in `AudioWorkletProcessor`, 128-frame quanta, seed 1. No Web Audio |
| Load | other sessions' work shared the machine: load average 2.2 to 2.5 through the CPU runs |

These are dev-machine readings. They show relative cost on one machine and
say nothing about audio-thread headroom in Chrome.

`workletBundle.mjs` loads the bundle the way `__fixtures__/workletHarness.ts`
and `scripts/sound-match/render.mjs` do.

### Folded alias (`alias.mjs`)

```bash
node docs/research/2026-10-09-operator-hard-sync/alias.mjs . --notes 60,72,84,96 --ratio 3.7
```

- **The voice.** One operator, a carrier at ratio 3.7, synced to the note
  and held at full level, with the voice filter off and Tone at 1. A Pulse
  plays at a 0.3 duty; the other waves are unsqueezed.
- **Four renders.**
  - `uncorrected`: 48 kHz with the bundle's `SYNC_BLEP_GAIN` set to 0, so
    every reset is uncorrected. A corrected wave still goes out a sample
    late, which the spectrum does not see.
  - `shipped`: 48 kHz as shipped. For the Saw, Square and Pulse this is
    the uncorrected render.
  - `forced`: the Saw and Square at 48 kHz with their resets corrected as
    the Sine's are (the bundle's eligibility test replaced by `true`). Not
    shipped. The Pulse has no corrected read left to force.
  - `ref`: 768 kHz (16×) as shipped, decimated to 48 kHz through a
    2 049-tap Blackman-windowed sinc lowpass at 22 kHz.
- **The analysis.** A synced wave repeats at the note's period, so any
  component that is not a harmonic of the note is folded alias. Each
  render is analysed over 32 768 samples from 0.1 s in, through a
  four-term Blackman-Harris window. The energy within ±6 bins of each
  harmonic is the signal; everything else from 20 Hz to 20 kHz is alias,
  given in dB under the signal. The reference's figure is the measurement
  floor.

### CPU (`bench.mjs`)

```bash
node docs/research/2026-10-09-operator-hard-sync/bench.mjs . --only <scenario>
```

This is the #548 method
(`docs/research/2026-09-15-548-fm-voice-loop-specialisation`) with
windsor#382's timing (`docs/research/2026-10-02-noise-operator-cost`).

- **The note.** One held note at MIDI 60 with every envelope at its peak,
  so no operator sleeps and the voice never goes dormant.
- **The timing.** Wall time around the note's render, in ns per output
  sample. 30 rounds of 5 s, after two warm-up rounds. The variants are
  interleaved and their order rotates each round. Each scenario runs in its
  own process. The figure is the median with its interquartile range.
- **The variants.**
  - `synced`: as written. This takes the generic loop.
  - `kernel`: every sync off, the path an unsynced voice takes.
  - `generic`: every sync off with `specialise: false`. This is the
    generic loop without sync.

## Folded alias

Alias energy in dB under the signal: the absolute level of each render.
The removal is `uncorrected − shipped`.

| Wave | Note | Uncorrected | Shipped | Forced (not shipped) | 16× reference | Removed |
|---|---|---|---|---|---|---|
| sine | 60 | −31.0 | −51.0 | — | −88.4 | 19.9 |
| triangle | 60 | −30.7 | −50.6 | — | −88.4 | 19.8 |
| saw | 60 | −33.9 | −33.9 | −37.4 | −59.6 | 0 |
| square | 60 | −32.8 | −32.8 | −42.3 | −58.4 | 0 |
| pulse (0.3) | 60 | −35.1 | −35.1 | — | −63.6 | 0 |
| sine | 72 | −28.0 | −46.8 | — | −91.2 | 18.8 |
| triangle | 72 | −27.7 | −46.4 | — | −91.1 | 18.7 |
| saw | 72 | −30.3 | −30.3 | −34.3 | −56.8 | 0 |
| square | 72 | −29.3 | −29.3 | −37.7 | −55.1 | 0 |
| pulse (0.3) | 72 | −32.1 | −32.1 | — | −59.6 | 0 |
| **sine** | **84** | **−24.8** | **−40.8** | — | **−87.8** | **16.0** |
| triangle | 84 | −24.2 | −38.8 | — | −87.4 | 14.6 |
| **saw** | **84** | **−26.5** | **−26.5** | **−30.2** | **−53.3** | **0** |
| square | 84 | −26.7 | −26.7 | −33.5 | −51.7 | 0 |
| pulse (0.3) | 84 | −28.1 | −28.1 | — | −56.4 | 0 |
| sine | 96 | −21.5 | −33.3 | — | −83.9 | 11.8 |
| triangle | 96 | −21.5 | −33.3 | — | −82.7 | 11.8 |
| saw | 96 | −23.5 | −23.5 | −26.8 | −49.5 | 0 |
| square | 96 | −21.5 | −21.5 | −33.3 | −48.0 | 0 |
| pulse (0.3) | 96 | −25.1 | −25.1 | — | −53.1 | 0 |

At MIDI 96 the operator sits at 7.7 kHz. Its square and triangle tables
hold only the fundamental there, so they read as the sine.

- **Sine and triangle.** The correction removes 12 to 20 dB, most at the
  lower notes. What remains is the slope discontinuity, which decision 6
  leaves uncorrected (no BLAMP).
- **Saw, Square and Pulse.** Uncorrected, as shipped. Forcing the
  corrected reset onto them now gains 3 to 4 dB on the saw and 7 to 12 dB
  on the square, short of the 10 dB bar on the saw. Those figures are for
  information; nothing ships them.
- **The 16× reference** moved from the first round's figures (sine at
  MIDI 84 from −81.8 to −87.8 dB, saw from −50.2 to −53.3 dB), because it
  renders the shipped bundle and the bundle changed.

### The first round

The first round's bundle took the step from two positions at the next
sample (the reset phase and the free-running phase, both a sample on),
and corrected the Saw, Square and Pulse too. At MIDI 84 it removed 12.8 dB
on the sine and −0.1 dB on the saw, and made the Pulse 4.8 dB worse. Those
figures are superseded by the table above.

That timing is wrong whenever the free-running phase wraps inside the same
interval. From phase 0.95 at increment 0.1, a reset a quarter of a sample
later jumps from phase 0.975 to 0, but the first round compared phases
0.075 and 0.05. The step is now taken at the reset instant, from the
free-running phase just before the reset to phase 0, in time order.
`voiceSync.test.ts` pins that case, a wrap before, at and after a reset,
and a ratio sweep through 2.

### The naive model's figure

A sample-by-sample model of the same bookkeeping (`d`, the held sample,
the correction owed the next one), run on a naive sine, gives the first
round's engine figures to the tenth of a dB (−24.8 and −37.6 at MIDI 84).
Run on a naive saw that also corrects its own wraps, it takes the alias
from −10.9 to −32.1 dB at MIDI 84.

That −32.1 dB is a model, not the engine. Its 21 dB "removal" is measured
from a naive saw's −10.9 dB, which nothing in Windsor plays. Against the
saw Windsor plays, the uncorrected table at −26.5 dB, it is about 5.6 dB
lower. It is the only figure there is for a direct-shape correction (the
ideal wave with a polyBLEP on every edge), and that correction was not
built.

## Why the table step misses the saw

Windsor's Saw sums positive `sin(2πnp)/n` partials, so it is a falling
ramp: about +1 just after phase 0, falling to about −1 just before phase 1.
Its band-limited edge, the jump from −1 back to +1, is centred on phase 0,
and the table there reads the middle of that edge, about 0.

A reset restarts the phase at about 0, so a step read from the table is
only part of the true jump. At ratio 3.7 the saw stands at phase 0.7 when
it is reset: about −0.4, jumping to about +1, a jump of +1.4. The table
reads −0.4 rising to 0, a step of +0.4. The rest of the jump is the second
half of the table's own band-limited edge. Starting halfway through that
edge is itself a near-hard transition, and nothing corrects it.

The square has the same edge at phase 0. The Pulse is `saw(p) − saw(p +
width)`: at a 0.3 duty it holds about +0.6 up to phase 0.7 and about −1.4
after, with edges at phase 0 and at `1 − width`. A reset lands on the first
read's edge, so the table step is wrong for it too.

Waves with no edge at phase 0 (sine, triangle) take the correction as
designed.

## What the metric shows, and what it does not

The figures above measure stationary, off-harmonic energy on one held
note. They are useful for comparing two renders of that note, and no more.

- **No waveform comparison.** Each render's off-harmonic energy is set
  against its own harmonic energy. Nothing compares it with the reference.
  Wrong harmonic amplitudes, a reversed polarity and most phase errors
  score the same: a sine and its inverse give identical figures.
- **The masks.** Each harmonic's ±6 bins span ±8.8 Hz. A folded component
  that lands inside one counts as signal, and at a fundamental
  commensurate with the sample rate an alias can land on a harmonic
  outright.
- **DC is excluded** (the band starts at 20 Hz), so a wrong Pulse offset
  does not show.
- **Held notes only.** Phase modulation, detune and sweeps add legitimate
  components between the harmonics, so the metric cannot be reused for
  them as it stands.
- **The reference is the same implementation** at 16 times the rate. It
  shares any waveform mistake, and its tables hold more harmonics and are
  normalised to their own peak.
- **One case.** Ratio 3.7, unsqueezed waves, Tone at 1, no modulation.

## User waves

A User wave keeps the correction. One whose partials are saw-like (1, ½,
⅓, …) builds the Saw's table at a given pitch once its partials cover what
the table keeps, so its reset behaves as the Saw's does: the table step
misses most of the jump. The forced saw row above is the closest figure.
This is not measured.

## CPU

| Scenario | synced | kernel (sync off) | generic (sync off) | synced / kernel | synced / generic |
|---|---|---|---|---|---|
| `lead-sync-sweep` | 59.4 (59.0–60.0) | 17.9 (17.7–18.2) | 56.1 (55.6–57.0) | 3.3× | +6 % |
| `lead-sync-detune` | 64.7 (63.9–65.8) | 28.6 (28.4–29.0) | 62.2 (61.6–64.2) | 2.3× | +4 % |
| `chain4` | 55.2 (54.7–55.8) | 21.9 (21.7–22.0) | 49.2 (48.8–49.7) | 2.5× | +12 % |

Figures are ns per sample of one voice, the median with its interquartile
range. They were read on the first round's bundle, where the two factory
leads' saws were corrected and sent a sample late. This round leaves those
saws uncorrected, which removes that per-sample work from them; it was not
re-measured.

- **The scenarios.** The two factory patches, held, and `chain4`: four
  sounding operators on Additive, with B on the note, C on B and A on D.
- **The cost.** It is the generic loop's: decision 7 keeps the kernel
  untouched, so any synced voice leaves it. The per-sample sync work (the
  note phase, the inline wrap test, the held sample of each corrected
  operator) and the resets add the last 4 to 12 %.
- **What would close the gap.** A kernel path for synced voices. That is
  its own ticket, with a bench.

## A Noise operator as a master (decision 5)

A Noise operator's phase accumulator advances like any other operator's.
The generic loop, which every synced voice takes, adds its `phaseInc`,
which the control update works out from its ratio or its fixed frequency,
even though its draw never reads the phase.
So an operator synced to a Noise operator follows that accumulator's wraps,
at the Noise operator's nominal frequency. `voiceSync.test.ts` pins the
binding.
