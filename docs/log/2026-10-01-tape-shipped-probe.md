# Probe the shipped Tape core in full and measure its bundle's cost

- **Date:** 2026-10-01
- **Issue:** [windsor#250](https://github.com/tacowars/windsor/issues/250),
  milestone E, step 2b of [epic #146](https://github.com/tacowars/windsor/issues/146)
- **Follows:** [the integration design](2026-09-30-tape-magnetic-integration-design.md)
  (decision 3, tests (c) and (e)), [the integration](2026-09-30-tape-magnetic-integration.md),
  [browser cost](2026-09-30-tape-browser-cost.md)
- **Research:** [`docs/research/2026-10-01-tape-shipped-probe/`](../research/2026-10-01-tape-shipped-probe/README.md)

## Context

E2 (windsor#224, PR #237) wired the magnetic core into the Tape insert, and
kept only subsets of the design record's guard test (c) and slew test (e)
in vitest to stay fast. #211 measured browser cost on research adapters,
not on the code that ships. The audition in E3 (windsor#246), and the
later removal of the losing factor, need both answers from the shipped
code.

## Decision

Run both matrices and the cost measurement once, on the shipped code at
`fa88494`, as two sequential jobs under a 900-second bound each. The
experiment was declared and committed before either run.

- **Part 1, Node**, on the shipped `TapeDsp` source, read through the
  engine fixture's `renderTape`. Test (c) is 2,520 cells of 0.25 s: every
  model × Bias {−100, 0, +100} × Drive {−32, −16, 0, +16, +32} × rate
  {44.1, 48, 96 kHz} × factor {2, 4} × a full-scale 100 Hz sine, 1 kHz
  sine, impulse and step. It asserts zero resets in every cell. Test (e) is
  84 cells of 10 s: seeded clipped white noise and alternating ±4, at
  +12 dB over full scale, at every model, rate and factor. Its resets are
  reported with no gate.
- **Part 2, headless Chrome**, on the generated `tape-processor.js`
  evaluated byte for byte. #211's harness, 20-second program (hash
  verified) and target rule are unchanged. Drive edits every 16 quanta
  land on the real `drive` AudioParam, at ±19.2. Four and one instances
  run at `oversampling` 2 and 4, steady and with edits.

## Result

On the recorded Apple M1, Node 24.21.0 and Chrome 154.0.8037.58, both
runs completed inside their bounds (268.5 s and 310.4 s), with every
declared cell recorded.

1. **No (c) cell reset.** All 2,520 cells finished with zero resets, so
   there is no blocker for E. The guard engaged in 518 cells, at Drive 0
   and above only, and held the field at exactly 4. The closest approach
   to the state guard of 20 is an impulse at Bias +100 and Drive +32 at
   2×: Studio reaches a peak |M| of 14.78 at 96 kHz. At 4× the same
   impulses stay under 4.
2. **The (e) reset rates.** Clipped noise resets the core at 2× on four of
   the seven models at 44.1 and 48 kHz, with means of 148 and 174 resets
   per second per model (up to 784 and 920), and on three at 96 kHz, with
   a mean of 515 per second (up to 2,821). At 4× it resets only Studio at
   96 kHz, 5 times in 10 s. Alternating ±4 resets nothing. These counts
   are recorded as the known limit of the qualified domain, not gated.
3. **Cost against the 1.33 ms four-instance mean target.** The shipped 2×
   path is **within** it, at 1.087 ms steady and 1.084 ms with edits (82%
   of the target). The shipped 4× path is **outside** it, at 2.075 ms and
   2.110 ms. That is 1.23–1.30× #211's research-adapter figures for the
   same factors (0.852 and 1.687 ms steady). The shipped path adds the
   retained EQ, transport, hiss and dropouts, and the kernel-derivative
   FIR at every stage point. Peak cost stays unresolved: this Chrome has no
   `renderCapacity`.

## Consequences

- E proceeds. Nothing here blocks the audition.
- The audition notes should carry statement 2: at 2×, sustained
  over-level broadband input resets the core many times a second on
  Studio, Metal, Chrome and 15ips Studio; at 4× it almost never does.
- The audition notes should also carry statement 3: on this machine only
  2× fits four instances in the mean target.
- **No product choice is made here.** Which factor ships is tacowars's A/B
  in E3.
