/**
 * Song automation on the voice (windsor#346, record
 * `2026-10-01-song-automation-lanes` decisions 7, 10 and 11): the part's
 * slots read into one offset per target each quantum, and the values a
 * ringing voice plays with them, each control block.
 *
 * - `mapVoiceSlots` turns the slot map's patch paths into target codes
 *   (`voiceOffsetTables.ts`), at construction and at a `voiceSlots` message.
 * - `latchVoiceOffsets` reads every mapped slot's k-rate value into the
 *   part's offsets, a `Float64Array` by target code that every voice shares,
 *   as `partControls` carries the bend, wheel and cutoff (windsor#233).
 * - `applyVoiceOffsets` lays out what the voice already plays (the patch's
 *   value, or its step's: windsor#17) in `liveValues`, and moves each target
 *   with an offset by it, clamped to the row's bounds. The control update,
 *   the amplitude and width ramps, the filter and the LFOs read
 *   `liveValues`; the LFO rates reach the LFOs as `rateMul`.
 * - Feedback is read per sample, so it is ramped (decision 11): each block
 *   sets `fbFrom` to the last block's `fbTo` and `fbTo` to this one's, and
 *   the render loops read `fbFrom + (fbTo − fbFrom) · t` through the block
 *   while the two differ (`fbRamp`, a bit per operator).
 * - `primeVoiceOffsets` binds the values at a note-on or a rebind and starts
 *   both ends of the ramp there, so a new note plays its lanes from its
 *   first sample and a live retune's feedback is heard at once, as before.
 *
 * Invariant: an offset of exactly 0 leaves the value as it was, neither
 * clamped nor passed through a curve, and a part with no slot mapped reads
 * no slot, so a song without voice lanes renders bit for bit as before
 * (`fmProcessorGolden.test.ts`, `fmProcessorKernel.test.ts`). Functions over
 * the voice, one call a control block; allocation free, and no double
 * crosses a call (windsor#233): every value passes through the voice's or
 * the part's arrays. `synth/fmProcessorAutomation.test.ts` pins the targets,
 * `synth/fmProcessorAllocation.test.ts` the allocation.
 */

import type { Voice } from './voice';
import { OPERATOR_COUNT } from './patchDefaults';
import {
  OFFSET_RATIO,
  VOICE_OFFSET_CURVE,
  VOICE_OFFSET_MAX,
  VOICE_OFFSET_MIN,
  VOICE_SLOT_COUNT,
  VOICE_SLOT_PARAMS,
  VOICE_TARGET_COUNT,
  VT_ENV_AMOUNT,
  VT_LFO2_AMOUNT,
  VT_LFO2_RATE,
  VT_LFO_AMOUNT,
  VT_LFO_RATE,
  VT_OP_BASE,
  VT_OP_FEEDBACK,
  VT_OP_LEVEL,
  VT_OP_STRIDE,
  VT_OP_WIDTH,
  VT_PITCH_ENV_AMOUNT,
  VT_RESONANCE,
  voiceTargetCode,
} from './voiceOffsetTables';

/**
 * Map each slot to the code of the target its path names, -1 for none or a
 * path no slot carries. True when any slot is mapped. Allocates nothing; run
 * at construction and at a message, never in the render.
 */
function mapVoiceSlots(slotTargets: Int32Array, paths: unknown): boolean {
  const list = Array.isArray(paths) ? (paths as unknown[]) : null;
  let mapped = false;
  for (let s = 0; s < VOICE_SLOT_COUNT; s++) {
    const code = list && s < list.length ? voiceTargetCode(list[s]) : -1;
    slotTargets[s] = code;
    if (code >= 0) mapped = true;
  }
  return mapped;
}

/**
 * This quantum's offsets: every mapped slot's value added to its target's,
 * from 0. Run only while a slot is mapped; otherwise the offsets stay 0.
 */
function latchVoiceOffsets(
  offsets: Float64Array,
  slotTargets: Int32Array,
  params: Record<string, Float32Array>,
): void {
  offsets.fill(0);
  for (let s = 0; s < VOICE_SLOT_COUNT; s++) {
    const code = slotTargets[s];
    if (code >= 0) offsets[code] += params[VOICE_SLOT_PARAMS[s]][0];
  }
}

