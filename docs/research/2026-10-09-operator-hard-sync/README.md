# Hard sync: folded alias and CPU (windsor#646)

Record `docs/log/2026-10-09-operator-hard-sync.md`, decision 13. Two
readings of the shipped FM bundle under Node: how much folded alias energy
the two-sample polyBLEP removes from a reset, and what a synced voice costs
against the same voice unsynced.

**The polyBLEP clears the 10 dB bar on the sine and misses it on the saw.**
At MIDI 84, ratio 3.7, 48 kHz it removes 12.8 dB on a synced sine and
−0.1 dB on a synced saw. On a Pulse it makes the alias 4.8 dB worse.
Decision 13 says to raise `needs-human` before building anything better,
so nothing better is built here. "Why the saw misses" below gives the cause
and the options.

**A synced voice costs 2.3 to 3.3 times the same voice unsynced.** Almost
all of that is the generic loop (decision 7). The resets themselves add 4
to 12 % over the generic loop without sync.

## Machine and method

| | |
|---|---|
| Machine | Apple M1, 8 cores, macOS 26.7.1 |
| Runtime | Node 24.21.0 (V8). No browser: the bundle evaluated under Node, as the #548 method does |
| Backend | `packages/engine/src/worklet/generated/fm-processor.js` from this branch, a stand-in `AudioWorkletProcessor`, 128-frame quanta, seed 1. No Web Audio |
| Load | other sessions' work shared the machine: load average 2.2 to 2.5 through the runs |

These are dev-machine readings. They show relative cost on one machine and
say nothing about audio-thread headroom in Chrome.

`workletBundle.mjs` loads the bundle the way `__fixtures__/workletHarness.ts`
and `scripts/sound-match/render.mjs` do.

### Folded alias (`alias.mjs`)

```bash
node docs/research/2026-10-09-operator-hard-sync/alias.mjs . --note 84 --ratio 3.7
```

- **The voice.** One operator, a carrier at ratio 3.7, synced to the note
  and held at full level, with the voice filter off. A Pulse plays at a
  0.3 duty; the other waves are unsqueezed.
- **Three renders.**
  - `raw`: 48 kHz with the bundle's `SYNC_BLEP_GAIN` set to 0, so the
    resets are uncorrected but still a sample late.
  - `blep`: 48 kHz as shipped.
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

Alias energy in dB under the signal. The removal is `raw − polyBLEP`.

| Wave | Note | Raw | polyBLEP | 16× reference | Removed |
|---|---|---|---|---|---|
| **sine** | **84** | **−24.8** | **−37.6** | **−81.8** | **12.8** |
| **saw** | **84** | **−26.5** | **−26.4** | **−50.2** | **−0.1** |
| square | 84 | −26.7 | −30.1 | −55.3 | 3.4 |
| triangle | 84 | −24.2 | −37.6 | −80.4 | 13.4 |
| pulse (0.3) | 84 | −28.1 | −23.4 | −48.0 | −4.8 |
| sine | 60 | −31.0 | −52.1 | −88.2 | 21.1 |
| saw | 60 | −33.9 | −32.4 | −57.1 | −1.4 |
| square | 60 | −32.8 | −38.4 | −61.9 | 5.6 |
| triangle | 60 | −30.7 | −51.2 | −88.1 | 20.4 |
| pulse (0.3) | 60 | −35.1 | −29.9 | −54.9 | −5.2 |
| sine | 96 | −21.5 | −31.1 | −73.6 | 9.6 |
| saw | 96 | −23.5 | −21.6 | −46.5 | −1.9 |
| pulse (0.3) | 96 | −25.1 | −19.8 | −44.6 | −5.3 |

At MIDI 96 the operator sits at 7.7 kHz. Its square and triangle tables
hold only the fundamental there, so they read as the sine.

The arithmetic is not at fault. A sample-by-sample model of the same
bookkeeping (`d`, the held sample, the correction owed the next one), run
on a naive sine, gives the engine's figures to the tenth of a dB (−24.8 and
−37.6 at MIDI 84). Run on a naive saw that also corrects its own wraps, it
takes the alias from −10.9 to −32.1 dB.

## Why the saw misses

Decision 6 defines the step as two reads of the operator's own table: the
wave just after the reset minus the wave it would have read without it. A
reset restarts the phase at about 0. A band-limited saw's (and square's)
own edge is centred on phase 0, so the table there reads the middle of that
edge, about 0, not the bottom of the ramp, about −1.

So the read step is only part of the true jump. At ratio 3.7 the saw stands
at phase 0.7 when it is reset: about +0.4 falling to about −1, a jump of
−1.4. The table reads +0.4 falling to 0, a step of −0.4. The rest of the
jump is the second half of the table's own band-limited edge. Starting
halfway through that edge is itself a near-hard transition, and nothing
corrects it.

The square has the same edge at phase 0 and gains 3 to 6 dB. On the Pulse,
the up-read lands on its edge and the down-read lands a duty away, so the
computed step is wrong in both size and sign of error, and the correction
adds alias.

Waves with no edge at phase 0 (sine, triangle, the slope-only part of any
wave) take the correction as designed: 13 dB at MIDI 84 and 20 dB an
octave or two lower. What remains there is the slope discontinuity, which
decision 6 leaves uncorrected (no BLAMP).

## Options for tacowars

Not built (decision 13).

1. **Take the step from the ideal wave where the table has an edge at
   phase 0.** For a saw or square, read the step from the naive shape,
   −1 after a reset. Then account for the table's half-edge, either by
   subtracting it or by reading those few samples from the naive shape
   plus the BLEP. This touches only the reset path.
2. **A longer correction (minBLEP or a four-point polyBLEP), and BLAMP for
   the slope.** These are the textbook answer. They need more delay, or a
   table of residuals.
3. **Correct only where it helps.** Keep the sine, triangle and user
   waves, and leave the saw, square and Pulse uncorrected, as the
   deliberately aliasing waves are, since the correction removes nothing
   on the saw and adds alias on the Pulse.
4. **Leave it as built** and judge the factory sync leads by ear in the
   preview. Both factory patches sync a saw.

## CPU

| Scenario | synced | kernel (sync off) | generic (sync off) | synced / kernel | synced / generic |
|---|---|---|---|---|---|
| `lead-sync-sweep` | 59.4 (59.0–60.0) | 17.9 (17.7–18.2) | 56.1 (55.6–57.0) | 3.3× | +6 % |
| `lead-sync-detune` | 64.7 (63.9–65.8) | 28.6 (28.4–29.0) | 62.2 (61.6–64.2) | 2.3× | +4 % |
| `chain4` | 55.2 (54.7–55.8) | 21.9 (21.7–22.0) | 49.2 (48.8–49.7) | 2.5× | +12 % |

Figures are ns per sample of one voice, the median with its interquartile
range.

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
