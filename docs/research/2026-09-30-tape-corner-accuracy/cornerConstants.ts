/** windsor#215's matrix, reference method, gates, alignment rule and budget, declared
 * before reproduction. Research settings only: no product solver, filter, default or policy.
 */
import { EXPERIMENT } from '../2026-09-30-tape-phase-3/experimentConstants';
export { CORE, EXPERIMENT } from '../2026-09-30-tape-phase-3/experimentConstants';
export { REFERENCE } from '../2026-09-30-tape-reference/referenceConstants';
export { FILTERED } from '../2026-09-30-tape-filtered-reference/filteredConstants';
export { CONDITIONING } from '../2026-09-30-tape-conditioning/conditioningConstants';

export const CORNER = {
  rate: 48000,
  /** Drive/Width/Saturation: the centre, then the eight cube corners. */
  endpoints: [0, 1],
  center: [0.5, 0.5, 0.5],
  /** EXPERIMENT.bins singly, then REFERENCE.twoToneBins. */
  signals: [[17], [173], [1361], [997, 1361]],
  /** Normal levels are gated; the domain edge |H| = 4 is reported without a gate. */
  levels: [0.25, 1, 4],
  edgeLevel: 4,
  sign: 1,
  policy: 'knee' as const,
  solver: 'rk4' as const,
  /** #167's qualified reference: continuous span-32 kernel, RK4 at these factors. */
  refinements: [16, 32, 64],
  referenceSpan: EXPERIMENT.firSpan,
  /** Both successive pairs must pass, raw and full, plus the settling gate. */
  referenceGates: { lowMidDb: -70, highDb: -60, settlingDb: -80 },
  /** Unfitted full-output residual against the 64× reference; high = bin 1361 or two-tone. */
  candidateGates: { lowMidDb: -60, highDb: -50, sensitivityDb: 0.1 },
  highBin: 1361,
  /** Alignment: the candidate's pair delays by `span`, the reference by referenceSpan;
   * the residual shifts the reference by the difference and fits nothing else. */
  settings: [
    { factor: 2, span: 32, decimator: 'existing' },
    { factor: 2, span: 48, decimator: 'symmetric' },
    { factor: 4, span: 32, decimator: 'existing' },
    { factor: 4, span: 48, decimator: 'symmetric' },
  ] as const,
  /** Grid on which the span-48 field is built; subgrids select 2× and 4×. */
  candidateGrid: 8,
  /** #207's image/alias reporting figure, applied to other-bin energy, ungated. */
  otherBinFigureDbc: -60,
  budgetMs: 900000,
  expected: { references: 108, candidates: 432, gatedPerSetting: 72 },
};
export type Corner = typeof CORNER;
export type Setting = Corner['settings'][number];
export type Row = {
  id: string;
  controls: number[];
  bins: number[];
  amplitude: number;
  sign: number;
};

export const settingId = (s: Setting) =>
  `rk4/${s.factor}x/${s.span}${s.decimator === 'symmetric' ? 's' : ''}`;
export const candidateId = (row: Row, s: Setting) => `${row.id}@${settingId(s)}`;

/** Case-major schedule: level, then controls (centre first), then signal. */
export function cases(table: Corner = CORNER): Row[] {
  const ends = table.endpoints;
  const corners = ends.flatMap((d) => ends.flatMap((w) => ends.map((s) => [d, w, s])));
  return table.levels.flatMap((amplitude) =>
    [table.center, ...corners].flatMap((controls) =>
      table.signals.map((bins) => ({
        id: `${controls.join(':')}/${bins.join('+')}/${amplitude}`,
        controls: [...controls],
        bins: [...bins],
        amplitude,
        sign: table.sign,
      })),
    ),
  );
}