/**
 * The values the voice plays, in `liveValues` by target code: its own, each
 * moved by its offset and clamped to the row's bounds. A target whose offset
 * is 0 keeps its own value exactly.
 */
function bindLiveValues(voice: Voice): void {
  const patch = voice.patch!;
  const v = voice.liveValues;
  const o = voice.partOffsets;
  v[VT_ENV_AMOUNT] = voice.envAmount;
  v[VT_RESONANCE] = voice.resonance;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    const b = VT_OP_BASE + i * VT_OP_STRIDE;
    v[b + VT_OP_LEVEL] = voice.opLevel[i];
    v[b + VT_OP_FEEDBACK] = voice.opFeedback[i];
    v[b + VT_OP_WIDTH] = voice.opWidth[i];
  }
  v[VT_LFO_AMOUNT] = patch.lfo.amount;
  v[VT_LFO_RATE] = patch.lfo.rate;
  v[VT_LFO2_AMOUNT] = patch.lfo2.amount;
  v[VT_LFO2_RATE] = patch.lfo2.rate;
  v[VT_PITCH_ENV_AMOUNT] = patch.pitchEnvAmount;
  for (let k = 0; k < VOICE_TARGET_COUNT; k++) {
    const off = o[k];
    if (off === 0) continue;
    const x = VOICE_OFFSET_CURVE[k] === OFFSET_RATIO ? v[k] * Math.pow(2, off) : v[k] + off;
    v[k] =
      x < VOICE_OFFSET_MIN[k]
        ? VOICE_OFFSET_MIN[k]
        : x > VOICE_OFFSET_MAX[k]
          ? VOICE_OFFSET_MAX[k]
          : x;
  }
}

/**
 * This block's values (`bindLiveValues`), then the feedback ramp's ends and
 * the LFOs' rate multipliers. The control update's first step.
 */
function applyVoiceOffsets(voice: Voice): void {
  bindLiveValues(voice);
  const patch = voice.patch!;
  const v = voice.liveValues;
  const o = voice.partOffsets;

  // The feedback ramp's ends: a Float32Array store, as the loops have always read it.
  let ramp = 0;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    voice.fbFrom[i] = voice.fbTo[i];
    voice.fbTo[i] = v[VT_OP_BASE + i * VT_OP_STRIDE + VT_OP_FEEDBACK];
    if (voice.fbFrom[i] !== voice.fbTo[i]) ramp |= 1 << i;
  }
  voice.fbRamp = ramp;

  // An LFO's rate as a multiplier on its patch's, exactly 1 without an
  // offset; a rate of 0 has no ratio to scale, and stays still.
  const rate = patch.lfo.rate;
  voice.lfo.rateMul = o[VT_LFO_RATE] === 0 || !(rate > 0) ? 1 : v[VT_LFO_RATE] / rate;
  const rate2 = patch.lfo2.rate;
  voice.lfo2.rateMul = o[VT_LFO2_RATE] === 0 || !(rate2 > 0) ? 1 : v[VT_LFO2_RATE] / rate2;
}

/**
 * The voice's values with the part's offsets (`bindLiveValues`), and both
 * ends of every feedback ramp at its feedback, with no ramp: from `start`
 * and `rebind`, once the voice's own values are bound, so a note starts on
 * its lanes' values (`start` reads its width ramp's start here too) and a
 * live retune's feedback is heard from the next sample, as it was before
 * the ramp. A slide keeps its feedback (`slideKeeps`), and its ramp.
 */
function primeVoiceOffsets(voice: Voice): void {
  bindLiveValues(voice);
  const v = voice.liveValues;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    voice.fbTo[i] = v[VT_OP_BASE + i * VT_OP_STRIDE + VT_OP_FEEDBACK];
    voice.fbFrom[i] = voice.fbTo[i];
  }
  voice.fbRamp = 0;
}

export { applyVoiceOffsets, latchVoiceOffsets, mapVoiceSlots, primeVoiceOffsets };
