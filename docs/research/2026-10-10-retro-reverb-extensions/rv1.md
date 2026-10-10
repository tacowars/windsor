# RV-1: Retro Reverb early reflections, CPU and loudness

Measured 2026-10-10 for the Early knob (`worklet/retro/retroEarly.ts`).

## Setup

- Machine: Apple M1, macOS 26.7.1.
- Backend: Node v24.21.0 (V8 13.6.233.17-node.53), offline. No browser: the
  numbers are sequential `process()` calls on the generated bundle, not
  real-time Chrome load.
- Script: `docs/research/2026-09-24-682-retro-reverb/bench.mjs`, adapted to
  take the bundle path as an argument (its hard-coded path predates the
  fork) and to set `early`. 48 kHz, 128-frame quanta, Mix 1, defaults
  otherwise, a 0.25 sine input. Each figure is the median of 10 one-second
  runs after 2 warm-up runs, divided down to one instance and one quantum.
- Before: the bundle at `0b43b7b` (main, RV-0 merged). After: this branch.
  Three interleaved rounds, each column in round order.

## Cost per quantum, one instance (µs)

| Bundle | Mode | Early | 1 instance | 16 instances (per instance) |
|---|---|---|---|---|
| main | reverb | n/a | 9.43, 9.26, 9.48 | 9.38, 9.42, 9.89 |
| RV-1 | reverb | 0 | 9.43, 9.46, 9.76 | 9.41, 9.51, 10.18 |
| RV-1 | reverb | 1 | 11.35, 11.40, 11.20 | 11.46, 11.58, 11.54 |
| main | gated | n/a | 38.23, 38.21, 39.74 | 38.41, 38.21, 39.85 |
| RV-1 | gated | 0 | 38.22, 38.84, 40.31 | 38.60, 38.77, 39.82 |
| RV-1 | gated | 1 | 39.03, 38.56, 37.73 | 38.84, 39.44, 37.87 |

- Early 0 is within the run-to-run spread of main: the taps do not run.
- Early above 0 in reverb mode adds about 2 µs a quantum (about 20 %): eight
  interpolated reads per internal sample, at 23,437.5 Hz.
- In gated and reverse the taps do not run (their level is Early times the
  reverb mode's share), so Early costs nothing there.

## Loudness against the tank

An impulse of 0.5 at Character 0, Decay 1.4, Mix 1, through the generated
processor. Energy is the sum of squares over the left channel, in dB.

| Size | Early 1, reflections only | Tank, whole response | Tank, first 200 ms |
|---|---|---|---|
| 0.5 | −15.5 | −19.3 | −19.8 |
| 1 | −15.3 | −21.3 | −22.0 |
| 3 | −15.5 | −24.6 | −26.6 |

`earlyTrim` (0.58) was set from the Size 1 row before it was applied: with a
trim of 1 the reflections read −10.5 dB, so 0.58 (−4.7 dB) puts Early 0.5 at
the tank's −21.3 dB and Early 1 at 6 dB above it. The reflections' level does
not change with Size (only their times do), while the tank's spreads over a
longer response, so at Size 3 the same Early reads relatively louder.
