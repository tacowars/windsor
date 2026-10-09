// The oscillator's wavetables as `worklet/fm/waveTables.ts` builds them, at
// any table size, and the reads measured here: the engine's linear
// interpolation, and a 4-point cubic (Catmull–Rom) for comparison.
// Research code, whole-signal: not the worklet's code.

export const SR = 48000;
export const MIP_COUNT = 12;
export const MIP_BASE_HZ = 16.352;

export type Wave = 'saw' | 'square' | 'triangle';

/** The engine's harmonic amplitudes (`partialsFor`), index 0 the fundamental. */
function partials(wave: Wave, size: number): Float32Array {
  const n = size >> 1;
  const a = new Float32Array(n);
  if (wave === 'saw') for (let h = 1; h <= n; h++) a[h - 1] = 1 / h;
  else if (wave === 'square') for (let h = 1; h <= n; h += 2) a[h - 1] = 1 / h;
  else for (let h = 1, s = 1; h <= n; h += 2, s = -s) a[h - 1] = s / (h * h);
  return a;
}

/**
 * `buildMips`, operation for operation, with the table size a parameter:
 * a Float32 table per octave, the harmonics above Nyquist at the octave's
 * top dropped, `tone` scaling the count, normalised to peak 1, one guard sample.
 */
export function buildMips(wave: Wave, size: number, tone = 1): Float32Array[] {
  const mask = size - 1;
  const sin = new Float32Array(size);
  for (let i = 0; i < size; i++) sin[i] = Math.sin((2 * Math.PI * i) / size);
  const a = partials(wave, size);
  const mips: Float32Array[] = [];
  for (let k = 0; k < MIP_COUNT; k++) {
    const topHz = MIP_BASE_HZ * Math.pow(2, k + 1);
    let maxH = Math.floor(SR * 0.5 / topHz);
    maxH = Math.min(maxH, size >> 1, a.length);
    maxH = Math.max(1, Math.floor(maxH * tone));
    const t = new Float32Array(size + 1);
    for (let h = 1; h <= maxH; h++) {
      const amp = a[h - 1];
      if (amp === 0) continue;
      let idx = 0;
      for (let i = 0; i < size; i++) {
        t[i] += amp * sin[idx];
        idx = (idx + h) & mask;
      }
    }
    let peak = 0;
    for (let i = 0; i < size; i++) peak = Math.max(peak, Math.abs(t[i]));
    if (peak > 1e-9) for (let i = 0; i < size; i++) t[i] *= 1 / peak;
    t[size] = t[0];
    mips.push(t);
  }
  return mips;
}

/** `mipIndexAt`. */
export function mipIndex(freq: number): number {
  if (freq <= MIP_BASE_HZ) return 0;
  const k = Math.floor(Math.log2(freq / MIP_BASE_HZ));
  return k < 0 ? 0 : k >= MIP_COUNT ? MIP_COUNT - 1 : k;
}

export type Read = 'linear' | 'cubic';

/** `len` samples of a held tone at `freq`, read the way the voice loop reads it. */
export function play(mips: Float32Array[], freq: number, len: number, read: Read): Float64Array {
  const t = mips[mipIndex(freq)];
  const size = t.length - 1;
  const mask = size - 1;
  const inc = freq / SR;
  const y = new Float64Array(len);
  let phase = 0;
  for (let n = 0; n < len; n++) {
    let ph = phase;
    ph -= Math.floor(ph);
    const fi = ph * size;
    const i0 = fi | 0;
    const f = fi - i0;
    if (read === 'linear') {
      const s0 = t[i0];
      y[n] = s0 + (t[i0 + 1] - s0) * f;
    } else {
      const xm = t[(i0 - 1) & mask], x0 = t[i0], x1 = t[(i0 + 1) & mask], x2 = t[(i0 + 2) & mask];
      const c1 = 0.5 * (x1 - xm);
      const c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2;
      const c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
      y[n] = ((c3 * f + c2) * f + c1) * f + x0;
    }
    phase += inc;
    if (phase >= 1) phase -= Math.floor(phase);
  }
  return y;
}

/** The ideal: the same table's harmonics, summed exactly at the sample times. */
export function ideal(mips: Float32Array[], wave: Wave, freq: number, len: number, size: number): Float64Array {
  const k = mipIndex(freq);
  const topHz = MIP_BASE_HZ * Math.pow(2, k + 1);
  const maxH = Math.min(Math.floor(SR * 0.5 / topHz), size >> 1);
  const a = partials(wave, size);
  const y = new Float64Array(len);
  for (let h = 1; h <= maxH; h++) {
    if (a[h - 1] === 0) continue;
    const w = (2 * Math.PI * h * freq) / SR;
    for (let n = 0; n < len; n++) y[n] += a[h - 1] * Math.sin(w * n);
  }
  return y;
}

