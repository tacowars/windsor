/** Declared finite static experiment for windsor#167, not product settings. */
export { CORE, EXPERIMENT } from '../2026-09-30-tape-phase-3/experimentConstants';
export { REFERENCE } from '../2026-09-30-tape-reference/referenceConstants';
export { FILTERED } from '../2026-09-30-tape-filtered-reference/filteredConstants';
export const CONDITIONING = {
  policies: ['unchanged', 'nonnegative', 'knee'] as const,
  center: [0.5, 0.5, 0.5],
  endpoints: [0, 1],
  anchorBins: [17, 1361],
  refinements: [16, 32, 64],
  candidates: [
    { solver: 'rk4', factor: 2 },
    { solver: 'rk4', factor: 4 },
    { solver: 'rk2', factor: 8 },
  ] as const,
  knee: 1,
  asymptote: 4,
  boundaryLevels: [0, 1e-12, -1e-12, 1, -1, 8, -8, 100, -100],
  cornerLevels: [-100, 100],
  historyLevels: [-1, 1, -100, 100],
  histories: [-1, 1],
  historyEnd: 64,
  pulseStart: 128,
  pulseEnd: 256,
  boundaryFrames: 512,
  boundaryTimes: [0, 63, 64, 96, 127, 128, 159, 160, 255, 256, 288, 511],
  absoluteReference: 1e-7,
  absoluteCandidate: 1e-5,
  budgetMs: 15 * 60 * 1000,
  expectedTones: 504,
  expectedBoundaries: 297,
};
export type Policy = (typeof CONDITIONING.policies)[number];
export type Controls = readonly number[];
