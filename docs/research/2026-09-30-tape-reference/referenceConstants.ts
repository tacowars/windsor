/** Declared before measurement. Research settings, not product defaults. */
export { CORE, EXPERIMENT } from '../2026-09-30-tape-phase-3/experimentConstants';
export const REFERENCE = {
  refinements: [16, 32, 64],
  subdivisions: [8, 16, 32],
  histories: [-1, 1],
  periods: 3,
  principalPeriod: 1,
  extendedPeriod: 2,
  quietLow: { periods: 17, principalPeriod: 8, extendedPeriod: 16 },
  normalLevels: [0.01, 0.25, 1],
  overloadLevel: 4,
  twoToneBins: [997, 1361],
  lowMidGateDb: -70,
  highGateDb: -60,
  settlingGateDb: -80,
  diagnosticFactor: 4,
  quadraturePanels: 4096,
  equationTolerance: 2e-9,
  equationStates: [-0.1, 0, 0.1],
  equationFields: [-4, -0.01, -1e-12, 0, 1e-12, 0.01, 4],
  equationVelocities: [-1, 0, 1],
  sensitivityDb: 0.1,
};
