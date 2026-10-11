/**
 * bloom's band-limited waveforms (`BLOOM_GENERATOR`): one cycle each of the
 * sawtooth, Σ (−1)^(k+1) sin(kφ)/k, and the triangle,
 * Σ_odd (−1)^((k−1)/2) sin(kφ)/k², at every partial count a band can need
 * (`counts`: each up to `tableExactLevels`, then `tableLevelStep` apart, up
 * to the most partials the lowest band can carry under the harmonic limit at
 * Octave's lowest ratio and Scale's lowest shift). `levelOf[K]` is the
 * largest count at or under K. A table holds `sizes[level]` points (a power
 * of two, at least `tableOversample` a cycle of its top partial) and a guard
 * point equal to its first, so a linear read needs no wrap.
 *
 * The square and the pulse are two saw reads (`bloomSynth.ts`); the sine is
 * the triangle's first level. Nothing here depends on a control, so one set
 * per sample rate is built on first use, by an FFT whose twiddles are the
 * portable sine and cosine (the same bits on every platform), and every
 * bloom at that rate shares it.
 *
 * Constructor time only: it allocates.
 */
import { BLOOM_LOWEST_NOTE } from '../../inserts/bloomConstants';
import { BLOOM_BANDS } from '../../inserts/bloomBandsConstants';
import { BLOOM_GENERATOR as C, BLOOM_OCTAVE_RATIOS } from '../../inserts/bloomGeneratorConstants';
import { cosine, exp2, sine } from '../../inserts/tapePortableMath';

/** Scale moves a band at most this many semitones down (pentatonic gaps of 3 split 1/2). */
const BLOOM_TABLES_SCALE_REACH = 2;

interface BloomTableSet {
  rate: number;
  maxPartials: number;
  counts: Int32Array;
  levelOf: Int32Array;
  sizes: Int32Array;
  saw: Float32Array[];
  triangle: Float32Array[];
}

const BLOOM_TABLE_SETS: BloomTableSet[] = [];

/** The table set for `rate`, built on first use. */
function bloomTables(rate: number): BloomTableSet {
  for (const set of BLOOM_TABLE_SETS) if (set.rate === rate) return set;
  const set = bloomBuildTables(rate);
  BLOOM_TABLE_SETS.push(set);
  return set;
}

/** The most partials any band can carry at `rate`. */
function bloomMaxPartials(rate: number): number {
  const limit = Math.min(C.harmonicLimitHz, C.nyquistShare * rate);
  let lowestRatio = Infinity;
  for (const [num, den] of BLOOM_OCTAVE_RATIOS) lowestRatio = Math.min(lowestRatio, num / den);
  const lowest =
    BLOOM_BANDS.a4Hz *
    exp2(
      (BLOOM_LOWEST_NOTE - BLOOM_BANDS.a4Note - BLOOM_TABLES_SCALE_REACH) /
        BLOOM_BANDS.semitonesPerOctave,
    ) *
    lowestRatio;
  return Math.max(1, Math.floor(limit / lowest));
}

function bloomBuildTables(rate: number): BloomTableSet {
  const maxPartials = bloomMaxPartials(rate);
  const list: number[] = [];
  for (let k = 1; k <= Math.min(C.tableExactLevels, maxPartials); k++) list.push(k);
  let k = list[list.length - 1];
  while (k < maxPartials) {
    k = Math.min(maxPartials, Math.ceil(k * C.tableLevelStep));
    list.push(k);
  }
  const counts = Int32Array.from(list);
  const levelOf = new Int32Array(maxPartials + 1);
  for (let level = 0, count = 0; count <= maxPartials; count++) {
    while (level + 1 < counts.length && counts[level + 1] <= count) level++;
    levelOf[count] = level;
  }
  const sizes = Int32Array.from(counts, (count) => {
    let size = C.tableMinSize;
    while (size < C.tableOversample * count) size *= 2;
    return size;
  });
  const largest = sizes[sizes.length - 1];
  const fft = new BloomFft(largest);
  const saw: Float32Array[] = [],
    triangle: Float32Array[] = [];
  for (let level = 0; level < counts.length; level++) {
    const count = counts[level],
      size = sizes[level];
    saw.push(fft.synthesise(size, count, (j) => (j % 2 === 1 ? 1 : -1) / j));
    triangle.push(
      fft.synthesise(size, count, (j) => (j % 2 === 0 ? 0 : (j % 4 === 3 ? -1 : 1) / (j * j))),
    );
  }
  return { rate, maxPartials, counts, levelOf, sizes, saw, triangle };
}

/** A radix-2 FFT for building the tables: Σ_j a_j sin(2πjn/N), n = 0 … N − 1, plus the guard point. */
class BloomFft {
  largest: number;
  cos: Float64Array;
  sin: Float64Array;
  re: Float64Array;
  im: Float64Array;

  constructor(largest: number) {
    this.largest = largest;
    const half = largest / 2;
    this.cos = new Float64Array(half);
    this.sin = new Float64Array(half);
    for (let j = 0; j < half; j++) {
      this.cos[j] = cosine((2 * Math.PI * j) / largest);
      this.sin[j] = sine((2 * Math.PI * j) / largest);
    }
    this.re = new Float64Array(largest);
    this.im = new Float64Array(largest);
  }

  /** One cycle of Σ_{j=1}^{count} weight(j) sin(jφ) at `size` points, and its guard point. */
  synthesise(size: number, count: number, weight: (j: number) => number): Float32Array {
    const re = this.re,
      im = this.im;
    re.fill(0, 0, size);
    im.fill(0, 0, size);
    // y[n] = Σ_j X[j] e^{−2πijn/N} with X[j] = a_j: Im y[n] = −Σ a_j sin(2πjn/N).
    for (let j = 1; j <= count; j++) re[j] = weight(j);
    this.transform(size);
    const table = new Float32Array(size + 1);
    for (let n = 0; n < size; n++) table[n] = -im[n];
    table[size] = table[0];
    return table;
  }

  /** In place, the first `size` points: bit reversal, then the butterflies. */
  transform(size: number): void {
    const re = this.re,
      im = this.im;
    for (let i = 1, j = 0; i < size; i++) {
      let bit = size >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const tr = re[i],
          ti = im[i];
        re[i] = re[j];
        im[i] = im[j];
        re[j] = tr;
        im[j] = ti;
      }
    }
    for (let length = 2; length <= size; length *= 2) {
      const half = length / 2,
        stride = this.largest / length;
      for (let start = 0; start < size; start += length)
        for (let j = 0; j < half; j++) {
          const wr = this.cos[j * stride],
            wi = -this.sin[j * stride];
          const a = start + j,
            b = a + half;
          const tr = re[b] * wr - im[b] * wi,
            ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] = re[a] + tr;
          im[a] = im[a] + ti;
        }
    }
  }
}

export { bloomMaxPartials, bloomTables };
export type { BloomTableSet };
