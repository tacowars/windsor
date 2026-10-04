/**
 * Per-step modulation on the voice (windsor#17, windsor#419): a note-on's
 * step array, one value per `voiceTargetTables.ts` row, copied into the
 * voice's preallocated `stepOffsets` (`loadStepOffsets`), and the voice's
 * `ownValues`, the bound patch's values by target code with each step value
 * moved in its row's curve (`bindOwnValues`). Every target a song lane can
 * move, a step can move too. The offsets are fixed at note-on and held for
 * the note's whole life; a legato retarget takes the new step's, except the
 * rows marked `slideKeeps`, and keeps the decay curves its envelopes play
 * (windsor#405). A target the patch's macros map takes its macro's value,
 * shaped, as its base (`voiceMacros.ts`, windsor#560). The song's lanes go
 * over `ownValues` into `liveValues` (`voiceOffsets.ts`), which every
 * consumer reads.
 *
 * Invariant: a step value of exactly 0 leaves the patch's value untouched,
 * neither floored nor clamped, so a note without step offsets renders bit
 * for bit as before (`fmProcessorGolden.test.ts`). Functions over the voice,
 * called once per note-on, rebind or retarget; allocation free, and the
 * curve is written out, so no double crosses a call (windsor#233). The
 * main thread's copy of the curve is `voiceTargetValue.ts`;
 * `voiceStepMod.test.ts` pins the loading, `fmProcessorStepMod.test.ts` the
 * voice.
 */

import type { WorkletPatch } from './patchNormalise';
import type { Voice } from './voice';
import { OPERATOR_COUNT } from './patchDefaults';
import { restingWidth } from './voiceControl';
import { applyMacroBases } from './voiceMacros';
import { keepVoiceOffsets, primeVoiceOffsets, rebindVoiceOffsets } from './voiceOffsets';
import {
  VOICE_TARGET_COUNT,
  VOICE_TARGET_FLOOR,
  VOICE_TARGET_MAX,
  VOICE_TARGET_MIN,
  VOICE_TARGET_RATIO,
  VOICE_TARGET_SLIDE_KEEPS,
  VOICE_TARGET_SPAN,
  VT_OP_BASE,
  VT_OP_STRIDE,
  VT_OP_WIDTH,
} from './voiceTargetTables';
import { layoutVoiceTargets } from './voiceTargets';

/**
 * Copy a note-on's step array into the voice, each value clamped to -1..1;
 * a slot past the array's end, junk or NaN is 0. On a legato retarget
 * (`slide`), a `slideKeeps` row keeps the offset the voice already has.
 * Allocates nothing.
 */
function loadStepOffsets(
  voice: Voice,
  src: ArrayLike<number> | null | undefined,
  slide: boolean,
): void {
  const dst = voice.stepOffsets;
  const n = src ? src.length : 0;
  for (let k = 0; k < VOICE_TARGET_COUNT; k++) {
    if (slide && VOICE_TARGET_SLIDE_KEEPS[k] !== 0) continue;
    const raw = k < n ? src![k] : 0;
    const v = typeof raw === 'number' && raw === raw ? raw : 0;
    dst[k] = v < -1 ? -1 : v > 1 ? 1 : v;
  }
}

/**
 * The voice's own values: the bound patch's, by code, and each target with a
 * step offset moved by `offset × span` in its row's curve, clamped to its
 * bounds. A target without one keeps the patch's value. Then each target the
 * patch's macros map takes its base from its macro's own value, pushed
 * already, with its step's push over that (`applyMacroBases`, windsor#560);
 * a patch without mappings skips it. Called by `start`, `rebind` and
 * `retarget`.
 */
function bindOwnValues(voice: Voice, patch: WorkletPatch): void {
  const own = voice.ownValues;
  const o = voice.stepOffsets;
  layoutVoiceTargets(patch, own);
  for (let k = 0; k < VOICE_TARGET_COUNT; k++) {
    const v = o[k];
    if (v === 0) continue;
    const d = v * VOICE_TARGET_SPAN[k];
    const base = own[k];
    const floor = VOICE_TARGET_FLOOR[k];
    const x =
      VOICE_TARGET_RATIO[k] !== 0 ? (base < floor ? floor : base) * Math.pow(2, d) : base + d;
    own[k] =
      x < VOICE_TARGET_MIN[k]
        ? VOICE_TARGET_MIN[k]
        : x > VOICE_TARGET_MAX[k]
          ? VOICE_TARGET_MAX[k]
          : x;
  }
  if (patch.macroMapCount !== 0) applyMacroBases(patch, own, own, o);
}

/**
 * A note-on's offsets, from `Voice.start` once its envelopes are configured:
 * load them, bind the own values, put the song's lanes over them
 * (`primeVoiceOffsets`, windsor#346), and start each width ramp from the
 * width the note plays, so a step's or a lane's width is there from the
 * first sample. Allocates nothing.
 */
function startStepMod(
  voice: Voice,
  patch: WorkletPatch,
  stepMod: ArrayLike<number> | null | undefined,
): void {
  loadStepOffsets(voice, stepMod, false);
  bindOwnValues(voice, patch);
  primeVoiceOffsets(voice);
  const live = voice.liveValues;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    voice.width[i] = restingWidth(voice.kind[i], live[VT_OP_BASE + i * VT_OP_STRIDE + VT_OP_WIDTH]);
  }
}

/**
 * A legato retarget's step, from `Voice.retarget` (#602): load the new
 * step's offsets, but for the `slideKeeps` rows, and bind them over the
 * patch. The envelopes are not touched here: each keeps the decay curve it
 * plays (windsor#405), since the curve's step offset is kept and the patch
 * is the same, and a lane's curve reaches it only when the lane's offset
 * changes. A decay time is read by the envelope in the control block, after
 * the lanes are back over the new own value. Allocates nothing.
 */
function retargetStepMod(
  voice: Voice,
  patch: WorkletPatch,
  stepMod: ArrayLike<number> | null | undefined,
): void {
  loadStepOffsets(voice, stepMod, true);
  bindOwnValues(voice, patch);
}

/**
 * A live retune's rebind, from `Voice.rebind` once its envelopes are
 * configured: what the voice plays is kept (`keepVoiceOffsets`), the note
 * keeps its step's offsets over the new patch's values, the song's lanes go
 * over them (`rebindVoiceOffsets`: a target a slot in `slotTargets` moves
 * keeps the lane's value it plays), and each operator in `switched` (a bit
 * per operator whose wave moved between PULSE and the rest, where width
 * changes meaning from a duty to a phase scale) restarts its width ramp,
 * with no ramp, from the width it plays: the lane's, not the patch's or the
 * step's, as `startStepMod` seeds it (windsor#346). Allocates nothing.
 */
function rebindStepMod(
  voice: Voice,
  patch: WorkletPatch,
  switched: number,
  slotTargets: Int32Array,
): void {
  keepVoiceOffsets(voice);
  bindOwnValues(voice, patch);
  rebindVoiceOffsets(voice, slotTargets);
  const live = voice.liveValues;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    if ((switched & (1 << i)) === 0) continue;
    voice.width[i] = restingWidth(voice.kind[i], live[VT_OP_BASE + i * VT_OP_STRIDE + VT_OP_WIDTH]);
    voice.widthInc[i] = 0;
  }
}

export { bindOwnValues, loadStepOffsets, rebindStepMod, retargetStepMod, startStepMod };
