/**
 * Arrangement types, the merge, and the diagnostic fallback.
 *
 * The musical arrangement itself is not TypeScript any more (issue #75): it is
 * a JSON document under `arrangements/`, imported at build time and normalised
 * by `makeArrangement` (`arrangementDocument.ts`) — decision record
 * `2026-08-31-arrangement-console-and-runtime-arrangements` §3. This file keeps
 * what the code itself owns: the types, the apply-over-defaults merge, and
 * `FALLBACK_ARRANGEMENT`.
 *
 * The four part slots are optional: a document ships only the parts it
 * defines, an absent slot builds no generator and makes no sound, and nothing
 * ever defaults a missing part to something musical — a hardwired musical
 * stand-in is invisible precisely because the real arrangement is generative
 * (record §4).
 *
 * Seeds are deliberately absent from the driver configs: the one `seed` below
 * plus a fixed per-part generator index (`GENERATOR_INDEX`,
 * `arrangementPlayer.ts`) derive every stream, so re-rolling one part cannot
 * move another (record §4; refinement decision 4 — this is not the world seed).
 */
import type { ArpeggiatorConfig } from './arpeggiator';
import type { EuclideanConfig } from './euclideanSequencer';
import type { ScaleName } from './scaleSampler';
import { DIVISORS } from './scheduler';
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
  readonly kick?: PercussionArrangement;
  readonly hat?: PercussionArrangement;
  readonly arp?: ArpArrangement;
  readonly drone?: DroneArrangement;
}

/**
 * The fallback is a diagnostic click, not a musical default (record §4): one
 * percussion part on a quarter-note pulse — no sends, no harmony, no
 * generative movement. It plays only when nothing usable survives
 * `makeArrangement`, and it is deliberately unmusical so it can never be
 * mistaken for the arrangement. It is also more informative than silence: a
 * click proves the context resumed, the worklets loaded, the routing works
 * and the master path is open, which narrows the fault to the document alone.
 *
 * The narrow type is the "one part" guarantee: exactly the kick slot is
 * populated, so no pitched generator exists to draw from the (unused) key.
 */
export const FALLBACK_ARRANGEMENT: Arrangement & { readonly kick: PercussionArrangement } = {
  seed: 0,
  bpm: 120,
  // No pitched part exists to draw from this; it is here because a key is
  // structurally required, and it is a single root on purpose — nothing musical.
  key: { root: 60, scale: [0], weights: [1] },
  kick: {
    // Deliberately not a MIX strip: the click routes through DEFAULT_STRIP —
    // unity, centred, and with no sends — whatever the shipped mix says.
    part: 'click',
    preset: 'pickup-blip',
    note: 76,
    velocity: 1,
    hold: 0.05,
    driver: {
      steps: 4,
      divisor: DIVISORS.quarter,
      // min === max: E(4,4) fires every step and the density LFO has nothing
      // to modulate, so the pulse never varies and no RNG is consumed — the
      // one part is not generative.
      pulses: { min: 4, max: 4, start: 4 },
      rotate: 0,
      density: { kind: 'lfoBars', bars: 1, shape: 'tri' },
    },
  },
};

/**
 * A recursive partial of the arrangement, for `AudioSystem.apply()`. Arrays
 * (weights, an explicit scale) are replaced wholesale, never merged. The
 * `NonNullable` unwrap is what lets a partial reach inside the optional part
 * slots.
 */
export type DeepPartial<T> = {
  [K in keyof T]?: NonNullable<T[K]> extends readonly unknown[]
    ? T[K]
    : NonNullable<T[K]> extends object
      ? DeepPartial<NonNullable<T[K]>>
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
        // Also where a partial naming an absent part slot lands: a part that
        // was never initialised has no AudioPart and cannot be added live.
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
