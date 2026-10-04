/**
 * The patch's mode ids (#669): the envelope loop modes, the filter modes,
 * the LFO shapes, the voice drive's shapes (windsor#300) and a macro
 * mapping's curves (windsor#559) — the numbers the worklet switches on and
 * the main thread's `patch.ts` re-exports as `LOOP_MODE`, `FILTER_MODE`,
 * `LFO_SHAPE`, `DRIVE_SHAPE` and `MACRO_CURVE`, so a
 * patch, a preset, the console and the DSP name a mode the same way. The
 * scalars are what the hot paths compare against (a module constant, never a
 * property load); the objects are built from them, so each number is written
 * once. Import-free on purpose, like `waveIds.ts`: the main thread reads this
 * module too, so nothing here may touch the worklet scope or the wave cache.
 * Listed in the engine project's `files` and compiled by both projects.
 * `modeIds.test.ts` pins `patch.ts`'s re-exports to these objects.
 */

/** Envelope loop modes (`envelope.ts`). */
const LOOP_NONE = 0,
  LOOP_LOOP = 1,
  LOOP_TRIGGER = 2;

/**
 * Filter modes (`svf.ts`); Formant runs three bandpass peaks in parallel
 * (`voiceFormant.ts`, windsor#331), and Acid the TB-303's diode ladder in
 * place of the sections (`ladder.ts`, windsor#573).
 */
const FILT_OFF = 0,
  FILT_LP = 1,
  FILT_HP = 2,
  FILT_BP = 3,
  FILT_NOTCH = 4,
  FILT_FORMANT = 5,
  FILT_LADDER = 6;

/** LFO shapes (`lfo.ts`). */
const LFO_SINE = 0,
  LFO_TRI = 1,
  LFO_SAW_UP = 2,
  LFO_SAW_DOWN = 3,
  LFO_SQUARE = 4,
  LFO_SH = 5,
  LFO_DRIFT = 6;

/** The voice drive's shapes (`voiceDrive.ts`, windsor#300); `soft` is the default. */
const DRIVE_SOFT = 0,
  DRIVE_HARD = 1,
  DRIVE_DIODE = 2,
  DRIVE_TUBE = 3,
  DRIVE_FOLD = 4;

/**
 * A macro mapping's curves (windsor#559, record `2026-10-04-patch-macro-knobs`
 * decision 4): Linear `x`, Exp `x³`, Log `1 − (1 − x)³`, S `x²(3 − 2x)`.
 */
const MACRO_LINEAR = 0,
  MACRO_EXP = 1,
  MACRO_LOG = 2,
  MACRO_S = 3;

const LOOP_MODE = { NONE: LOOP_NONE, LOOP: LOOP_LOOP, TRIGGER: LOOP_TRIGGER } as const;

const FILTER_MODE = {
  OFF: FILT_OFF,
  LOWPASS: FILT_LP,
  HIGHPASS: FILT_HP,
  BANDPASS: FILT_BP,
  NOTCH: FILT_NOTCH,
  FORMANT: FILT_FORMANT,
  LADDER: FILT_LADDER,
} as const;

const LFO_SHAPE = {
  SINE: LFO_SINE,
  TRIANGLE: LFO_TRI,
  SAW_UP: LFO_SAW_UP,
  SAW_DOWN: LFO_SAW_DOWN,
  SQUARE: LFO_SQUARE,
  SAMPLE_HOLD: LFO_SH,
  DRIFT: LFO_DRIFT,
} as const;

const DRIVE_SHAPE = {
  SOFT: DRIVE_SOFT,
  HARD: DRIVE_HARD,
  DIODE: DRIVE_DIODE,
  TUBE: DRIVE_TUBE,
  FOLD: DRIVE_FOLD,
} as const;

const MACRO_CURVE = {
  LINEAR: MACRO_LINEAR,
  EXP: MACRO_EXP,
  LOG: MACRO_LOG,
  S: MACRO_S,
} as const;

export {
  LOOP_NONE,
  LOOP_LOOP,
  LOOP_TRIGGER,
  FILT_OFF,
  FILT_LP,
  FILT_HP,
  FILT_BP,
  FILT_NOTCH,
  FILT_FORMANT,
  FILT_LADDER,
  LFO_SINE,
  LFO_TRI,
  LFO_SAW_UP,
  LFO_SAW_DOWN,
  LFO_SQUARE,
  LFO_SH,
  LFO_DRIFT,
  DRIVE_SOFT,
  DRIVE_HARD,
  DRIVE_DIODE,
  DRIVE_TUBE,
  DRIVE_FOLD,
  MACRO_LINEAR,
  MACRO_EXP,
  MACRO_LOG,
  MACRO_S,
  LOOP_MODE,
  FILTER_MODE,
  LFO_SHAPE,
  DRIVE_SHAPE,
  MACRO_CURVE,
};
