/**
 * The waveform ids (#656): the one table the worklet renders by and the main
 * thread's `patch.ts` re-exports, so a patch, a preset, the console's picker
 * and the operator all name a wave the same way. Import-free on purpose: the
 * main thread reads this module too, so nothing here may touch the worklet
 * scope or the wave cache (`waveTables.ts`). Listed in the engine project's
 * `files` and compiled by both projects. `waveTables.test.ts` pins the ids
 * against `patch.ts`'s re-export.
 */

const WAVE = {
  SINE: 0,
  SAW: 1,
  SQUARE: 2,
  TRIANGLE: 3,
  NOISE: 4,
  SAW_D: 5, // unbandlimited, aliases by design
  SQUARE_D: 6, // unbandlimited, aliases by design
  SINE_4BIT: 7,
  SINE_8BIT: 8,
  USER: 9, // partials supplied by the patch
  PULSE: 10, // two saws, duty from the operator's width
} as const;

export { WAVE };
