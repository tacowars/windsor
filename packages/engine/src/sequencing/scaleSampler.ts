/**
 * The shared key a pitched part reads (record
 * `2026-08-31-generative-sequencing-transport-and-pitch` §4): a root and a
 * scale, and the deterministic degree → MIDI note mapping over them. It owns
 * no random stream and draws nothing — the weighted degree draw the retired
 * arpeggiator and step sequencer used is gone (#704, epic #703 decision 3);
 * the grid folds written degrees through `noteForFolded`, and the chord
 * progression reads `offsets` and `root`.
 */
import { SCALES } from '../audioConstants';

/** The scale table lives in `audioConstants.ts`; re-exported here as its home. */
export { SCALES };
export type ScaleName = keyof typeof SCALES;
export const SCALE_NAMES = Object.keys(SCALES) as readonly ScaleName[];

export interface ScaleSamplerConfig {
  /** MIDI note of the root in the reference octave (60 = middle C). */
  root: number;
  /** A named scale, or explicit semitone offsets for one not in the table. */
  scale: ScaleName | readonly number[];
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

export class ScaleSampler {
  readonly root: number;
  readonly offsets: readonly number[];

  constructor(config: ScaleSamplerConfig) {
    this.root = config.root;
    this.offsets = scaleOffsets(config.scale);
    if (this.offsets.length === 0) throw new RangeError('scale has no degrees');
  }

  get degreeCount(): number {
    return this.offsets.length;
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
}
