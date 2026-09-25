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
   custom waves, so they share one implementation path), started together
   and always written the same frequency. Line i's LFO is
   `cos φᵢ · sin θ + sin φᵢ · cos θ = sin(θ + φᵢ)` through two fixed-weight
   `GainNode`s, so the lines are locked by construction through any rate
   change. The unit test measures the phases from the rendered delay-time
   modulation before and after a `set` that changes both rates.
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
   - **The fake audio graph grew** a `PeriodicWave` (tested to render a cosine
     as a cosine, and a sine/cosine pair in quadrature through a rate change)
     and sub-block lags on a modulated `DelayNode` outside a cycle, clamped to
     `[0, maxDelayTime]` as the spec does, so the 1 ms line centre renders.

## Why

Staggered oscillator starts give the right offsets only at the rate they were
started at: an offset of Δt is a phase of ω·Δt, which moves the moment the rate
changes. A shared-phase basis is the only native-node way to keep three
phases exact under live rate edits without a worklet.

## Punted / alternatives

- A per-line triangle or filtered-square LFO (the Solina's is a filtered
  square, and Haible notes its three phases are not perfectly balanced): the
  basis is sinusoidal; a waveform other than the fundamental would need more
  harmonics in both waves.
- A strip-level bypass, so an A/B is one switch over several inserts: out of
  scope; the audition's A/B is three switches (ensemble off, both choruses on).
