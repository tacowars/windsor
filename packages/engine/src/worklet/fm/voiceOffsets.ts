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
 *   a running decay again from its level (`Envelope.reshapeDecay`). A step's
 *   decay push stacks on a decay lane's absolute value (`stackStepDecays`,
 *   windsor#405), so it is heard over a patch decay of 0 too.
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
 *   A rebind never reshapes a decay (PR #400 fix round 2): only a change in
 *   a lane's offset does. A decay curve a lane holds over an edited base
 *   keeps the value it plays until that lane's offset next changes, which is
 *   its resync, and then takes the resynced value without a reshape, since
 *   the float32 offset may land it an ulp from where it was (`decayRebound`).
 *   Nor does a legato slide (windsor#405): `retargetStepMod` keeps the curve
 *   each envelope plays across its bind.
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
  STEP_MOD_SLOT_COUNT,
  STEP_MOD_TABLE,
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
 * the envelopes' copies carry the lanes; a decay time with a lane and a step
 * push takes the push over the lane's value (`stackStepDecays`).
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
  stackStepDecays(voice);
}

/**
 * A step's decay push over a decay time a lane moves (windsor#405): the
 * step's row (`stepModValue`'s log curve) over the lane's absolute value,
 * the patch's decay from its floor moved by the offset and clamped, as the
 * main thread reckons it, and clamped to the step row's range. Over a patch
 * decay of 0 the step's own value is its row's 1 ms, which the lane's ratio
 * would scale straight to the lane's value; so a lane and a push play
 * longer than the lane alone. Only a decay time with both a push and a lane
 * on it is written: one without a lane keeps the step's value, and one
 * without a push the lane's, to the bit. The curve is written out, not
 * called, since no double crosses a call each control block (rule 2).
 */
function stackStepDecays(voice: Voice): void {
  const patch = voice.patch!;
  const v = voice.liveValues;
  const o = voice.partOffsets;
  const floors = voice.partFloors;
  const pushes = voice.stepOffsets;
  for (let i = -1; i < OPERATOR_COUNT; i++) {
    const filter = i < 0;
    const s = filter
      ? STEP_SLOT_FILTER_DECAY
      : STEP_SLOT_OP_BASE + i * STEP_SLOT_OP_STRIDE + STEP_OP_DECAY;
    const push = pushes[s];
    if (push === 0) continue;
    const k = filter ? VT_FILTER_DECAY : VT_OP_BASE + i * VT_OP_STRIDE + VT_OP_DECAY;
    const base = filter ? patch.filter.env.decayTime : patch.ops[i].env.decayTime;
    const off = o[k];
    if (off === 0 && !(base < floors[k])) continue;
    const floor = VOICE_OFFSET_FLOOR[k];
    const x = (base < floor ? floor : base) * Math.pow(2, off);
    const lane =
      x < VOICE_OFFSET_MIN[k]
        ? VOICE_OFFSET_MIN[k]
        : x > VOICE_OFFSET_MAX[k]
          ? VOICE_OFFSET_MAX[k]
          : x;
    const row = STEP_MOD_TABLE[s];
    const y = lane * Math.pow(row.max / row.min, push * row.span);
    v[k] = y < row.min ? row.min : y > row.max ? row.max : y;
  }
}

/**
 * The decay rows' values into the envelopes (windsor#347): the filter's
 * decay time, and each operator's decay time and curve. A time is written
 * as it is; the envelope reads it at its next step, from the phase it is at.
 * A curve is written only when it changed, and then, if `reshape`,
 * `reshapeDecay` starts what is left of a running decay again from its
 * level; a note-on and a rebind pass false, and write every curve as
 * `liveValues` has it. Without an offset each is the step's value
 * `bindStepMod` already wrote, so nothing moves; a live retune's new curve
 * on a target no lane moves is that value too, and is heard as it always
 * was. In a control block, a curve a rebind holds (`decayRebound`, the
 * offset then) stays as it plays, and `liveValues` with it, while the offset
 * is that one; the first other offset is the lane's resync, written without
 * a reshape. Allocates nothing; the curve reaches the envelope in its field,
 * never as an argument.
 */
function applyLiveDecays(voice: Voice, reshape: boolean): void {
  const v = voice.liveValues;
  const o = voice.partOffsets;
  const rebound = voice.decayRebound;
  voice.filtEnv.decayTime = v[VT_FILTER_DECAY];
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    const env = voice.ampEnv[i];
    const b = VT_OP_BASE + i * VT_OP_STRIDE;
    const k = b + VT_OP_DECAY_CURVE;
    env.decayTime = v[b + VT_OP_DECAY];
    const held = rebound[i];
    if (reshape) {
      if (held === held && o[k] === held) {
        v[k] = env.decayCurve;
        continue;
      }
      rebound[i] = NaN;
    }
    const curve = v[k];
    if (curve !== env.decayCurve) {
      env.decayCurve = curve;
      if (reshape && held !== held) env.reshapeDecay();
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
  applyLiveDecays(voice, true);
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
  voice.decayRebound.fill(NaN);
  applyLiveDecays(voice, false);
  const v = voice.liveValues;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    voice.fbTo[i] = v[VT_OP_BASE + i * VT_OP_STRIDE + VT_OP_FEEDBACK];
    voice.fbFrom[i] = voice.fbTo[i];
  }
  voice.fbRamp = 0;
}

/**
 * What a rebind keeps, one voice at a time on the patch message: the values
 * the voice played, its step's values under the old patch, and the targets
 * a slot is mapped to.
 */
const keptValues = new Float64Array(VOICE_TARGET_COUNT);
const keptSteps = new Float64Array(STEP_MOD_SLOT_COUNT);
const keptTargets = new Uint8Array(VOICE_TARGET_COUNT);

/**
 * A live retune's first step, before `bindStepMod` binds the new patch:
 * what the voice plays and its step's values under the old one, for
 * `rebindVoiceOffsets`. Allocates nothing.
 */
function keepVoiceOffsets(voice: Voice): void {
  keptValues.set(voice.liveValues);
  keptSteps.set(voice.stepValues);
}

/**
 * `primeVoiceOffsets` for a live retune's rebind, once the new patch's own
 * values are bound: a target a slot is mapped to keeps the value it played,
 * and an operator whose feedback has a lane keeps its ramp, so a rebound
 * voice stays on the lane's absolute value with no transient. The offsets
 * here were worked out against the old patch, since the patch message comes
 * before the lanes' resync; the next control block reads them against the
 * new one, except a decay curve a lane holds over a base the edit moved,
 * which holds until its lane's offset changes (`decayRebound`), so a
 * resync's rounding never starts the decay again. Nothing here reshapes a
 * decay. A target no lane moves takes the new patch's value at once, as
 * before. Allocates nothing.
 */
function rebindVoiceOffsets(voice: Voice, slotTargets: Int32Array): void {
  const v = voice.liveValues;
  const kept = keptTargets;
  kept.fill(0);
  for (let s = 0; s < VOICE_SLOT_COUNT; s++) {
    const code = slotTargets[s];
    if (code >= 0) kept[code] = 1;
  }
  bindLiveValues(voice);
  for (let k = 0; k < VOICE_TARGET_COUNT; k++) if (kept[k] !== 0) v[k] = keptValues[k];
  // A kept decay goes back to the envelope over the new patch's, which
  // `bindStepMod` wrote: its running segment carries on as it was.
  applyLiveDecays(voice, false);
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    const k = VT_OP_BASE + i * VT_OP_STRIDE + VT_OP_DECAY_CURVE;
    const s = STEP_SLOT_OP_BASE + i * STEP_SLOT_OP_STRIDE + STEP_OP_DECAY_CURVE;
    if (kept[k] !== 0 && keptSteps[s] !== voice.stepValues[s]) {
      voice.decayRebound[i] = voice.partOffsets[k];
    }
  }
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
  keepVoiceOffsets,
  latchVoiceOffsets,
  mapVoiceSlots,
  primeVoiceOffsets,
  rebindVoiceOffsets,
};
