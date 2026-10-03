/**
 * The patch's values by target code (windsor#419): `layoutVoiceTargets`
 * writes the value at each `voiceTargetTables.ts` row's path into an array,
 * in code order. It is the one place on the audio thread that maps a path to
 * a code; everything after it reads by code. The voice lays its bound patch
 * out into `ownValues` at a note-on, a retarget and a rebind
 * (`voiceStepMod.ts`), and into a scratch array when a song lane needs the
 * patch's own value under the step's (`voiceOffsets.ts`).
 *
 * Invariant: each value is the patch's number as it is, so a voice with no
 * offsets plays exactly what it did when it read the patch's fields
 * (`fmProcessorGolden.test.ts`). A field written as a literal, not looked up
 * by path, so it allocates nothing and passes no double across a call;
 * `voiceTargets.test.ts` pins every code to its row's path. A macro slot
 * the patch does not define reads the macro default's value (windsor#559).
 */

import type { WorkletPatch } from './patchNormalise';
import { MACRO_DEFAULTS, MACROS_MAX, OPERATOR_COUNT } from './patchDefaults';
import {
  VT_CUTOFF,
  VT_ENV_AMOUNT,
  VT_FILTER_DECAY,
  VT_LFO2_AMOUNT,
  VT_LFO2_RATE,
  VT_LFO_AMOUNT,
  VT_LFO_RATE,
  VT_MACRO_BASE,
  VT_OP_BASE,
  VT_OP_DECAY,
  VT_OP_DECAY_CURVE,
  VT_OP_FEEDBACK,
  VT_OP_LEVEL,
  VT_OP_STRIDE,
  VT_OP_WIDTH,
  VT_PITCH_ENV_AMOUNT,
  VT_RESONANCE,
  VT_VOWEL,
} from './voiceTargetTables';

/** Write `patch`'s value for every target into `out`, by code. Allocates nothing. */
function layoutVoiceTargets(patch: WorkletPatch, out: Float64Array): void {
  const f = patch.filter;
  out[VT_CUTOFF] = f.cutoff;
  out[VT_ENV_AMOUNT] = f.envAmount;
  out[VT_RESONANCE] = f.resonance;
  out[VT_FILTER_DECAY] = f.env.decayTime;
  out[VT_VOWEL] = f.vowel;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    const op = patch.ops[i];
    const b = VT_OP_BASE + i * VT_OP_STRIDE;
    out[b + VT_OP_LEVEL] = op.level;
    out[b + VT_OP_DECAY] = op.env.decayTime;
    out[b + VT_OP_DECAY_CURVE] = op.env.decayCurve;
    out[b + VT_OP_FEEDBACK] = op.feedback;
    out[b + VT_OP_WIDTH] = op.width;
  }
  out[VT_LFO_AMOUNT] = patch.lfo.amount;
  out[VT_LFO_RATE] = patch.lfo.rate;
  out[VT_LFO2_AMOUNT] = patch.lfo2.amount;
  out[VT_LFO2_RATE] = patch.lfo2.rate;
  out[VT_PITCH_ENV_AMOUNT] = patch.pitchEnvAmount;
  const macros = patch.macros;
  for (let i = 0; i < MACROS_MAX; i++) {
    out[VT_MACRO_BASE + i] = i < macros.length ? macros[i].value : MACRO_DEFAULTS.value;
  }
}

export { layoutVoiceTargets };
