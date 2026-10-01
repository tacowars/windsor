/**
 * The patch defaults (#670): every value a patch may omit, and the bounds the
 * worklet clamps the tone, the feedback, the width and a Noise operator's
 * colour (windsor#362) to. Two readers fill a
 * patch from this one table — `patchNormalise.ts` for the audio loop when a
 * `patch` message arrives, and `makePatch()` in the main thread's `patch/patch.ts` for the
 * editor, the tests and the console's knob defaults — so a knob cannot show
 * one default while the engine plays another. `patchDefaults.test.ts` pins
 * the two fills equal leaf for leaf for an empty partial.
 *
 * The one per-operator rule is carried as its inputs, not as four operator
 * rows: operator A (index 0) sounds at `LEAD_OPERATOR_LEVEL`, the others at
 * `OPERATOR_DEFAULTS.level` (`2026-09-23-670-one-patch-defaults-table`).
 *
 * Data only, like `modeIds.ts`, but for `driveOnByDefault`, the one default
 * that is read from other values (windsor#309): it imports the two import-free id modules and
 * nothing else, never touches the worklet scope or the wave cache, is listed
 * in the engine project's `files` and is on the generators' pure side
 * because `audioConstants.ts` re-exports `OPERATOR_COUNT` from here. A
 * change to a value here is a render change: `fmProcessorGolden.test.ts`.
 */

import { DRIVE_SOFT, FILT_OFF, LFO_SINE, LOOP_NONE } from './modeIds';
import { WAVE } from './waveIds';

/** Operators per voice — the length of `ops`, `lfo.toOp`, `lfo.toWidth` and `OP_NAMES`. */
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
  ratio: 1,
  fixed: false,
  fixedHz: 100,
  detune: 0,
  level: 0,
  feedback: 0,
  /** The fraction of the period the wave is squeezed into; for PULSE, the duty. */
  width: 1,
  velSens: 0.4,
  levelKeyScale: 0,
  phase: 0,
  phaseFree: true,
  /**
   * A Noise operator's own two-pole lowpass and highpass on its noise, in Hz
   * (windsor#362, `NOISE_COLOUR_RANGE`); 0 is off. Every other wave ignores them.
   */
  noiseLp: 0,
  noiseHp: 0,
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

/**
 * The LFO, its per-operator depths aside (`LFO_TO_OP_DEFAULT` and
 * `LFO_TO_WIDTH_DEFAULT`, one per operator).
 */
const LFO_DEFAULTS = {
  shape: LFO_SINE,
  rate: 5,
  amount: 0,
  delay: 0,
  retrigger: false,
  /** The phase runs once from note-on and holds its end value. */
  oneShot: false,
  /** 0..1 instead of -1..1. */
  unipolar: false,
  toPitch: 0,
  modWheelDepth: 1,
};

/**
 * The second LFO: the first's defaults, but deaf to the mod wheel, so a fresh
 * LFO 2 is inert (record `2026-09-28-operator-width-pulse-and-a-second-lfo`).
 */
const LFO2_DEFAULTS = { ...LFO_DEFAULTS, modWheelDepth: 0 };

/** Each operator's LFO level-modulation depth. */
const LFO_TO_OP_DEFAULT = 0;

/** Each operator's LFO width-modulation depth. */
const LFO_TO_WIDTH_DEFAULT = 0;

/** The filter, its envelope aside (`FILTER_ENV_DEFAULTS`). */
const FILTER_DEFAULTS = {
  mode: FILT_OFF,
  cutoff: 8000,
  resonance: 0.707,
  slope24: false,
  envAmount: 0,
  modWheelDepth: 0,
  lfoAmount: 0,
  lfo2Amount: 0,
  keyTrack: 0,
};

