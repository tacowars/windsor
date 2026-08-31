/**
 * The arrangement: the four parts of
 * docs/log/2026-08-31-generative-sequencing-transport-and-pitch.md §7 as
 * exported plain data with exported types.
 *
 * Everything tunable lives here, not in a constructor call or a private field:
 * the arrangement console (#70) reads this to populate controls and writes it
 * back as a document overlay, and `AudioSystem.apply()` merges a partial onto
 * it live. Key, scale, degree weights, register split and LFO periods are
 * tuning by ear — these values are defensible starting points for the
 * maintainer's listen (issue #69), not the deliverable.
 *
 * Seeds are deliberately absent from the driver configs: the one `seed` below
 * plus a fixed per-part generator index (`GENERATOR_INDEX`,
 * `arrangementPlayer.ts`) derive every stream, so re-rolling one part cannot
 * move another (record §4; refinement decision 4 — this is not the world seed).
 */
import type { ArpeggiatorConfig } from './arpeggiator';
import type { EuclideanConfig } from './euclideanSequencer';
import type { ScaleName } from './scaleSampler';
import type { StepSequencerConfig } from './stepSequencer';

/** A driver config as the arrangement stores it: the player injects the seed. */
export type EuclideanDriver = Omit<EuclideanConfig, 'seed' | 'generatorIndex'>;
export type ArpDriver = Omit<ArpeggiatorConfig, 'seed' | 'generatorIndex'>;
export type StepDriver = Omit<StepSequencerConfig, 'seed' | 'generatorIndex'>;

/** The shared harmony every pitched part draws from (record §4). */
export interface ArrangementKey {
  /** MIDI note of the root in the reference octave. */
  readonly root: number;
  readonly scale: ScaleName | readonly number[];
  /** Relative weight per degree, same length as the scale. */
  readonly weights: readonly number[];
}

/** A percussion part: a Euclidean sequencer triggering one fixed note. */
export interface PercussionArrangement {
  /** Part name — the `MIX` key its strip comes from. Not renameable live. */
  readonly part: string;
  /** `PRESETS` key. */
  readonly preset: string;
  /** MIDI note each onset triggers. */
  readonly note: number;
  readonly velocity: number;
  /** Seconds a hit is held before its release phase. */
  readonly hold: number;
  readonly driver: EuclideanDriver;
}

/** The arp: pool + walk over the shared scale (record §5). */
export interface ArpArrangement {
  readonly part: string;
  readonly preset: string;
  readonly velocity: number;
  readonly driver: ArpDriver;
}

/** The drone: the step sequencer, slow, gate 1 so notes tie (record §6). */
export interface DroneArrangement {
  readonly part: string;
  readonly preset: string;
  readonly velocity: number;
  readonly driver: StepDriver;
}

export interface Arrangement {
  /** The arrangement seed all generator streams derive from. Fixed; not the world seed. */
  readonly seed: number;
  readonly bpm: number;
  readonly key: ArrangementKey;
  readonly kick: PercussionArrangement;
  readonly hat: PercussionArrangement;
  readonly arp: ArpArrangement;
  readonly drone: DroneArrangement;
}

/**
 * The shipped arrangement. D dorian, tonic-weighted with the fifth and the
 * minor third next, so the emergent harmony centres without a progression.
 * Kick breathes over 8 bars, hat over 3 (coprime, so the two densities agree
 * only every 24 bars — record §3); the hat figure is rotated off the kick's
 * downbeat. The arp walks up-down in the octave above the root; the drone
 * holds bar-long notes an octave below it.
 */
export const ARRANGEMENT: Arrangement = {
  seed: 204,
  bpm: 96,
  key: { root: 50, scale: 'dorian', weights: [4, 1, 2, 2, 3, 1, 2] },
  kick: {
    part: 'kick',
    preset: 'kick',
    note: 36,
    velocity: 1,
    hold: 0.2,
    driver: {
      steps: 16,
      divisor: 6,
      pulses: { min: 2, max: 5, start: 4 },
      rotate: 0,
      density: { kind: 'lfoBars', bars: 8, shape: 'tri' },
    },
  },
  hat: {
    part: 'hat',
    preset: 'hat',
    note: 42,
    velocity: 0.6,
    hold: 0.08,
    driver: {
      steps: 16,
      divisor: 6,
      pulses: { min: 5, max: 12, start: 8 },
      rotate: 2,
      density: { kind: 'lfoBars', bars: 3, shape: 'sine' },
    },
  },
  arp: {
    part: 'arp',
    preset: 'saw-arp',
    velocity: 0.7,
    driver: {
      divisor: 6,
      poolSize: 4,
      refreshBars: 4,
      walk: 'updown',
      skipChance: 0.3,
      register: { octave: 1, span: 2 },
      gate: 0.6,
    },
  },
  drone: {
    part: 'drone',
    preset: 'drone-sqr',
    velocity: 0.8,
    driver: { divisor: 96, gate: 1, register: { octave: -1, span: 1 } },
  },
};

/**
 * A recursive partial of the arrangement, for `AudioSystem.apply()`. Arrays
 * (weights, an explicit scale) are replaced wholesale, never merged.
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export interface MergeResult {
  merged: Arrangement;
  /** Paths in the partial that named no arrangement field. Ignored, reported. */
  ignored: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeValue(current: unknown, partial: unknown, path: string, ignored: string[]): unknown {
  if (isPlainObject(current) && isPlainObject(partial)) {
    // A tagged union changing kind is replaced wholesale: merging a walk onto
    // an LFO would leave the old kind's fields lying around in the data.
    if ('kind' in current && 'kind' in partial && current.kind !== partial.kind) return partial;
    const merged: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(partial)) {
      const childPath = path === '' ? key : `${path}.${key}`;
      if (!(key in current)) {
        ignored.push(childPath);
        continue;
      }
      merged[key] = mergeValue(current[key], value, childPath, ignored);
    }
    return merged;
  }
  // Leaves are assigned (a scale may swap between name and offsets array); an
  // object arriving where a leaf lives — or vice versa — names no real field.
  if (isPlainObject(current) !== isPlainObject(partial)) {
    ignored.push(path);
    return current;
  }
  return partial;
}

/**
 * Apply-over-defaults: only the fields the partial names change; unknown keys
 * are ignored and reported by path (refinement decision 3). Purely structural —
 * the player validates the merged result before committing it.
 */
export function mergeArrangement(
  current: Arrangement,
  partial: DeepPartial<Arrangement>,
): MergeResult {
  const ignored: string[] = [];
  const merged = mergeValue(current, partial, '', ignored) as Arrangement;
  return { merged, ignored };
}