/**
 * Each octave's table sized to the harmonics it holds: the smallest power of
 * two of at least `ratio` × its harmonic count, from `min` to `max`. The
 * table's samples come from a sine of the largest size read at a stride, which
 * at 2048 gives `Math.sin` the same argument as the shipped table, so a table
 * that stays at 2048 keeps its bits.
 */
export function buildMipsSized(wave: Wave, ratio: number, min: number, max: number, tone = 1): Float32Array[] {
  const big = new Float32Array(max);
  for (let i = 0; i < max; i++) big[i] = Math.sin((2 * Math.PI * i) / max);
  const a = partials(wave, 2048); // the shipped count: at most 1024 harmonics
  const mips: Float32Array[] = [];
  for (let k = 0; k < MIP_COUNT; k++) {
    const topHz = MIP_BASE_HZ * Math.pow(2, k + 1);
    let maxH = Math.floor(SR * 0.5 / topHz);
    maxH = Math.min(maxH, 1024, a.length);
    maxH = Math.max(1, Math.floor(maxH * tone));
    let size = min;
    while (size < ratio * maxH && size < max) size *= 2;
    const stride = max / size;
    const mask = max - 1;
    const t = new Float32Array(size + 1);
    for (let h = 1; h <= maxH; h++) {
      const amp = a[h - 1];
      if (amp === 0) continue;
      let idx = 0;
      const step = h * stride;
      for (let i = 0; i < size; i++) {
        t[i] += amp * big[idx];
        idx = (idx + step) & mask;
      }
    }
    let peak = 0;
    for (let i = 0; i < size; i++) peak = Math.max(peak, Math.abs(t[i]));
    if (peak > 1e-9) for (let i = 0; i < size; i++) t[i] *= 1 / peak;
    t[size] = t[0];
    mips.push(t);
  }
  return mips;
}

/**
 * A table of `size` samples holding sine harmonics `amp[h - 1]` for h ≤ maxH,
 * by an inverse FFT: O(size log size) where the summation is O(maxH · size).
 * The twiddles are Float32-rounded sines, as the summation's table is.
 */
export function tableByFft(amp: Float32Array, maxH: number, size: number): Float32Array {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  // sin(2π h i / N) = Im(e^{+j2π h i / N}): X[h] = amp, then the inverse transform's imaginary part.
  for (let h = 1; h <= maxH; h++) re[h] = amp[h - 1];
  const tw = new Float32Array(size); // sin(2π i / N)
  for (let i = 0; i < size; i++) tw[i] = Math.sin((2 * Math.PI * i) / size);
  const quarter = size >> 2;
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const r = re[i]; re[i] = re[j]; re[j] = r;
      const m = im[i]; im[i] = im[j]; im[j] = m;
    }
  }
  for (let len = 2; len <= size; len <<= 1) {
    const step = size / len;
    for (let i = 0; i < size; i += len) {
      for (let k = 0; k < len >> 1; k++) {
        const idx = k * step;
        const wr = tw[(idx + quarter) & (size - 1)]; // cos
        const wi = tw[idx]; // +sin: the inverse transform
        const a = i + k;
        const b = a + (len >> 1);
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  const t = new Float32Array(size + 1);
  for (let i = 0; i < size; i++) t[i] = im[i];
  return t;
}

/** `buildMipsSized`, its tables past 2048 built by `tableByFft` and the rest by the shipped summation. */
export function buildMipsSizedFft(wave: Wave, ratio: number, min: number, max: number, tone = 1): Float32Array[] {
  const sin = new Float32Array(min);
  for (let i = 0; i < min; i++) sin[i] = Math.sin((2 * Math.PI * i) / min);
  const a = partials(wave, 2048);
  const mips: Float32Array[] = [];
  for (let k = 0; k < MIP_COUNT; k++) {
    const topHz = MIP_BASE_HZ * Math.pow(2, k + 1);
    let maxH = Math.floor(SR * 0.5 / topHz);
    maxH = Math.min(maxH, 1024, a.length);
    maxH = Math.max(1, Math.floor(maxH * tone));
    let size = min;
    while (size < ratio * maxH && size < max) size *= 2;
    let t: Float32Array;
    if (size > min) t = tableByFft(a, maxH, size);
    else {
      t = new Float32Array(size + 1);
      for (let h = 1; h <= maxH; h++) {
        const amp = a[h - 1];
        if (amp === 0) continue;
        let idx = 0;
        for (let i = 0; i < size; i++) {
          t[i] += amp * sin[idx];
          idx = (idx + h) & (size - 1);
        }
      }
    }
    let peak = 0;
    for (let i = 0; i < size; i++) peak = Math.max(peak, Math.abs(t[i]));
    if (peak > 1e-9) for (let i = 0; i < size; i++) t[i] *= 1 / peak;
    t[size] = t[0];
    mips.push(t);
  }
  return mips;
}