/**
 * The voice's drive stage (windsor#300), between the carriers and the filter:
 * the input gain, the shape (`DRIVE_SHAPE`), a bias added before the shape and
 * a one-pole tone after it. Unity gain and no bias bypass the stage, so the
 * defaults are no drive at all (record `2026-10-01-voice-drive-stage`).
 * `on` is the console's switch (windsor#309): off, the stage costs nothing
 * whatever the other four say; a patch that omits it takes
 * `driveOnByDefault`, so a patch saved before the switch plays as it did.
 */
const DRIVE_DEFAULTS = {
  /** The input gain into the shaper, `DRIVE_GAIN_RANGE`; 1 is unity. */
  gain: 1,
  shape: DRIVE_SOFT,
  /** A DC offset added before the shaper, `DRIVE_BIAS_RANGE`. */
  bias: 0,
  /** The lowpass after the shaper, `DRIVE_TONE_RANGE`: 1 is open (bypassed). */
  tone: 1,
  /**
   * The stage's switch; omitted, it is `driveOnByDefault` of the gain and
   * bias. Last, here and in the worklet's fill (`patchNormalise.ts` says
   * why), so the four numbers keep the object shape they had before it.
   */
  on: false,
};

/**
 * The drive's input gain, clamped here by the worklet: the console's knob
 * reaches 6 and the library 1.6, so 64 is far past any musical use, and it
 * keeps `gain · x` finite for every carrier sum the voice can make.
 */
const DRIVE_GAIN_RANGE = { min: 0, max: 64 };

/**
 * The switch a patch that omits `drive.on` takes (windsor#309): on exactly
 * when the stage did something before the switch existed, a gain off unity
 * or a bias. Both fills call it with their own gain and bias, so the
 * worklet and `makePatch()` agree, and an old patch keeps its sound.
 */
function driveOnByDefault(gain: number, bias: number): boolean {
  return gain !== 1 || bias !== 0;
}

/** The drive's bias, clamped here by the worklet. */
const DRIVE_BIAS_RANGE = { min: -1, max: 1 };

/** The drive's tone, clamped here by the worklet: 0 is the darkest, 1 open. */
const DRIVE_TONE_RANGE = { min: 0, max: 1 };

/** `tone` is clamped here by the worklet: its floor keeps the anti-alias trim above silence. */
const TONE_RANGE = { min: 0.02, max: 1 };

/** Operator self-feedback is bipolar (#529) and clamped here by the worklet. */
const FEEDBACK_RANGE = { min: -1, max: 1 };

/** Operator width is clamped here by the worklet: 1 is the plain wave, the floor keeps a sliver of it. */
const WIDTH_RANGE = { min: 0.05, max: 1 };

/**
 * A Noise operator's `noiseLp` and `noiseHp`, clamped here by the worklet: 0
 * is off, and any cutoff above 0 sounds at `NOISE_COLOUR_FLOOR_HZ` or more
 * (windsor#362, the ranges of
 * `docs/research/2026-10-01-tom-noise-colour-prototype/`).
 */
const NOISE_COLOUR_RANGE = { min: 0, max: 20000 };

/** The lowest cutoff a noise filter that is on sounds at: the bottom of the knob's log sweep. */
const NOISE_COLOUR_FLOOR_HZ = 20;

export {
  DRIVE_BIAS_RANGE,
  DRIVE_DEFAULTS,
  DRIVE_GAIN_RANGE,
  DRIVE_TONE_RANGE,
  driveOnByDefault,
  ENVELOPE_DEFAULTS,
  FEEDBACK_RANGE,
  FILTER_DEFAULTS,
  FILTER_ENV_DEFAULTS,
  LEAD_OPERATOR_LEVEL,
  LFO2_DEFAULTS,
  LFO_DEFAULTS,
  LFO_TO_OP_DEFAULT,
  LFO_TO_WIDTH_DEFAULT,
  NOISE_COLOUR_FLOOR_HZ,
  NOISE_COLOUR_RANGE,
  OPERATOR_COUNT,
  OPERATOR_DEFAULTS,
  PATCH_DEFAULTS,
  PITCH_ENV_DEFAULTS,
  TONE_RANGE,
  WIDTH_RANGE,
};
