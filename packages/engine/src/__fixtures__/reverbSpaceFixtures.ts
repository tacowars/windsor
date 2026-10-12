/**
 * The plate's old named spaces (windsor#774), kept as the inputs the DSP tests
 * measure: `mixer/reverbSpace.ts`'s `SPACES` rows as they stood when the
 * preset bank (`inserts/reverbPresets.ts`) replaced them, copied verbatim. A
 * test's input, threshold or expected figure was read on these rows, so they
 * never change; Resident, the bank's default, equals `hall` field for field.
 * `wash` is left out: no test reads it.
 */
import { makeSpace } from '../mixer/reverbSpace';

export const SPACE_ROWS = {
  plate: makeSpace({
    size: 0.5,
    decay: 1.25,
    preDelay: 0.005,
    inputLowCut: 100,
    inputHighCut: 12000,
    tankLowCut: 120,
    tankHighCut: 7000,
    modRate: 1,
    modDepth: 0.5,
    voicing: 'plate',
  }),
  room: makeSpace({
    size: 0.28,
    decay: 0.4,
    preDelay: 0.008,
    inputLowCut: 120,
    inputHighCut: 11000,
    tankLowCut: 150,
    tankHighCut: 5500,
    modRate: 0.4,
    modDepth: 0.3,
    voicing: 'plate',
  }),
  hall: makeSpace({
    size: 1.4,
    decay: 6.35,
    preDelay: 0.025,
    inputLowCut: 60,
    tankLowCut: 60,
    tankHighCut: 6500,
    modRate: 0.5,
    modDepth: 0.8,
    voicing: 'plate',
  }),
  cathedral: makeSpace({
    size: 3,
    decay: 30.4,
    preDelay: 0.05,
    inputLowCut: 45,
    inputHighCut: 8000,
    tankLowCut: 40,
    tankHighCut: 4200,
    modRate: 0.3,
    modDepth: 1.2,
    voicing: 'plate',
  }),
  shimmer: makeSpace({
    size: 0.7,
    decay: 5.05,
    preDelay: 0.012,
    inputLowCut: 200,
    inputHighCut: 16000,
    tankLowCut: 250,
    tankHighCut: 11000,
    modRate: 2.4,
    modDepth: 1.8,
    voicing: 'plate',
  }),
};
