# Each voice chooses its control interval from its state

- **Date:** 2026-10-03
- **Status:** accepted (the decisions of windsor#326), waiting on
  tacowars's listen
- **Links:** windsor#326 · windsor#301 and its PR windsor#316 (the knots
  this builds on) · windsor#323 (split renders) · measurements in
  `docs/research/2026-10-03-adaptive-control-interval/README.md`

## Context

Every sounding voice ran the control-rate update (`updateVoiceControl`:
envelopes, LFOs, glide, drive, filter coefficients, width) and the voice
kernel's per-call prologue every `CTRL_INTERVAL` = 32 samples, however
slowly it was changing. On the seven patches of `pulses-for-eighteen-tapes`,
eight parts at the 12-voice cap, the control update was about a fifth of
the FM part's time. In a pad-heavy song most sounding voices are release
tails or sustains, where nothing moves fast enough to need an update every
0.67 ms. A one-off reading in the issue put a fixed 64-sample interval at
−21 % of the eight parts' cost and a fixed 128 at −28 %; a fixed interval
would have softened every drum hit, so the interval is the voice's choice.

## Decision

1. **Per voice, at each control boundary.** `renderBlock` keeps its shape:
   at `ctrlCount === 0` the voice puts the song's lanes on itself, asks
   `controlInterval` (`voiceControlInterval.ts`) for its interval, runs the
   control update over it and sets `ctrlCount` to it
   (`updateVoiceControlBlock`). A block runs to its end, as before; events
   split the render but never a block. The sample loops are unchanged.
2. **Two intervals and two thresholds**, in `fmConstants.ts`:
   `CTRL_INTERVAL` = 32 (the fine interval), `CTRL_INTERVAL_LONG` = 128,
   `CTRL_LONG_MIN_SEGMENT_SECONDS` = 0.1 and `CTRL_LONG_MAX_LFO_HZ` = 8.
   128 is one render quantum: the control update and the kernel's prologue
   run once where they ran four times, and a long voice's blocks need no
   more bookkeeping than a fine one's.
3. **The rule.** A voice is fine while any of these holds, else long:
   - an operator's amplitude envelope, the pitch envelope while its amount
     is not 0, or the filter envelope while the filter is on and its amount
     or wheel depth is not 0, is in a running segment (attack, decay,
     release) shorter than 0.1 s after key scaling;
   - an operator's amplitude envelope is in Loop or Trigger mode and not
     done;
   - a glide shorter than 0.1 s is in progress;
   - an LFO reaches anything (a depth, its amount or its wheel depth, and a
     destination: pitch, an operator's level or width, or the filter while
     it is on) at 8 Hz or faster, **or at any rate in a shape that jumps**
     (square, sample and hold, either saw);
   - **a song lane is ramping an operator's feedback.**

   The rule reads the values the block plays, after the lanes
   (`applyVoiceOffsets`): a lane's LFO rate, amount and decay time count.
   The steal fade, the width ramps and the drive's tone pole run per sample
   and do not bear on it.
4. **The fine regime is the old render, to the bit.** With the table's
   long interval at the fine one the part renders exactly as before; the
   test sets the table (`processorOptions.controlIntervals`), not the
   constant, and `__fixtures__/fmGoldenFineInterval.json` pins every
   factory preset there. Every TR drum, every `efm-*` drum and both FM hats
   are bit-identical with the long interval on.
5. **Segment ends inside a long block are windsor#301's knots.** A long
   attack ending inside a block and a short decay after it both land on
   their own samples (`voiceAmpRamp.ts`, up to `ENVELOPE_BREAKS_MAX` a
   block). The filter and pitch envelopes keep their control-rate timing,
   now in the long block.
6. **The latency a long block adds is accepted.** A note-off, a part
   control (bend, wheel, a lane) or a live retune reaches a long voice at
   its next control boundary, up to 128 samples (2.7 ms) later, where it
   was up to 32. Trigger envelopes ignore note-off and are fine throughout.
7. **Split renders stay identical** in the long regime and across a change
   of interval, on the kernel and the generic path
   (`fmProcessorEnvelopeEdges.test.ts`).

## Two clauses beyond the issue

- **A shape that jumps.** The issue's rule left a slow square or
  sample-and-hold LFO on an operator's level long. Its jump is a transient
  at any rate: in a long block the amplitude ramp across it is 128 samples
  instead of 32 and lands up to 2.7 ms later. The library's "ticker" and
  "clock" patches (`score-hollow-ticker`, `score-dry-ticker`,
  `score-engine-pulser`, `score-corrupt-clock`, `score-slow-beacon`,
  `score-buffer-drift`) moved most of all under the issue's rule; with the
  clause they are bit-identical.
- **A feedback lane's ramp.** Both render loops time a song lane's
  feedback ramp from `CTRL_INTERVAL` (`FEEDBACK_RAMP_STEP` and
  `CTRL_INTERVAL - ctrlCount`), and the issue keeps `voiceKernel.ts` and
  `voiceRender.ts` as they are, so a voice whose feedback ramps stays fine.

## Consequences

- Pads and tails cost less; the measured figures are in the research
  note. Drum hits are unchanged.
- Patches with a slow segment, a slow smooth LFO or a slow glide change
  bits in their long blocks: envelopes and LFOs are sampled every 2.7 ms,
  amplitudes still ramped per sample. The research note lists every
  library patch's change; a patch whose amplitude attacks are all under
  0.1 s reads 0.0 dB above 2 kHz in its first 5 ms.
- A test that steps one control block a call sets the fine table
  (`fmProcessorAutomationDecayEdge.test.ts`,
  `fmProcessorAutomationDecaySlide.test.ts`); the decay lanes' click test
  reads its tight bound with every block fine and its click threshold with
  both.
- A DSP change that refreshes `fmGolden.json` also refreshes
  `fmGoldenFineInterval.json`
  (`A204_REFRESH_FM_GOLDEN=1 npx vitest run packages/engine/src/synth/fmProcessorControlInterval.test.ts`).
- Making a release start at its own sample, so a note-off has no added
  latency, is a separate ticket.
