/**
 * Tape's sleep on silence (windsor#793), the plate's pattern (`reverb/reverbProcessor.ts`,
 * `docs/log/2026-09-15-silent-voices-and-plate-sleep-floors.md`): a tape on a part that is not
 * playing costs its fixed call and a cheap path, not its EQ, magnetic core and transport delay.
 *
 * - The tail. After an awake block whose input was under `TAPE_SLEEP.inputFloor`, `settle` reads
 *   what the DC block wrote to the transport delay that block. Every write under `outputFloor`
 *   counts the block toward `TapeDsp.sleepSpan` (the delay's ring and the core's 48 samples); one
 *   over it, or a loud input, starts the count again. At the span the ring holds only quiet
 *   writes, and the tape sleeps. The DC block's settle is the wait before the count starts.
 * - Asleep, the wet path is frozen where it stood, not cleared: the EQ, the core's oversamplers
 *   and its magnetization, the DC block, the ring and its write head. Every output it holds is
 *   under the floor, and a woken tape resumes the state a tape that never slept would have, but
 *   for that inaudible residue, so the core keeps its remanence across a rest.
 * - Every asleep frame runs `TapeDsp.advance`, exactly as awake: the controls' glides, the
 *   switch's fade, the motion's clocks and random draws, the dropouts, the noise, the model
 *   weights and the core's glide (windsor#802, the rule of Advanced Drive's `rest`). So a
 *   control moved in a gap, or the motion turned on there, wakes mid-glide on the bits of a tape
 *   that never slept, its wow, flutter and dropouts where that tape has them. The hiss stays
 *   audible (windsor#793's decision 3, its second option: the core and the EQ sleep while a cheap
 *   noise path runs): the frame adds the noise through the dropout and trim to the dry ring, the
 *   awake channel's arithmetic with the frozen ring's read at 0. While the hiss's target is off
 *   and its gain has fallen under `hissSnap`, the gain lands at 0, so the wet is exactly 0.
 * - The wake: the processor checks each block's input before rendering it, and a block with any
 *   sample over the input floor wakes the tape and renders in full, so nothing is lost.
 *
 * Each function is one call a block over the DSP and passes no double (worklet rules 2 and 6):
 * an asleep frame reaches `advance` in `TapeDsp.input`. The asleep block is `renderAsleep`,
 * dispatched by the processor outside its awake loop, so V8 keeps that loop optimised as the
 * plate's does.
 * Pinned by `inserts/tapeSleep.test.ts`, and on V8 by `inserts/tapeAllocation.test.ts` through
 * `__fixtures__/tapeChangeScenario.ts`'s silence, sleep and wake.
 */
import { TAPE_BOUNDS, TAPE_SLEEP } from '../../inserts/tapeConstants';
import type { TapeDsp } from './tapeDsp';

/** True when every sample of the block's input is within the floor; an absent channel is silence. */
function inputQuiet(
  left: Float32Array | undefined,
  right: Float32Array | undefined,
  frames: number,
): boolean {
  const floor = TAPE_SLEEP.inputFloor;
  if (left !== undefined)
    for (let i = 0; i < frames; i++) if (left[i] > floor || left[i] < -floor) return false;
  if (right !== undefined && right !== left)
    for (let i = 0; i < frames; i++) if (right[i] > floor || right[i] < -floor) return false;
  return true;
}

/**
 * After an awake block of quiet input that started at ring slot `from`: count it toward the
 * span when every write the block left in the transport delay is under the output floor, and
 * sleep at the span.
 */
function settle(dsp: TapeDsp, from: number, frames: number): void {
  const floor = TAPE_SLEEP.outputFloor,
    left = dsp.buffers[0],
    right = dsp.buffers[1],
    length = left.length;
  let at = from;
  for (let i = 0; i < frames; i++) {
    if (left[at] > floor || left[at] < -floor || right[at] > floor || right[at] < -floor) {
      dsp.quietFrames = 0;
      return;
    }
    at = at + 1 === length ? 0 : at + 1;
  }
  dsp.quietFrames += frames;
  if (dsp.quietFrames < dsp.sleepSpan) return;
  dsp.quietFrames = 0;
  dsp.asleep = true;
}

/**
 * Once an asleep block, after `configure`: with the hiss's target off, a gain fallen under
 * `hissSnap` lands at 0, so the noise it scales is exactly 0 and the asleep output with it.
 */
function rest(dsp: TapeDsp): void {
  if (dsp.targets.hiss <= TAPE_BOUNDS.hiss[0] && dsp.noiseGain < TAPE_SLEEP.hissSnap)
    dsp.noiseGain = 0;
}

/**
 * An asleep block, the processor's dispatch outside its awake loop: `rest`, then each frame from
 * `left` and `right` (an absent channel is silence) through `advance`, and the wet over the dry
 * ring as the awake channel mixes it with the frozen ring's read at 0: the noise through the
 * dropout and the trim.
 */
function renderAsleep(
  dsp: TapeDsp,
  left: Float32Array | undefined,
  right: Float32Array | undefined,
  out: Float32Array[],
  frames: number,
): void {
  rest(dsp);
  const frame = dsp.input,
    magnetic = dsp.magnetic,
    ring = magnetic.dry,
    latency = magnetic.latency,
    outLeft = out[0],
    outRight = out[1];
  for (let i = 0; i < frames; i++) {
    frame[0] = left === undefined ? 0 : (left[i] ?? 0);
    frame[1] = right === undefined ? 0 : (right[i] ?? 0);
    dsp.advance();
    const wet = dsp.noise * (1 - dsp.motion.dropout) * dsp.trim,
      mix = dsp.mix,
      at = magnetic.dryAt;
    let dry = ring[at];
    ring[at] = frame[0];
    outLeft[i] = mix < Number.EPSILON ? dry : dry + mix * (wet - dry);
    dry = ring[latency + at];
    ring[latency + at] = frame[1];
    if (outRight !== undefined) outRight[i] = mix < Number.EPSILON ? dry : dry + mix * (wet - dry);
    magnetic.dryAt = at + 1 === latency ? 0 : at + 1;
  }
}

export { inputQuiet, renderAsleep, settle };
