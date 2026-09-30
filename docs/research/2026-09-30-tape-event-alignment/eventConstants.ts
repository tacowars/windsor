/** Fixed windsor#192 experiment, not product parameters or audibility limits.
 * The cases, knee system, core, playback, fixed-8x observation and 1e-7
 * criterion are #188's, imported unchanged; this table adds the ladder,
 * the two integration methods, the field events and the cheaper-reference gate.
 */
import { OVERLOAD } from '../2026-09-30-tape-overload-reference/overloadConstants';
export { CORE, CONDITIONING, cases } from '../2026-09-30-tape-overload-reference/overloadConstants';
export const EVENTS = {
  ...OVERLOAD,
  /** RK4 steps per 48 kHz host sample, visited ascending, both cases and methods per level. */
  levels: [64, 128, 256, 512, 1024],
  /** Uniform-grid RK4 (#188's method) and the same grid plus inserted field-event nodes. */
  methods: ['fixed', 'aligned'] as const,
  /** Located on the continuous source field only: H = 0, |H| = knee, sign of dH/dt. */
  kinds: ['fieldZero', 'knee', 'velocity'] as const,
  /** State-dependent branch switches: never aligned, only recorded per step and stage. */
  switches: ['irreversible', 'series'] as const,
  /** Bisection stops at this bracket width (host frames) or when it no longer narrows. */
  timeTolerance: 2 ** -40,
  bisectionCap: 128,
  /** Events closer than this (host frames) merge into one node; an event this
   * close to a uniform node is already aligned there and inserts nothing. */
  mergeThreshold: 2 ** -30,
  /** Direct kernel evaluation must equal the cached grid value to this relative error. */
  nodeRelative: 1e-15,
  /** Recorded switch locations per family and trajectory; totals are never capped. */
  switchCap: 4096,
  /** #188's raw maximum frame, reported for every trajectory. */
  probeFrame: 143,
  /** "Material" change: the aligned maximum error is at least this factor below fixed. */
  material: 2,
  /** #188's saved 8192x rows, read only: the ruler for every trajectory (M units). */
  ruler: {
    factor: 8192,
    final: 1.694384147775507e-5,
    sha256: 'df4a56a3bf741dad92dd29156556effbfc0dd9a0181740a1da8541773a3df2e9',
  },
  /** #188's saved rows that fixed 1024x must reproduce exactly (M units). */
  anchor: { factor: 1024, final: 1.6944522861437017e-5 },
  /** #190's stage-transition counts at every level, 1024-8192x, for comparison. */
  priorCounts: { fieldZero: 30, knee: 26, velocity: 252 },
};
export type Events = typeof EVENTS;
export type Kind = (typeof EVENTS.kinds)[number];
