# The output stage replaces the safety limiter

- **Date:** 2026-09-29
- **Status:** accepted (tacowars, refined on windsor#72; built in windsor#93;
  the listening verdict is pending)

## Context

The engine's last node before the destination was the browser's
`DynamicsCompressorNode`, built in `synth/fmEngine.ts` as a safety limiter
(threshold −6 dB, knee 0, ratio 20, attack 3 ms, release 150 ms). PR #69,
lining the stems up against the master, measured two things it did in
headless Chrome 153 (`docs/research/2026-09-29-stem-render-accuracy/`):

- it delayed the master by 288 frames at 48 kHz, 6 ms: its lookahead, which
  is not a setting. Every master WAV started 6 ms after bar 1, and the stems
  in a zip sat 6 ms ahead of the master;
- it added makeup gain even below its threshold: a master that peaked at
  0.36 came out at 0.53. It coloured every master, not only a hot one.

Neither can be switched off on the node, and neither is specified closely
enough to compensate. windsor#72 was refined with tacowars into an output
stage of Windsor's own, split into the engine (windsor#93) and the UI
(windsor#94).

## Decision

1. **Placement.** The stage replaces the compressor in the same place: after
   `engine.master`, the last node before the destination. The aux path
   (audition, metronome) goes through it, as before. The scope and
   master-strip taps stay where they are. It is a worklet, so it is built in
   `FmEngine.init()`; before that the master reaches nothing.
2. **Four modes:** `limiter` (the default), `soft`, `hard` and `off`.
3. **Ceiling.** A song setting in dBFS, −12 to 0, default −1. In every mode
   but `off` the output never exceeds it, and a signal under it passes at
   unity, bit for bit: no makeup gain and no level change in any mode.
4. **Limiter.** Stereo-linked. Without lookahead the gain follows what the
   loudest sample needs with a 0.1 ms one-pole attack; with lookahead (a song
   setting, default off) the audio is delayed 1.5 ms and the gain is a moving
   average of the sliding minimum of what the next 1.5 ms need, so it is down
   when the peak arrives and the attack is a ramp across the lookahead. Both
   release with an 80 ms one-pole and snap back to exactly 1 once within
   1e-6 of it. A final hard clip at the ceiling catches what the attack lets
   through. Toggling lookahead while playing restarts the limiter from
   silence; the click is accepted.
5. **Soft clip.** An original rational curve: the identity up to 6 dB under
   the ceiling (the knee), then `k + (c − k)·u / (1 + u)` with
   `u = (|x| − k) / (c − k)`, which leaves the knee at slope 1 and approaches
   the ceiling without reaching it. Not a plain `tanh`, which would colour
   quiet material.
6. **Hard clip.** Clamp at the ceiling.
7. **Oversampling.** Both clippers run at 2× through a 31-tap Blackman
   half-band FIR, up and down. Only the clipper's residual (the curve's
   output less its input) is filtered and added back to the delayed input, so
   a signal the curve never touches comes out bit for bit. The sum is clamped
   at the ceiling, since the decimated residual can ring past it. The filters
   delay the output by 15 frames, which the stage reports.
8. **Off** passes the signal bit for bit and still measures its peaks.
9. **Latency.** `outputStageLatency(settings, sampleRate)`: 0 for `off` and
   the plain limiter, the lookahead (72 frames at 48 kHz) with it, 15 for the
   clippers. The offline render runs that many frames longer and reads the
   master that much later than the stems, so the master WAV starts on bar 1
   in every mode and the stems line up with it at offset 0.
10. **Settings are k-rate parameters** (`mode`, `ceilingDb`, `lookahead`),
    set in place: no graph is rebuilt, and a value set before an offline
    render starts holds from its first frame, which a port message would not.
11. **Telemetry.** The processor posts at the peak meter's rate whenever the
    context runs: input and output sample peaks for L and R, the limiter's
    deepest gain reduction in dB, the clippers' largest excess over the
    ceiling in dB, and whether the stage changed any sample. `OutputStage`
    exposes `read()`, `revision` and `subscribe()`; the live one is
    `FmEngine.outputStage`.
12. **Song document.** `MasterSpec` gains an optional
    `output: { mode, ceilingDb, lookahead }`, normalised in full when present
    (a missing field takes its default, an out-of-range one is clamped with a
    correction). A live partial `output` merges over the settings in force.
    It is additive, so `ARRANGEMENT_VERSION` is not bumped. An old song loads
    on the limiter at −1 dBFS and plays about 3 dB quieter than before: the
    old node's makeup gain is gone. That is an engine fix, not a format
    change.
13. **Cost,** measured in headless Chrome 154 on an Apple M1: 1.2 to 4.4 ms
    of render-thread time per second of audio by mode, against 1.8 to 2.1 for
    the node it replaces (`docs/research/2026-09-29-output-stage-cost/`).
14. **Allocation-free and pinned.** `process` allocates nothing;
    `mixer/outputStageGolden.test.ts` pins every mode, with lookahead off and
    on, and a render with live changes, against
    `__fixtures__/outputStageGolden.json`.

## Consequences

- The worklet folder `worklet/outputStage/` has no `tsconfig.json` of its
  own: the processor declares the three worklet-scope names it reads and
  compiles in the engine's project, so no new entry was needed in the root
  `typecheck` script. Its DSP classes initialise every numeric field at its
  declaration, so a field never starts as `undefined`.
- The UI (the master strip's controls and meters, the top-bar light, and the
  export dialog's text that still names the limiter) is windsor#94.
