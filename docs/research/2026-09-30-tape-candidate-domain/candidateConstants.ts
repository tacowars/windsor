/** Fixed windsor#197 candidate map, not product solvers, domains or audibility limits.
 * The knee system, core, reconstruction, stage chain rule, RK2/RK4 arithmetic,
 * playback and magnitude-20 state guard are imported unchanged; only this table is new.
 */
import { BOUNDARY, cases } from '../2026-09-30-tape-boundary-reference/boundaryConstants';
export { CORE, CONDITIONING } from '../2026-09-30-tape-boundary-reference/boundaryConstants';
export const CANDIDATE = {
  rate: BOUNDARY.rate,
  frames: BOUNDARY.frames,
  policy: BOUNDARY.policy,
  history: 0,
  /** Eight fixed-step settings, steps per 48 kHz host sample, no event alignment. */
  solvers: ['rk2', 'rk4'] as const,
  factors: [1, 2, 4, 8],
  /** Drive/width/saturation triples surveyed in part 2. */
  controls: [
    [0.5, 0.5, 0.5],
    [1, 0, 0],
  ],
  /** Part 2 host levels, ascending magnitude, both signs: sixteen per control. */
  levels: [1, 2, 4, 8, 16, 32, 64, 100],
  signs: [1, -1],
  /** Magnetization units: maximum absolute raw and full-output error, every host frame. */
  limit: 1e-5,
  /** Wall-clock milliseconds for the whole numerical child. */
  budgetMs: 900000,
  /** Qualified rulers, read only: #183's 1024x center rows and #190's 8192x extreme rows. */
  rulers: [
    {
      controls: [0.5, 0.5, 0.5],
      amplitude: 1,
      factor: 1024,
      final: 0.05341405966564157,
      path: '../2026-09-30-tape-boundary-reference/measurement.json',
      sha256: '36b14170b77f9524c77db4791b503c91a4d564db78904c971554c4e7b0daf253',
    },
    {
      controls: [1, 0, 0],
      amplitude: 100,
      factor: 8192,
      final: 1.694384147775507e-5,
      path: '../2026-09-30-tape-overload-reference/measurement.json',
      sha256: 'df4a56a3bf741dad92dd29156556effbfc0dd9a0181740a1da8541773a3df2e9',
    },
  ],
};
export type Candidate = typeof CANDIDATE;

export function settings(table = CANDIDATE) {
  return table.solvers.flatMap((solver) => table.factors.map((factor) => ({ solver, factor })));
}

/** Signed zero-history knee pulses in #178's id format; polarity lives in the field. */
export function pulses(controls: number[][], amplitudes: number[], table = CANDIDATE) {
  return cases({ ...BOUNDARY, controls, amplitudes, signs: table.signs });
}

/** Part 1: the four ruler cases. Part 2: level-major ascending, then control, then sign. */
export function schedule(table = CANDIDATE) {
  const accuracy = pulses(
    table.rulers.map((r) => r.controls),
    table.rulers.map((r) => r.amplitude),
    table,
  ).map((row) => ({ ...row, part: 'accuracy' as const }));
  const survival = table.levels.flatMap((level) =>
    pulses(
      table.controls,
      table.controls.map(() => level),
      table,
    ).map((row) => ({ ...row, part: 'survival' as const })),
  );
  return [...accuracy, ...survival].flatMap((row) =>
    settings(table).map((setting) => ({ ...row, ...setting })),
  );
}
export type Scheduled = ReturnType<typeof schedule>[number];
