/** Fixed windsor#204 survival test of the declared |H| <= 4 candidate domain.
 * Not product solvers, domains, defaults or audibility limits. The knee system,
 * GPL-3.0-only CHOW-derived core, stage chain rule, RK2/RK4 arithmetic, playback
 * and magnitude-20 state guard are imported unchanged; only this table is new.
 */
import { EXPERIMENT } from '../2026-09-30-tape-phase-3/experimentConstants';
export { CORE, CONDITIONING } from '../2026-09-30-tape-boundary-reference/boundaryConstants';

const center = [0.5, 0.5, 0.5];
export const DYNAMIC = {
  /** Run order: rate-major 48,000, 44,100, 96,000. */
  rates: [48000, 44100, 96000],
  /** Setting-major within a rate, RK4/8x first: it is the diagnostic's reference. */
  settings: [
    { solver: 'rk4', factor: 8 },
    { solver: 'rk4', factor: 2 },
    { solver: 'rk4', factor: 4 },
    { solver: 'rk2', factor: 8 },
  ] as const,
  policy: 'knee' as const,
  /** The declared domain: |H| <= 4 in #197's field units, knee at |H| = 1. */
  domain: 4,
  /** Part 1: #178/#188's 512-frame pulse, level on frames 128-255, zero history. */
  frames: 512,
  history: 0,
  signs: [1, -1],
  center,
  /** The eight corners of the control cube (drive/width/saturation), then the center. */
  points: [...[0, 1].flatMap((d) => [0, 1].flatMap((w) => [0, 1].map((s) => [d, w, s]))), center],
  /** Part 2: EXPERIMENT.bins at bin x rate / period Hz, equal amplitude, sum / 3. */
  bins: EXPERIMENT.bins,
  period: EXPERIMENT.frames,
  seconds: 60,
  /** Every level change is a raised-cosine edge from the value before it. */
  edge: 0.005,
  spike: { width: 0.001, every: 0.25 },
  /** Control schedule: a new point every 50 ms, instantaneous at the step boundary.
   * Each block is a seeded shuffle of the nine points, then one seeded interior point.
   */
  schedule: { step: 0.05, seed: 204, minimumVisits: 10 },
  /** Remanence: mean host-frame M over this many seconds before each segment's end. */
  remanence: 0.1,
  segments: [
    {
      name: 'ramp',
      start: 0,
      end: 10,
      field: 'tones',
      ramp: true,
      controls: [{ at: 0, controls: center }],
    },
    {
      name: 'edits',
      start: 10,
      end: 20,
      field: 'tones',
      ramp: false,
      controls: 'schedule' as const,
    },
    {
      name: 'corners',
      start: 20,
      end: 30,
      field: 'tones',
      ramp: false,
      controls: [
        { at: 20, controls: [1, 0, 1] },
        { at: 25, controls: [1, 1, 1] },
      ],
    },
    {
      name: 'dc',
      start: 30,
      end: 40,
      field: 'levels',
      /** The first edge crossfades from the tones; the last one ends at 40 s. */
      levels: [
        [30, 4],
        [35, -4],
        [39.995, 0],
      ],
      controls: [{ at: 30, controls: center }],
    },
    {
      name: 'opposite',
      start: 40,
      end: 45,
      field: 'levels',
      levels: [
        [40, 4],
        [41, -4],
        [42, 0],
      ],
      controls: [{ at: 40, controls: [1, 0, 0] }],
    },
    /** A width-long raised-cosine bump every `every` seconds, +4 first, alternating. */
    {
      name: 'spikes',
      start: 45,
      end: 55,
      field: 'spikes',
      controls: [{ at: 45, controls: center }],
    },
    {
      name: 'silence',
      start: 55,
      end: 60,
      field: 'silence',
      controls: [{ at: 55, controls: center }],
    },
  ],
  /** Test only: dH/du against a fourth-order central difference of step 2^-10 host
   * samples, relative to max(|dH/du|, floor), so a zero crossing of dH/du stays gated.
   */
  derivative: { tolerance: 1e-9, floor: 1e-3, step: 2 ** -10 },
  /** Wall-clock milliseconds for the whole numerical child. */
  budgetMs: 900000,
};
export type Dynamic = typeof DYNAMIC;
export type Segment = Dynamic['segments'][number];
export type Setting = Dynamic['settings'][number];

const label = (controls: number[]) => controls.join(':');
/** Part 1: rate, then control point, then sign, then setting: 216 trajectories. */
export function staticRows(table = DYNAMIC) {
  return table.rates.flatMap((rate) =>
    table.points.flatMap((controls) =>
      table.signs.flatMap((sign) =>
        table.settings.map(({ solver, factor }) => ({
          part: 'static' as const,
          id: `static/${label(controls)}/${sign * table.domain}/${rate}`,
          ...{ controls, level: sign * table.domain, history: table.history, rate },
          ...{ policy: table.policy, bins: [0], amplitude: 1, sign: 1, solver, factor },
        })),
      ),
    ),
  );
}

/** Part 2: one 60-second program per rate and setting: 12 trajectories. */
export function dynamicRows(table = DYNAMIC) {
  return table.rates.flatMap((rate) =>
    table.settings.map(({ solver, factor }) => ({
      part: 'dynamic' as const,
      id: `dynamic/${rate}`,
      ...{ rate, policy: table.policy, solver, factor },
    })),
  );
}

export const schedule = (table = DYNAMIC) => [...staticRows(table), ...dynamicRows(table)];
