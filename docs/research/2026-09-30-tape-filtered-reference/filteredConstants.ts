/** Declared numerical domain and bounded refinement plan; no product settings. */
export { CORE, EXPERIMENT } from '../2026-09-30-tape-phase-3/experimentConstants';
export { REFERENCE } from '../2026-09-30-tape-reference/referenceConstants';
export const FILTERED = {
  levels: [16, 32, 64],
  observationFactor: 8,
  normalizationPanels: 4096,
  derivativeStep: 1e-5,
  derivativeTolerance: 2e-8,
  kernelSeriesRadius: 1e-4,
  identityTolerance: 1e-7,
  boundaryFrames: 512,
  // Independent signed pulses, each starting at zero; polarity is applied once.
  boundaryLevels: [0, 1e-12, -1e-12, 1, -1, 8, -8, 100, -100],
  candidateMarginDb: 10,
  boundaryTimes: [0, 127, 128, 129, 159, 160, 255, 256],
  testTimeoutMs: 30000,
};
