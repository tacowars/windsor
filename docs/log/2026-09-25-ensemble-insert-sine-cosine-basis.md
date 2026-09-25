# The ensemble insert: a new kind, phase-locked by a sine-and-cosine basis

- Date: 2026-09-25
- Area: audio
- Links: issue #695 · research `docs/research/2026-09-25-695-ensemble.md`

## Decision

1. **`ensemble` is a new strip insert kind** (#695 decisions 5–8), not a mode
   on the chorus: three native `DelayNode` lines, each swept by the sum of a
   slow and a fast LFO at its own phase (0°, 120°, 240°), a lowpass `tone`
   after the lines, an equal-power `width` placing the lines left / centre /
   right, and a wet input that is the mono sum of the strip's stereo input.
   No AudioWorklet.
2. **Phase lock by a sine-and-cosine basis** (decision 6). Each rate is a pair
   of `OscillatorNode`s playing a sine and a cosine `PeriodicWave` (both
   custom waves, so they share one implementation path), started at one
   scheduled time, whose frequencies both follow **one `ConstantSourceNode`**
   (their own `frequency.value` is 0). Line i's LFO is
   `cos φᵢ · sin θ + sin φᵢ · cos θ = sin(θ + φᵢ)` through two fixed-weight
   `GainNode`s, so the lines are locked by construction at any rate. The unit
   tests measure the phases from the rendered delay-time modulation before and
   after a `set` that changes both rates, run the same measurement on a pair
   started 20 ms apart as a negative control, and pin the shared source.
3. **Decided during implementation, beyond the issue:**
   - **The chorus gains `enabled`** (default on; off is Mix 0, the dry signal
     exactly). Decision 10 keeps the old two-chorus chain in the Solina strip
     *disabled*, and the chorus kind had no way to be disabled; a saved chorus
     without the key reads as on and sounds unchanged.
   - **Presets are a generic `inserts/insertPresets.ts`** (`applyInsertPreset`,
     `matchingInsertPreset`, and a `source` with URLs and a `measured` flag), used
     by the chorus and the ensemble; the existing kinds' banks are left alone.
   - **Presets never write Width, Mix or the on switch**, as the phaser's and
     the delay's never write Mix. The ensemble's default Mix is 1 (the Solina
     has no dry signal) and its default Width is decision 8's 1.
   - **The fake audio graph grew** a `ConstantSourceNode`, scheduled `start(when)`, an a-rate oscillator `frequency`, a `PeriodicWave` (tested to render a cosine
     as a cosine, and a sine/cosine pair in quadrature through a rate change)
     and sub-block lags on a modulated `DelayNode` outside a cycle, clamped to
     `[0, maxDelayTime]` as the spec does, so the 1 ms line centre renders.

## Why

Staggered starts — one oscillator per line, started a third of a period apart
— need the start offset computed from the rate (up to 6.7 s of silence at
0.05 Hz), and once running they hold that offset only as long as every rate
write reaches every oscillator on the same frame. Two `.value` writes in one
JavaScript task carry no such guarantee: a render quantum can fall between
them, and at 6 → 10 Hz one 128-frame quantum is a permanent 3.8° error (#695
review, pass 2). Here the phases come from fixed weights, not from start
times, and a rate edit is a single write into the one source both
oscillators of a pair follow.

## Punted / alternatives

- A per-line triangle or filtered-square LFO (the Solina's is a filtered
  square, and Haible notes its three phases are not perfectly balanced): the
  basis is sinusoidal; a waveform other than the fundamental would need more
  harmonics in both waves.
- A strip-level bypass, so an A/B is one switch over several inserts: out of
  scope; the audition's A/B is three switches (ensemble off, both choruses on).
