/**
 * The patch defaults (#670): every value a patch may omit, and the bounds the
 * worklet clamps three fields to. Two readers fill a patch from this one
 * table — `patchNormalise.ts` for the audio loop when a `patch` message
 * arrives, and `makePatch()` in the main thread's `patch/patch.ts` for the
 * editor, the tests and the console's knob defaults — so a knob cannot show
 * one default while the engine plays another. `patchDefaults.test.ts` pins
 * the two fills equal leaf for leaf for an empty partial.
 *
 * The one per-operator rule is carried as its inputs, not as four operator
 * rows: operator A (index 0) sounds at `LEAD_OPERATOR_LEVEL`, the others at
 * `OPERATOR_DEFAULTS.level` (`2026-09-23-670-one-patch-defaults-table`).
 *
 * Data only, like `modeIds.ts`: it imports the two import-free id modules and
 * nothing else, never touches the worklet scope or the wave cache, is listed
 * in the engine project's `files` and is on the generators' pure side
 * because `audioConstants.ts` re-exports `OPERATOR_COUNT` from here. A
 * change to a value here is a render change: `fmProcessorGolden.test.ts`.
 */

import { FILT_OFF, LFO_SINE, LOOP_NONE } from './modeIds';
import { WAVE } from './waveIds';

/** Operators per voice — the length of `ops`, `lfo.toOp` and `OP_NAMES`. */
const OPERATOR_COUNT = 4;

/** The envelope every operator gets; the pitch and filter envelopes override a few fields below. */
const ENVELOPE_DEFAULTS = {
  initLevel: 0,
  attackTime: 0.002,
  attackCurve: 0,
  peakLevel: 1,
  decayTime: 0.4,
  decayCurve: 0.5,
  sustainLevel: 0.7,
  releaseTime: 0.3,
  releaseCurve: 0.5,
  endLevel: 0,
  loopMode: LOOP_NONE,
  keyScale: 0,
};

/** The pitch envelope: a short blip that returns to pitch, not a held bend. */
const PITCH_ENV_DEFAULTS = { ...ENVELOPE_DEFAULTS, sustainLevel: 0, decayTime: 0.1 };

/** The filter envelope: decays to nothing, so an `envAmount` is a sweep, not an offset. */
const FILTER_ENV_DEFAULTS = { ...ENVELOPE_DEFAULTS, sustainLevel: 0 };

/** One operator, its envelope aside (`ENVELOPE_DEFAULTS`) and its level aside for operator A. */
const OPERATOR_DEFAULTS = {
  wave: WAVE.SINE,
  userPartials: null,
  userKey: '',
  ratio: 1,
  fixed: false,
  fixedHz: 100,
  detune: 0,
  level: 0,
  feedback: 0,
  velSens: 0.4,
  levelKeyScale: 0,
  phase: 0,
  phaseFree: true,
};

/** Operator A's level: the one operator an empty patch hears. */
const LEAD_OPERATOR_LEVEL = 1;

/** The patch's own scalars. */
const PATCH_DEFAULTS = {
  name: 'untitled',
  algorithm: 0,
  volume: 0.8,
  tone: 1,
  glide: 0,
  pitchEnvAmount: 0,
  pan: 0,
  panRandom: 0,
  panKey: 0,
  spread: 0,
  mono: false,
};

/** The LFO, its per-operator depths aside (`LFO_TO_OP_DEFAULT`, one per operator). */
const LFO_DEFAULTS = {
  shape: LFO_SINE,
  rate: 5,
  amount: 0,
  delay: 0,
  retrigger: false,
  toPitch: 0,
  modWheelDepth: 1,
};

/** Each operator's LFO level-modulation depth. */
const LFO_TO_OP_DEFAULT = 0;

/** The filter, its envelope aside (`FILTER_ENV_DEFAULTS`). */
const FILTER_DEFAULTS = {
  mode: FILT_OFF,
  cutoff: 8000,
  resonance: 0.707,
  drive: 1,
  slope24: false,
  envAmount: 0,
  modWheelDepth: 0,
  lfoAmount: 0,
  keyTrack: 0,
};

/** `tone` is clamped here by the worklet: its floor keeps the anti-alias trim above silence. */
const TONE_RANGE = { min: 0.02, max: 1 };

/** Operator self-feedback is bipolar (#529) and clamped here by the worklet. */
const FEEDBACK_RANGE = { min: -1, max: 1 };

export {
  ENVELOPE_DEFAULTS,
  FEEDBACK_RANGE,
  FILTER_DEFAULTS,
  FILTER_ENV_DEFAULTS,
  LEAD_OPERATOR_LEVEL,
  LFO_DEFAULTS,
  LFO_TO_OP_DEFAULT,
  OPERATOR_COUNT,
  OPERATOR_DEFAULTS,
  PATCH_DEFAULTS,
  PITCH_ENV_DEFAULTS,
  TONE_RANGE,
};
