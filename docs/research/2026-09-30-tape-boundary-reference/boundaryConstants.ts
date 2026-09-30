/** Fixed windsor#178 experiment, not product parameters or audibility limits. */
export { CORE } from '../2026-09-30-tape-phase-3/experimentConstants';
export { CONDITIONING } from '../2026-09-30-tape-conditioning/conditioningConstants';
export const BOUNDARY = {
  rate: 48000,
  frames: 512,
  levels: [16, 32, 64, 128, 256, 512, 1024],
  controls: [
    [0.5, 0.5, 0.5],
    [1, 0, 0],
  ],
  amplitudes: [1, 100],
  signs: [1, -1],
  policy: 'knee' as const,
  knee: 1,
  observationFactor: 8,
  tolerance: 1e-7,
  budgetMs: 900000,
  crossingCap: 256,
  windows: [
    [128, 160],
    [256, 288],
  ],
  stagePhases: [0, 0.5, 0.5, 1],
  families: ['fieldZero', 'knee', 'velocity', 'irreversible', 'series'] as const,
  peaks: ['sourceH', 'h', 'sourceVelocity', 'velocity', 'm', 'slope', 'dtSlope'] as const,
  minima: ['denominator', 'reversibleDenominator'] as const,
};
export function cases(table = BOUNDARY) {
  return table.controls.flatMap((controls, index) =>
    table.signs.map((sign) => {
      const level = sign * table.amplitudes[index];
      return {
        id: `boundary/${controls.join(':')}/0/1/1/${level}/0/${table.rate}/knee`,
        domain: 'boundary' as const,
        controls,
        level,
        history: 0,
        rate: table.rate,
        policy: table.policy,
        bins: [0],
        amplitude: 1,
        sign: 1,
      };
    }),
  );
}
export type BoundaryCase = ReturnType<typeof cases>[number];
