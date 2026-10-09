/**
 * The inverse FFT that builds a large wavetable: a sum of sine harmonics in
 * O(size · log size), where `buildMips`'s summation is O(harmonics · size).
 * The lowest octaves' tables hold up to 733 harmonics in up to
 * TABLE_SIZE_MAX samples, and the worklet builds an uncached wave on the
 * audio thread when a patch arrives: summed, a saw's set took about 34 ms,
 * and by this transform about 3 ms, less than the 2048-sample set's 6 ms
 * (`docs/research/2026-10-08-wavetable-floor/`). Invariants: the twiddles
 * are `FFT_SIN`, Float32 sines as `SIN_TAB`'s are, read at a stride, so a
 * smaller size gives `Math.sin` the argument its own table would; the
 * scratch is preallocated at module load, so a build allocates only the
 * table it fills. `waveTables.test.ts` holds a built table to the summation.
 */

import { TABLE_SIZE_MAX } from './fmConstants';

/** sin(2π i / TABLE_SIZE_MAX) as Float32. */
const FFT_SIN = new Float32Array(TABLE_SIZE_MAX);
for (let i = 0; i < TABLE_SIZE_MAX; i++) {
  FFT_SIN[i] = Math.sin((2 * Math.PI * i) / TABLE_SIZE_MAX);
}
const FFT_RE = new Float64Array(TABLE_SIZE_MAX);
const FFT_IM = new Float64Array(TABLE_SIZE_MAX);

/**
 * Write Σ amp[h − 1] · sin(2π h i / size), h = 1 .. maxH, into t[0 .. size):
 * the harmonics as the spectrum's positive bins, then the inverse transform,
 * whose imaginary part is the sine series. `size` is a power of two no larger
 * than TABLE_SIZE_MAX and above 2 · maxH.
 */
function sineSeriesByFft(amp: Float32Array, maxH: number, size: number, t: Float32Array): void {
  const re = FFT_RE;
  const im = FFT_IM;
  re.fill(0, 0, size);
  im.fill(0, 0, size);
  for (let h = 1; h <= maxH; h++) re[h] = amp[h - 1];

  // Bit-reversed order.
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const r = re[i];
      re[i] = re[j];
      re[j] = r;
      const m = im[i];
      im[i] = im[j];
      im[j] = m;
    }
  }

  // Radix-2 butterflies with e^{+j2πk/len}: the inverse transform, unscaled.
  const stride = TABLE_SIZE_MAX / size;
  const mask = size - 1;
  const quarter = size >> 2;
  for (let len = 2; len <= size; len <<= 1) {
    const half = len >> 1;
    const step = size / len;
    for (let i = 0; i < size; i += len) {
      for (let k = 0; k < half; k++) {
        const idx = k * step;
        const wr = FFT_SIN[((idx + quarter) & mask) * stride];
        const wi = FFT_SIN[idx * stride];
        const a = i + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  for (let i = 0; i < size; i++) t[i] = im[i];
}

export { sineSeriesByFft };
