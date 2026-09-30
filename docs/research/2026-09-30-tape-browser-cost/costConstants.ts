/** Declared windsor#211 experiment, fixed before measurement: the seven configurations,
 * the 28 offline cells and 14 real-time trials in run order, the music program, the
 * repeats, warmup, target rule and wall-clock bound. Research values, not product
 * settings, defaults or a chosen solver/filter.
 */
import { BROWSER, EXPERIMENT } from '../2026-09-30-tape-phase-3/experimentConstants';

export interface Configuration {
  id: string;
  /** Baseline (phase-2 legacy), filter (identity core) or a magnetic candidate. */
  role: 'baseline' | 'filter' | 'candidate';
  legacy?: boolean;
  solver?: 'rk2' | 'rk4';
  factor?: number;
  span?: number;
  symmetric?: boolean;
  identity?: boolean;
}
const resampled = (solver: 'rk2' | 'rk4', factor: number, span = 48): Configuration => ({
  id: `${solver}/${factor}x/${span}${span === 48 ? 's' : ''}`,
  role: 'candidate',
  solver,
  factor,
  span,
  symmetric: span === 48,
});

/** Declaration order is expected cost, cheapest first (phase-3 Node table, #207 split). */
export const CONFIGURATIONS: Configuration[] = [
  { id: 'legacy', role: 'baseline', legacy: true },
  { id: 'identity/4x/48s', role: 'filter', factor: 4, span: 48, symmetric: true, identity: true },
  resampled('rk4', 2),
  resampled('rk4', 4, 32),
  resampled('rk4', 4),
  resampled('rk2', 8),
  resampled('rk4', 8),
];

export const COST = {
  rate: 48000,
  quantumFrames: 128,
  channels: 2,
  baseline: EXPERIMENT.baseline,
  upstream: EXPERIMENT.upstream,
  instances: [1, 4],
  modes: ['steady', 'edits'] as const,
  /** Offline renders per cell, each in a fresh OfflineAudioContext. */
  repeats: 5,
  /** Phase 3's edit schedule: every 16 quanta, unsmoothed, on every instance. */
  edits: {
    quanta: BROWSER.editQuanta,
    low: BROWSER.editLow,
    high: BROWSER.editHigh,
    legacyDriveScale: BROWSER.legacyDriveScale,
  },
  /** Real-time trials: phase 3's warmup and two measured seconds, four instances. */
  realtime: {
    instances: 4,
    warmupQuanta: BROWSER.warmupQuanta,
    measuredQuanta: BROWSER.measuredQuanta,
    batchQuanta: 64,
    renderCapacitySeconds: 1,
    reportTimeoutMs: 10000,
  },
  /** The epic's target: four instances, edits included, under half a quantum (1.33 ms). */
  targetMs: 1.33,
  /** Decision 7: multiples of the baseline; the filter-only cell over its full path. */
  comparison: { baseline: 'legacy', filter: 'identity/4x/48s', filterOf: 'rk4/4x/48s' },
  /** renderCapacity resolves peak only with no underrun and peakLoad below this. */
  peakLoadLimit: 0.5,
  /** Whole run, Chrome startup included. */
  budgetMs: 900000,
  program: {
    seconds: 20,
    frames: 960000,
    bpm: 120,
    /** Two-operator FM: eight one-beat notes, modulator at `ratio`, depth in cycles. */
    bass: {
      hz: [55, 110, 65.40639, 82.40689, 97.99886, 82.40689, 73.41619, 82.40689],
      ratio: 2,
      depth: 0.4,
      depthDecaySeconds: 0.12,
      decaySeconds: 0.35,
      attackSeconds: 0.005,
      releaseSeconds: 0.01,
      level: 0.5,
    },
    /** A major triad held throughout; each voice detuned by a slow sine. */
    chord: { hz: [220, 277.1826, 329.6276], detune: 0.003, detuneHz: 0.1, level: 0.08 },
    /** 20 ms high-passed LCG noise bursts on every eighth note, off-beats accented. */
    hat: { burstSeconds: 0.02, beats: 0.5, seed: 211, highpass: 0.7, level: 0.2, accent: 0.6 },
    /** A 60 Hz sine decaying from every beat. */
    kick: { hz: 60, decaySeconds: 0.08, level: 0.6 },
    peakDbfs: -6,
    /** 10^(-6/20), written out so no engine's pow enters the program. */
    peakGain: 0.5011872336272722,
    toleranceDb: 0.01,
    /** Right channel = left delayed by this many frames. */
    offsetFrames: 1,
    /** SHA-256 of left then right, little-endian Float32, recorded from Node. */
    sha256: '0697150ce822e1f7db1e9ef013add813f5c7393021a2ffb21565d3e23006717a',
  },
  /** The harness's own smoke plan: not the measurement, never written to its report. */
  smoke: { configurations: ['identity/4x/48s', 'rk4/4x/48s'], repeats: 1 },
};
export type Cost = typeof COST;
export type Mode = (typeof COST.modes)[number];

export interface Step {
  kind: 'offline' | 'realtime';
  id: string;
  configuration: string;
  instances: number;
  mode: Mode;
}
const step = (kind: Step['kind'], c: Configuration, instances: number, mode: Mode): Step => ({
  kind,
  id: `${kind}/${c.id}/${instances}/${mode}`,
  configuration: c.id,
  instances,
  mode,
});

/** Run order: the fourteen short real-time trials, then the four-instance offline cells
 * the target assessment needs, then the one-instance cells; within each, configurations
 * cheapest first, steady before edits. An expired bound loses the least-needed,
 * most expensive cells first. */
export function plan(table: Cost = COST, configurations = CONFIGURATIONS): Step[] {
  const [one, many] = table.instances;
  const steps = (kind: Step['kind'], instances: number) =>
    configurations.flatMap((c) => table.modes.map((m) => step(kind, c, instances, m)));
  return [
    ...steps('realtime', table.realtime.instances),
    ...steps('offline', many),
    ...steps('offline', one),
  ];
}
