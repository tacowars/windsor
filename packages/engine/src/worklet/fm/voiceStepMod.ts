/**
 * Per-step parameter modulation on the voice (windsor#17): a note-on's
 * offsets, one slot per `stepModTables.ts` row, copied into the voice's
 * preallocated `stepOffsets` (`loadStepOffsets`) and turned into the
 * per-voice values the control update, the envelopes and the render loops
 * read in place of the patch's (`bindStepMod`): the filter's envelope
 * amount, cutoff, resonance and envelope decay, and each operator's level,
 * decay, decay curve, feedback and width. The offsets are fixed at note-on
 * and held for the note's whole life (decision 1); a legato retarget takes
 * the new step's, except the rows marked `slideKeeps`.
 *
 * Invariant: an offset of exactly 0 hands back the patch's own value
 * untouched, neither clamped nor passed through a curve, so a note without
 * offsets renders bit for bit as before (`fmProcessorGolden.test.ts`).
 * Functions over the voice, called once per note-on, rebind or retarget;
 * allocation free. The arithmetic is `stepModValue.ts`;
 * `voiceStepMod.test.ts` pins the loading, `fmProcessorStepMod.test.ts` the
 * voice.
 */

import type { WorkletPatch } from './patchNormalise';
import type { Voice } from './voice';
import { OPERATOR_COUNT } from './patchDefaults';
import {
  STEP_MOD_SLOT_COUNT,
  STEP_MOD_TABLE,
  STEP_OP_DECAY,
  STEP_OP_DECAY_CURVE,
  STEP_OP_FEEDBACK,
  STEP_OP_LEVEL,
  STEP_OP_WIDTH,
  STEP_SLOT_CUTOFF,
  STEP_SLOT_ENV_AMOUNT,
  STEP_SLOT_FILTER_DECAY,
  STEP_SLOT_OP_BASE,
  STEP_SLOT_OP_STRIDE,
  STEP_SLOT_RESONANCE,
} from './stepModTables';
import { stepModValue } from './stepModValue';
import { restingWidth } from './voiceControl';

/**
 * Copy a note-on's offsets into the voice, each clamped to -1..1; absent or
 * junk is 0. On a legato retarget (`slide`), a `slideKeeps` row keeps the
 * offset the voice already has. Allocates nothing.
 */
function loadStepOffsets(
  voice: Voice,
  src: ArrayLike<number> | null | undefined,
  slide: boolean,
): void {
  const dst = voice.stepOffsets;
  const n = src ? src.length : 0;
  for (let s = 0; s < STEP_MOD_SLOT_COUNT; s++) {
    if (slide && STEP_MOD_TABLE[s].slideKeeps) continue;
    const raw = s < n ? src![s] : 0;
    const v = typeof raw === 'number' && raw === raw ? raw : 0;
    dst[s] = v < -1 ? -1 : v > 1 ? 1 : v;
  }
}

/**
 * The per-voice values from the bound patch and the voice's offsets. Called
 * after the envelopes are configured (`configure` resets their decay to the
 * patch's), by `start`, `rebind` and `retarget`. Allocates nothing.
 */
function bindStepMod(voice: Voice, patch: WorkletPatch): void {
  const o = voice.stepOffsets;
  const t = STEP_MOD_TABLE;
  const f = patch.filter;
  voice.envAmount = stepModValue(t[STEP_SLOT_ENV_AMOUNT], f.envAmount, o[STEP_SLOT_ENV_AMOUNT]);
  voice.cutoff = stepModValue(t[STEP_SLOT_CUTOFF], f.cutoff, o[STEP_SLOT_CUTOFF]);
  voice.resonance = stepModValue(t[STEP_SLOT_RESONANCE], f.resonance, o[STEP_SLOT_RESONANCE]);
  const fd = STEP_SLOT_FILTER_DECAY;
  voice.filtEnv.decayTime = stepModValue(t[fd], f.env.decayTime, o[fd]);
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    const op = patch.ops[i];
    const env = voice.ampEnv[i];
    const b = STEP_SLOT_OP_BASE + i * STEP_SLOT_OP_STRIDE;
    const lv = b + STEP_OP_LEVEL,
      dc = b + STEP_OP_DECAY,
      cv = b + STEP_OP_DECAY_CURVE,
      fb = b + STEP_OP_FEEDBACK,
      wd = b + STEP_OP_WIDTH;
    voice.opLevel[i] = stepModValue(t[lv], op.level, o[lv]);
    env.decayTime = stepModValue(t[dc], op.env.decayTime, o[dc]);
    env.decayCurve = stepModValue(t[cv], op.env.decayCurve, o[cv]);
    voice.opFeedback[i] = stepModValue(t[fb], op.feedback, o[fb]);
    voice.opWidth[i] = stepModValue(t[wd], op.width, o[wd]);
  }
}

/**
 * A note-on's offsets, from `Voice.start` once its envelopes are configured:
 * load them, bind the values, and start each width ramp from the note's own
 * width, so a step's width is there from the first sample. Allocates nothing.
 */
function startStepMod(
  voice: Voice,
  patch: WorkletPatch,
  stepMod: ArrayLike<number> | null | undefined,
): void {
  loadStepOffsets(voice, stepMod, false);
  bindStepMod(voice, patch);
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    voice.width[i] = restingWidth(voice.kind[i], voice.opWidth[i]);
  }
}

export { bindStepMod, loadStepOffsets, startStepMod };
