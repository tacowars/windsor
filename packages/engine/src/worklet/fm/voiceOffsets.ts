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
 * - The decay rows (windsor#347) reach the five envelopes as their decay
 *   time and curve (`applyLiveDecays`). A time is read afresh by each step
 *   of the envelope, which keeps its phase, so a running decay goes on from
 *   its level at the new rate; a curve that changes starts what is left of
 *   a running decay again from its level (`Envelope.reshapeDecay`).
 * - Feedback is read per sample, so it is ramped (decision 11): each block
 *   sets `fbFrom` to the last block's `fbTo` and `fbTo` to this one's, and
 *   the render loops read `fbFrom + (fbTo − fbFrom) · t` through the block
 *   while the two differ (`fbRamp`, a bit per operator).
 * - `primeVoiceOffsets` binds the values at a note-on and starts both ends
 *   of the ramp there, so a new note plays its lanes from its first sample.
 * - `rebindVoiceOffsets` does the same at a live retune's rebind, except for
 *   a target a slot is mapped to: that keeps what it plays, the lane's value,
 *   until the next control block reads the offsets against the new patch.
 *   The patch message arrives before the lanes' resync (`AudioSystem.apply`),
 *   so the offsets then are still the old patch's (PR #385 fix round 2).
 *
 * Invariant: an offset of exactly 0 leaves the value as it was, neither
 * clamped nor passed through a curve, except that a decay time a slot maps
 * plays at least its 1 ms floor (`partFloors`, windsor#347); and a part
 * with no slot mapped reads no slot and floors nothing, so a song without
 * voice lanes renders bit for bit as before (`fmProcessorGolden.test.ts`,
 * `fmProcessorKernel.test.ts`). Functions over the voice, one call a control
 * block; allocation free, and no double crosses a call (windsor#233): every
 * value passes through the voice's or the part's arrays. `synth/fmProcessorAutomation.test.ts` pins the targets,
 * `synth/fmProcessorAllocation.test.ts` the allocation.
 */

import type { Voice } from './voice';
import { OPERATOR_COUNT } from './patchDefaults';
import {
  STEP_OP_DECAY,
  STEP_OP_DECAY_CURVE,
  STEP_SLOT_FILTER_DECAY,
  STEP_SLOT_OP_BASE,
  STEP_SLOT_OP_STRIDE,
} from './stepModTables';
import {
  OFFSET_RATIO,
  VOICE_OFFSET_CURVE,
  VOICE_OFFSET_FLOOR,
  VOICE_OFFSET_MAX,
  VOICE_OFFSET_MIN,
  VOICE_SLOT_COUNT,
  VOICE_SLOT_PARAMS,
  VOICE_TARGET_COUNT,
  VT_ENV_AMOUNT,
  VT_FILTER_DECAY,
  VT_LFO2_AMOUNT,
  VT_LFO2_RATE,
  VT_LFO_AMOUNT,
  VT_LFO_RATE,
  VT_OP_BASE,
  VT_OP_DECAY,
  VT_OP_DECAY_CURVE,
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
 * path no slot carries, and set `floors` to the row floor of each mapped
 * target that has one (a decay time's 1 ms), −Infinity for every other
 * target, which no value is below. True when any slot is mapped. Allocates
 * nothing; run at construction and at a message, never in the render.
 */
function mapVoiceSlots(slotTargets: Int32Array, floors: Float64Array, paths: unknown): boolean {
  const list = Array.isArray(paths) ? (paths as unknown[]) : null;
  let mapped = false;
  floors.fill(-Infinity);
  for (let s = 0; s < VOICE_SLOT_COUNT; s++) {
    const code = list && s < list.length ? voiceTargetCode(list[s]) : -1;
    slotTargets[s] = code;
    if (code < 0) continue;
    mapped = true;
    if (VOICE_OFFSET_FLOOR[code] > 0) floors[code] = VOICE_OFFSET_FLOOR[code];
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
 * is 0 keeps its own value exactly. A ratio scales the row's floor where its
 * own value is below it (a decay time of 0: windsor#347), as the main thread
 * reckons it. A decay time a lane moves plays at least its floor even at
 * offset 0 (`partFloors`), which is the offset the main thread sends for a
 * lane at or below the floor over a patch below it; without a lane a decay
 * of 0 stays 0. The decays' own values are the step's (`stepValues`), since
 * the envelopes' copies carry the lanes.
 */
function bindLiveValues(voice: Voice): void {
  const patch = voice.patch!;
  const v = voice.liveValues;
  const o = voice.partOffsets;
  const own = voice.stepValues;
  v[VT_ENV_AMOUNT] = voice.envAmount;
  v[VT_RESONANCE] = voice.resonance;
  v[VT_FILTER_DECAY] = own[STEP_SLOT_FILTER_DECAY];
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    const b = VT_OP_BASE + i * VT_OP_STRIDE;
    const s = STEP_SLOT_OP_BASE + i * STEP_SLOT_OP_STRIDE;
    v[b + VT_OP_LEVEL] = voice.opLevel[i];
    v[b + VT_OP_DECAY] = own[s + STEP_OP_DECAY];
    v[b + VT_OP_DECAY_CURVE] = own[s + STEP_OP_DECAY_CURVE];
    v[b + VT_OP_FEEDBACK] = voice.opFeedback[i];
    v[b + VT_OP_WIDTH] = voice.opWidth[i];
  }
  v[VT_LFO_AMOUNT] = patch.lfo.amount;
  v[VT_LFO_RATE] = patch.lfo.rate;
  v[VT_LFO2_AMOUNT] = patch.lfo2.amount;
  v[VT_LFO2_RATE] = patch.lfo2.rate;
  v[VT_PITCH_ENV_AMOUNT] = patch.pitchEnvAmount;
  const floors = voice.partFloors;
  for (let k = 0; k < VOICE_TARGET_COUNT; k++) {
    const off = o[k];
    if (off === 0 && !(v[k] < floors[k])) continue;
    const floor = VOICE_OFFSET_FLOOR[k];
    const x =
      VOICE_OFFSET_CURVE[k] === OFFSET_RATIO
        ? (v[k] < floor ? floor : v[k]) * Math.pow(2, off)
        : v[k] + off;
    v[k] =
      x < VOICE_OFFSET_MIN[k]
        ? VOICE_OFFSET_MIN[k]
        : x > VOICE_OFFSET_MAX[k]
          ? VOICE_OFFSET_MAX[k]
          : x;
  }
}

/**
 * The decay rows' values into the envelopes (windsor#347): the filter's
 * decay time, and each operator's decay time and curve. A time is written
 * as it is; the envelope reads it at its next step, from the phase it is at.
 * A curve is written only when it changed, and then `reshapeDecay` starts
 * what is left of a running decay again from its level. Without an offset
 * each is the step's value `bindStepMod` already wrote, so nothing moves; a
 * live retune's new curve on a target no lane moves is that value too, and
 * is heard as it always was. Allocates nothing; the curve reaches the
 * envelope in its field, never as an argument.
 */
function applyLiveDecays(voice: Voice): void {
  const v = voice.liveValues;
  voice.filtEnv.decayTime = v[VT_FILTER_DECAY];
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    const env = voice.ampEnv[i];
    const b = VT_OP_BASE + i * VT_OP_STRIDE;
    env.decayTime = v[b + VT_OP_DECAY];
    const curve = v[b + VT_OP_DECAY_CURVE];
    if (curve !== env.decayCurve) {
      env.decayCurve = curve;
      env.reshapeDecay();
    }
  }
}

/**
 * This block's values (`bindLiveValues`) and the envelopes' decays, then the
 * feedback ramp's ends and the LFOs' rate multipliers. The control update's
 * first step.
 */
function applyVoiceOffsets(voice: Voice): void {
  bindLiveValues(voice);
  applyLiveDecays(voice);
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
 * ends of every feedback ramp at its feedback, with no ramp: from `start`,
 * once the voice's own values are bound, so a note starts on its lanes'
 * values (`start` reads its width ramp's start here too). A rebind is
 * `rebindVoiceOffsets`. A slide keeps its feedback (`slideKeeps`), and its
 * ramp.
 */
function primeVoiceOffsets(voice: Voice): void {
  bindLiveValues(voice);
  applyLiveDecays(voice);
  const v = voice.liveValues;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    voice.fbTo[i] = v[VT_OP_BASE + i * VT_OP_STRIDE + VT_OP_FEEDBACK];
    voice.fbFrom[i] = voice.fbTo[i];
  }
  voice.fbRamp = 0;
}

/**
 * What a rebind keeps, one voice at a time on the patch message: the values
 * the voice played, and the targets a slot is mapped to.
 */
const keptValues = new Float64Array(VOICE_TARGET_COUNT);
const keptTargets = new Uint8Array(VOICE_TARGET_COUNT);

/**
 * `primeVoiceOffsets` for a live retune's rebind, once the new patch's own
 * values are bound: a target a slot is mapped to keeps the value it played,
 * and an operator whose feedback has a lane keeps its ramp, so a rebound
 * voice stays on the lane's absolute value with no transient. The offsets
 * here were worked out against the old patch, since the patch message comes
 * before the lanes' resync; the next control block reads them against the
 * new one. A target no lane moves takes the new patch's value at once, as
 * before. Allocates nothing.
 */
function rebindVoiceOffsets(voice: Voice, slotTargets: Int32Array): void {
  const v = voice.liveValues;
  const kept = keptTargets;
  keptValues.set(v);
  kept.fill(0);
  for (let s = 0; s < VOICE_SLOT_COUNT; s++) {
    const code = slotTargets[s];
    if (code >= 0) kept[code] = 1;
  }
  bindLiveValues(voice);
  for (let k = 0; k < VOICE_TARGET_COUNT; k++) if (kept[k] !== 0) v[k] = keptValues[k];
  // A kept decay goes back to the envelope over the new patch's, which
  // `bindStepMod` wrote: its running segment carries on as it was.
  applyLiveDecays(voice);
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    const k = VT_OP_BASE + i * VT_OP_STRIDE + VT_OP_FEEDBACK;
    if (kept[k] !== 0) continue;
    voice.fbTo[i] = v[k];
    voice.fbFrom[i] = voice.fbTo[i];
    voice.fbRamp &= ~(1 << i);
  }
}

export {
  applyVoiceOffsets,
  latchVoiceOffsets,
  mapVoiceSlots,
  primeVoiceOffsets,
  rebindVoiceOffsets,
};
