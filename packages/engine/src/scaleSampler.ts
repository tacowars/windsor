/**
 * Pitch sampled from a weighted scale (record
 * `2026-08-31-generative-sequencing-transport-and-pitch` §4).
 *
 * A sampler holds a root, a scale and a weight per degree. It owns no random
 * stream: every draw takes the caller's `Rng`, so the arp and the drone share
 * one harmony while each keeps its own seeded stream. Register is the caller's
 * too -- the same sampler serves an upper-octave arp and a low drone, and that
 * split is the whole difference between them.
 */
import { SCALES } from './audioConstants';
import type { Rng } from './generatorSeed';

/** The scale table lives in `audioConstants.ts`; re-exported here as its home. */
export { SCALES };
export type ScaleName = keyof typeof SCALES;
export const SCALE_NAMES = Object.keys(SCALES) as readonly ScaleName[];

export interface ScaleSamplerConfig {
  /** MIDI note of the root in the reference octave (60 = middle C). */
  root: number;
  /** A named scale, or explicit semitone offsets for one not in the table. */
  scale: ScaleName | readonly number[];
  /** Relative weight per degree, same length as the scale; non-negative, not all zero. */
  weights: readonly number[];
}

/** Where a part draws: `octave` offsets from the root, spread over `span` octaves upward. */
export interface Register {
  octave: number;
  /** Octaves the draw may land in, `>= 1`; 1 pins every note to `octave`. */
  span: number;
}

export interface SampledNote {
  degree: number;
  /** MIDI note number. */
  note: number;
}

export const SEMITONES_PER_OCTAVE = 12;

/**
 * A written degree folded into a scale of `degreeCount` degrees (#602): a
 * degree past the end wraps with octave carry, so degree 6 in a five-degree
 * scale is degree 1 one octave up, exactly as the eighth degree of a seven-note
 * scale is the root an octave up. A line written in seven degrees therefore
 * keeps its contour in five, and the step data never changes.
 */
export function foldDegree(degree: number, degreeCount: number): { degree: number; carry: number } {
  const count = Math.max(1, Math.trunc(degreeCount));
  const d = Math.max(0, Math.trunc(degree));
  return { degree: d % count, carry: Math.floor(d / count) };
}

export function scaleOffsets(scale: ScaleName | readonly number[]): readonly number[] {
  return typeof scale === 'string' ? SCALES[scale] : scale;
}

/** Equal weight per degree -- the neutral starting point before tuning by ear. */
export function uniformWeights(scale: ScaleName | readonly number[]): number[] {
  return new Array<number>(scaleOffsets(scale).length).fill(1);
}

export class ScaleSampler {
  readonly root: number;
  readonly offsets: readonly number[];
  readonly weights: readonly number[];
  private readonly cumulative: readonly number[];

  constructor(config: ScaleSamplerConfig) {
    this.root = config.root;
    this.offsets = scaleOffsets(config.scale);
    this.weights = config.weights;
    if (this.offsets.length === 0) throw new RangeError('scale has no degrees');
    if (config.weights.length !== this.offsets.length) {
      throw new RangeError(
        `weights (${config.weights.length}) must match the scale's degrees (${this.offsets.length})`,
      );
    }
    let total = 0;
    this.cumulative = config.weights.map((w) => {
      if (!(w >= 0)) throw new RangeError(`weights must be non-negative, got ${w}`);
      total += w;
      return total;
    });
    if (total <= 0) throw new RangeError('weights must not all be zero');
  }

  get degreeCount(): number {
    return this.offsets.length;
  }

  /** One weighted draw of a degree index; consumes one value from `rng`. */
  sampleDegree(rng: Rng): number {
    const total = this.cumulative[this.cumulative.length - 1] ?? 0;
    const r = rng() * total;
    const hit = this.cumulative.findIndex((c, i) => r < c && (this.weights[i] ?? 0) > 0);
    return hit === -1 ? this.lastWeighted() : hit;
  }

  /** MIDI note for a degree in a register, no randomness. */
  noteFor(degree: number, octave: number): number {
    const offset = this.offsets[degree];
    if (offset === undefined) throw new RangeError(`degree ${degree} is outside the scale`);
    return this.root + offset + octave * SEMITONES_PER_OCTAVE;
  }

  /** MIDI note for a written degree, wrapping past the scale's end with octave carry (#602). */
  noteForFolded(degree: number, octave: number): number {
    const folded = foldDegree(degree, this.offsets.length);
    return this.noteFor(folded.degree, octave + folded.carry);
  }

  /** A degree by weight, then an octave uniformly within the register. Consumes two values. */
  sampleNote(rng: Rng, register: Register): SampledNote {
    const degree = this.sampleDegree(rng);
    const span = Math.max(1, Math.trunc(register.span));
    const octave = register.octave + Math.floor(rng() * span);
    return { degree, note: this.noteFor(degree, octave) };
  }

  private lastWeighted(): number {
    for (let i = this.weights.length - 1; i >= 0; i--) {
      if ((this.weights[i] ?? 0) > 0) return i;
    }
    return 0;
  }
}
