/**
 * Arrangement types and the merge.
 *
 * The musical arrangement itself is not TypeScript (issue #75): it is a JSON
 * document under `arrangements/`, imported at build time and normalised by
 * `makeArrangement` (`arrangementDocument.ts`) — decision record
 * `2026-08-31-arrangement-console-and-runtime-arrangements` §3. This file
 * keeps what the code itself owns: the types and the apply-over-defaults
 * merge. The diagnostic fallback is `fallbackArrangement.ts`'s.
 *
 * Since #597 a song is a list of 1–8 parts, each identified by its `slot`
 * (0–7) and carrying any sequencer: a Euclidean fixed-note trigger, the
 * written grid (#602), the chord progression (#606), or `none` — an inert part the keyboard
 * can still play but nothing sequences. A part's name is a label and keys
 * nothing (record `2026-09-17-music-parts-are-a-slot-list-with-a-sequencer-kind`).
 *
 * Seeds are deliberately absent from the driver configs: the one `seed` below
 * plus the part's `slot` as its generator index derive every stream, so
 * re-rolling, removing or reordering one part cannot move another (record
 * `2026-08-31-generative-sequencing-transport-and-pitch` §4 — this is not the
 * world seed).
 */
import type { ChordSequencerConfig } from '../sequencing/chordSequencer';
import type { EuclideanConfig } from '../sequencing/euclideanSequencer';
import type { GridSequencerConfig } from '../sequencing/gridSequencer';
import type { ScaleName } from '../sequencing/scaleSampler';

/** A driver config as the arrangement stores it: the player injects the seed. */
export type EuclideanDriver = Omit<EuclideanConfig, 'seed' | 'generatorIndex'>;
export type GridDriver = Omit<GridSequencerConfig, 'seed' | 'generatorIndex'>;
export type ChordDriver = Omit<ChordSequencerConfig, 'seed' | 'generatorIndex'>;

/** What may drive a part (#597). `none` is inert: allowed anywhere, skipped by every sequencing path. */
export const SEQUENCER_KINDS = ['none', 'euclidean', 'grid', 'chord'] as const;
export type SequencerKind = (typeof SEQUENCER_KINDS)[number];

export interface NoSequencer {
  readonly kind: 'none';
}

/** A Euclidean sequencer triggering one fixed note, held `hold` seconds. */
export type EuclideanSpec = {
  readonly kind: 'euclidean';
  /** MIDI note each onset triggers. */
  readonly note: number;
  /** Seconds a hit is held before its release phase. */
  readonly hold: number;
} & EuclideanDriver;
/** The grid (#602): a written 1–32 step line of scale degrees with accent, slide, tie and rest. */
export type GridSpec = { readonly kind: 'grid' } & GridDriver;
/** The chord progression (#606): 0–32 written steps of diatonic chords by degree, one voicing per part. */
export type ChordSpec = { readonly kind: 'chord' } & ChordDriver;

export type SequencerSpec = NoSequencer | EuclideanSpec | GridSpec | ChordSpec;

/** One part as the player sees it; the document adds its strip (`DocumentPart`). */
export interface MusicPart {
  /** 0–7, unique in the song: the part's identity and its generator index. */
  readonly slot: number;
  /** A display label only — never a key. */
  readonly name: string;
  /** The `patches` id this part plays. */
  readonly preset: string;
  readonly velocity: number;
  readonly sequencer: SequencerSpec;
}

/** The shared harmony every pitched part draws from (record §4). */
export interface ArrangementKey {
  /** MIDI note of the root in the reference octave. */
  readonly root: number;
  readonly scale: ScaleName | readonly number[];
}

export interface Arrangement {
  /** The arrangement seed all generator streams derive from. Fixed; not the world seed. */
  readonly seed: number;
  readonly bpm: number;
  readonly key: ArrangementKey;
  /** 1–8 parts, in display and play order, each on a unique slot. */
  readonly parts: readonly MusicPart[];
}

/** The fields of a sequencer spec that build its generator: `kind`, `note` and `hold` do not. */
export function driverOf(spec: SequencerSpec): Record<string, unknown> {
  const driver: Record<string, unknown> = { ...spec };
  delete driver.kind;
  delete driver.note;
  delete driver.hold;
  return driver;
}

/**
 * A recursive partial, for `AudioSystem.apply()`. Arrays (an explicit
 * scale, a step list) are replaced wholesale, never merged. The `NonNullable`
 * unwrap is what lets a partial reach inside optional fields.
 */
export type DeepPartial<T> = {
  [K in keyof T]?: NonNullable<T[K]> extends readonly unknown[]
    ? T[K]
    : NonNullable<T[K]> extends object
      ? DeepPartial<NonNullable<T[K]>>
      : T[K];
};

/**
 * Live partials of a part list (#597): addressed by slot —
 * `{ parts: { 2: { velocity: 0.5 } } }` — never by list position, so an edit
 * cannot land on the wrong part. A slot the list does not hold takes a whole
 * part (its `slot` field naming that slot) and is appended; `null` at a slot
 * removes the part there (#629). Anything else at an absent slot is ignored
 * and reported.
 */
export type PartsPartial<P> = Readonly<Record<number | string, DeepPartial<P> | null>>;

export type ArrangementPartial = DeepPartial<Omit<Arrangement, 'parts'>> & {
  readonly parts?: PartsPartial<MusicPart>;
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
    // an LFO — or a grid onto a Euclidean — would leave the old kind's fields
    // lying around in the data.
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
 * Merge a slot-keyed parts partial over a part list. A slot the list does not
 * hold is ignored and reported: a part that was never initialised has no
 * `AudioPart` and cannot be added live.
 */
export function mergeParts<P extends { readonly slot: number }>(
  parts: readonly P[],
  partial: unknown,
  ignored: string[],
): P[] {
  if (!isPlainObject(partial)) {
    ignored.push('parts');
    return [...parts];
  }
  let merged = [...parts];
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) continue;
    const index = merged.findIndex((part) => String(part.slot) === key);
    if (value === null) {
      // A removal (#629): the slot leaves the list; an absent one is reported.
      if (index < 0) ignored.push(`parts.${key}`);
      else merged = merged.filter((_, i) => i !== index);
      continue;
    }
    if (index < 0) {
      // A whole part on a free slot is appended (#629); a fragment for a slot
      // the list lacks has nothing to merge into. Structural only — the
      // player validates what the part carries.
      if (isPlainObject(value) && value.slot === Number(key)) merged.push(value as P);
      else ignored.push(`parts.${key}`);
      continue;
    }
    merged[index] = mergeValue(merged[index], value, `parts.${key}`, ignored) as P;
  }
  return merged;
}

/**
 * Apply-over-defaults: only the fields the partial names change; unknown keys
 * are ignored and reported by path (refinement decision 3). Purely structural —
 * the player validates the merged result before committing it.
 */
export function mergeArrangement(current: Arrangement, partial: ArrangementPartial): MergeResult {
  const ignored: string[] = [];
  const { parts, ...rest } = partial;
  const { parts: currentParts, ...currentRest } = current;
  const mergedRest = mergeValue(currentRest, rest, '', ignored) as Omit<Arrangement, 'parts'>;
  const mergedParts = parts === undefined ? currentParts : mergeParts(currentParts, parts, ignored);
  return { merged: { ...mergedRest, parts: mergedParts }, ignored };
}
