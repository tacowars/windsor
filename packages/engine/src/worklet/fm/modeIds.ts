/**
 * The patch's mode ids (#669): the envelope loop modes, the filter modes and
 * the LFO shapes — the numbers the worklet switches on and the main thread's
 * `patch.ts` re-exports as `LOOP_MODE`, `FILTER_MODE` and `LFO_SHAPE`, so a
 * patch, a preset, the console and the DSP name a mode the same way. The
 * scalars are what the hot paths compare against (a module constant, never a
 * property load); the objects are built from them, so each number is written
 * once. Import-free on purpose, like `waveIds.ts`: the main thread reads this
 * module too, so nothing here may touch the worklet scope or the wave cache.
 * Listed in the client project's `files` and compiled by both projects.
 * `modeIds.test.ts` pins `patch.ts`'s re-exports to these objects.
 */

/** Envelope loop modes (`envelope.ts`). */
const LOOP_NONE = 0,
  LOOP_LOOP = 1,
  LOOP_TRIGGER = 2;

/** Filter modes (`svf.ts`). */
const FILT_OFF = 0,
  FILT_LP = 1,
  FILT_HP = 2,
  FILT_BP = 3,
  FILT_NOTCH = 4;

/** LFO shapes (`lfo.ts`). */
const LFO_SINE = 0,
  LFO_TRI = 1,
  LFO_SAW_UP = 2,
  LFO_SAW_DOWN = 3,
  LFO_SQUARE = 4,
  LFO_SH = 5,
  LFO_DRIFT = 6;

const LOOP_MODE = { NONE: LOOP_NONE, LOOP: LOOP_LOOP, TRIGGER: LOOP_TRIGGER } as const;

const FILTER_MODE = {
  OFF: FILT_OFF,
  LOWPASS: FILT_LP,
  HIGHPASS: FILT_HP,
  BANDPASS: FILT_BP,
  NOTCH: FILT_NOTCH,
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

export {
  LOOP_NONE,
  LOOP_LOOP,
  LOOP_TRIGGER,
  FILT_OFF,
  FILT_LP,
  FILT_HP,
  FILT_BP,
  FILT_NOTCH,
  LFO_SINE,
  LFO_TRI,
  LFO_SAW_UP,
  LFO_SAW_DOWN,
  LFO_SQUARE,
  LFO_SH,
  LFO_DRIFT,
  LOOP_MODE,
  FILTER_MODE,
  LFO_SHAPE,
};
