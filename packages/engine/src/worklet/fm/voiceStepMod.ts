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
 * patch's), by `start`, `rebind` and `retarget`. The patch's values are laid
 * out in slot order in `voice.stepValues`, and each slot with an offset is
 * put through the curve there, from one call site (windsor#233): two dozen
 * call sites, one a value, ran past V8's inlining budget, and a double passed
 * to or returned from a call it does not inline is a new heap number. A slot
 * without one keeps the patch's value, which is what `stepModValue` returns
 * for an offset of 0, so a note with no offsets makes no call at all.
 */
function bindStepMod(voice: Voice, patch: WorkletPatch): void {
  const o = voice.stepOffsets;
  const t = STEP_MOD_TABLE;
  const v = voice.stepValues;
  const f = patch.filter;
  v[STEP_SLOT_ENV_AMOUNT] = f.envAmount;
  v[STEP_SLOT_CUTOFF] = f.cutoff;
  v[STEP_SLOT_RESONANCE] = f.resonance;
  v[STEP_SLOT_FILTER_DECAY] = f.env.decayTime;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    const op = patch.ops[i];
    const b = STEP_SLOT_OP_BASE + i * STEP_SLOT_OP_STRIDE;
    v[b + STEP_OP_LEVEL] = op.level;
    v[b + STEP_OP_DECAY] = op.env.decayTime;
    v[b + STEP_OP_DECAY_CURVE] = op.env.decayCurve;
    v[b + STEP_OP_FEEDBACK] = op.feedback;
    v[b + STEP_OP_WIDTH] = op.width;
  }
  for (let s = 0; s < STEP_MOD_SLOT_COUNT; s++) {
    if (o[s] !== 0) v[s] = stepModValue(t[s], v[s], o[s]);
  }
  voice.envAmount = v[STEP_SLOT_ENV_AMOUNT];
  voice.cutoff = v[STEP_SLOT_CUTOFF];
  voice.resonance = v[STEP_SLOT_RESONANCE];
  voice.filtEnv.decayTime = v[STEP_SLOT_FILTER_DECAY];
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    const env = voice.ampEnv[i];
    const b = STEP_SLOT_OP_BASE + i * STEP_SLOT_OP_STRIDE;
    voice.opLevel[i] = v[b + STEP_OP_LEVEL];
    env.decayTime = v[b + STEP_OP_DECAY];
    env.decayCurve = v[b + STEP_OP_DECAY_CURVE];
    voice.opFeedback[i] = v[b + STEP_OP_FEEDBACK];
    voice.opWidth[i] = v[b + STEP_OP_WIDTH];
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
