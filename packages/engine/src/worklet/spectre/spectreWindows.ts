/* eslint-disable no-magic-numbers -- DSP: the raised cosine's ½ − ½cos is the shape's arithmetic */
/**
 * Spectre's windows (record `2026-10-16-spectre-insert`): for every frame
 * size and shape, the square root of the shape, which the analysis and the
 * synthesis each apply, so their product is the shape itself; and the
 * overlap-add gain that brings the sum of overlapping products back to unity
 * at each overlap. Built once, for every size the processor can reach, so a
 * change of resolution or window only picks another table (worklet rule 5:
 * a rare path stays a switch, not a rebuild).
 *
 * Shapes, periodic over the frame: `smooth` the raised cosine, `triangle`
 * the tent, `hard` flat. The gain is `hop / Σ shape`, the mean overlap sum's
 * inverse: exact for the raised cosine and the tent at 2× and 4×, the flat at
 * every overlap, and a deliberate ripple for the others (1× with a shape).
 * Pinned by `inserts/spectreDsp.test.ts` (unity through the transform).
 */
import { cosine } from '../../inserts/tapePortableMath';

const SPECTRE_WINDOW_TWO_PI = 6.283185307179586;

class SpectreWindows {
  /** `roots[size][shape]`: the square root of the shape, `sizes[size]` samples. */
  readonly roots: Float64Array[][];
  /** `sums[size][shape]`: the shape's sum over a frame. */
  readonly sums: Float64Array;
  readonly sizes: readonly number[];
  readonly shapes: number;

  constructor(sizes: readonly number[], shapes: number) {
    this.sizes = sizes;
    this.shapes = shapes;
    this.sums = new Float64Array(sizes.length * shapes);
    this.roots = sizes.map((n, s) => {
      const row: Float64Array[] = [];
      for (let shape = 0; shape < shapes; shape++) {
        const root = new Float64Array(n);
        let sum = 0;
        for (let j = 0; j < n; j++) {
          const w = shapeAt(shape, j, n);
          sum += w;
          root[j] = Math.sqrt(w);
        }
        this.sums[s * shapes + shape] = sum;
        row.push(root);
      }
      return row;
    });
  }

  /** The overlap-add gain for size index `size`, shape `shape` and `hop`. */
  gain(size: number, shape: number, hop: number): number {
    return hop / this.sums[size * this.shapes + shape];
  }
}

/** The shape's value at sample `j` of a periodic frame of `n`. */
function shapeAt(shape: number, j: number, n: number): number {
  if (shape === 0) return 0.5 - 0.5 * cosine((SPECTRE_WINDOW_TWO_PI * j) / n);
  if (shape === 1) {
    const x = (2 * j) / n - 1;
    return 1 - (x < 0 ? -x : x);
  }
  return 1;
}

export { SpectreWindows };
