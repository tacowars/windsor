/* eslint-disable no-magic-numbers -- DSP: the halves in the real split and its inverse are the transform's arithmetic */
/**
 * Spectre's real FFT (record `2026-10-16-spectre-insert`): a frame of `n`
 * real samples to its `n / 2 + 1` bands and back, `n` a power of two up to
 * the size it was built for. The frame is read as `n / 2` complex samples
 * (even samples real, odd imaginary), transformed by an in-place radix-2
 * decimation in time, and split into the real signal's spectrum; the inverse
 * runs the same steps backward. Textbook arithmetic, Windsor's own code.
 *
 * Invariants: `forward` and `inverse` allocate nothing and pass no double
 * across a call (worklet rule 2): the frame lives in `frame`, the bands in
 * `re` and `im`. The twiddles come from `tapePortableMath.ts`, so the
 * transform is the same bits on arm64 and x64. `inverse(forward(x))` is `x`
 * within float rounding, pinned by `inserts/spectreDsp.test.ts`.
 */
import { cosine, sine } from '../../inserts/tapePortableMath';

const SPECTRE_TWO_PI = 6.283185307179586;

class SpectreFft {
  /** The largest frame the tables serve. */
  readonly capacity: number;
  /** The current frame size, and its half: the complex length and the top band. */
  size: number;
  half: number;
  /** The time-domain frame: `forward` reads it, `inverse` writes it. */
  readonly frame: Float64Array;
  /** The bands, 0 to `half`: `forward` writes them, `inverse` reads them. */
  readonly re: Float64Array;
  readonly im: Float64Array;
  /** cos and sin of 2πj / capacity for j up to capacity / 2. */
  readonly cosTable: Float64Array;
  readonly sinTable: Float64Array;
  /** The complex scratch the transform works in. */
  readonly zr: Float64Array;
  readonly zi: Float64Array;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.size = capacity;
    this.half = capacity >> 1;
    this.frame = new Float64Array(capacity);
    this.re = new Float64Array(this.half + 1);
    this.im = new Float64Array(this.half + 1);
    this.zr = new Float64Array(this.half);
    this.zi = new Float64Array(this.half);
    this.cosTable = new Float64Array(this.half + 1);
    this.sinTable = new Float64Array(this.half + 1);
    for (let j = 0; j <= this.half; j++) {
      const angle = (SPECTRE_TWO_PI * j) / capacity;
      this.cosTable[j] = cosine(angle);
      this.sinTable[j] = sine(angle);
    }
  }

  /** Serve frames of `size` samples from now on. */
  resize(size: number): void {
    this.size = size;
    this.half = size >> 1;
  }

  /** `frame` (size samples) into `re`/`im` (half + 1 bands). */
  forward(): void {
    const m = this.half,
      frame = this.frame,
      zr = this.zr,
      zi = this.zi;
    for (let k = 0; k < m; k++) {
      zr[k] = frame[2 * k];
      zi[k] = frame[2 * k + 1];
    }
    this.complex(-1);
    // The split: X[k] = E[k] + W^k O[k], E and O from Z[k] and conj(Z[m − k]).
    const re = this.re,
      im = this.im,
      cos = this.cosTable,
      sin = this.sinTable;
    const stride = this.capacity / this.size;
    re[0] = zr[0] + zi[0];
    im[0] = 0;
    re[m] = zr[0] - zi[0];
    im[m] = 0;
    for (let k = 1; k < m; k++) {
      const ar = zr[k],
        ai = zi[k],
        br = zr[m - k],
        bi = -zi[m - k];
      const er = 0.5 * (ar + br),
        ei = 0.5 * (ai + bi);
      // O = (Z − conj Z′) / 2i
      const or = 0.5 * (ai - bi),
        oi = -0.5 * (ar - br);
      const wr = cos[k * stride],
        wi = -sin[k * stride];
      re[k] = er + wr * or - wi * oi;
      im[k] = ei + wr * oi + wi * or;
    }
  }

  /** `re`/`im` (half + 1 bands) into `frame` (size samples). */
  inverse(): void {
    const m = this.half,
      re = this.re,
      im = this.im,
      zr = this.zr,
      zi = this.zi,
      cos = this.cosTable,
      sin = this.sinTable;
    const stride = this.capacity / this.size;
    for (let k = 0; k < m; k++) {
      const ar = re[k],
        ai = im[k],
        br = re[m - k],
        bi = -im[m - k];
      const er = 0.5 * (ar + br),
        ei = 0.5 * (ai + bi);
      // O = (X − conj X′) W^−k / 2
      const dr = 0.5 * (ar - br),
        di = 0.5 * (ai - bi);
      const wr = cos[k * stride],
        wi = sin[k * stride];
      const or = dr * wr - di * wi,
        oi = dr * wi + di * wr;
      // Z = E + i O
      zr[k] = er - oi;
      zi[k] = ei + or;
    }
    this.complex(1);
    const frame = this.frame,
      scale = 1 / m;
    for (let k = 0; k < m; k++) {
      frame[2 * k] = zr[k] * scale;
      frame[2 * k + 1] = zi[k] * scale;
    }
  }

  /** The in-place radix-2 transform of `zr`/`zi` over `half` points; `sign` −1 forward, 1 inverse. */
  complex(sign: number): void {
    const m = this.half,
      zr = this.zr,
      zi = this.zi;
    for (let i = 1, j = 0; i < m; i++) {
      let bit = m >> 1;
      for (; (j & bit) !== 0; bit >>= 1) j ^= bit;
      j |= bit;
      if (i < j) {
        const tr = zr[i],
          ti = zi[i];
        zr[i] = zr[j];
        zi[i] = zi[j];
        zr[j] = tr;
        zi[j] = ti;
      }
    }
    const cos = this.cosTable,
      sin = this.sinTable,
      capacity = this.capacity;
    for (let len = 2; len <= m; len <<= 1) {
      const step = capacity / len,
        halfLen = len >> 1;
      for (let start = 0; start < m; start += len) {
        for (let j = 0; j < halfLen; j++) {
          const wr = cos[j * step],
            wi = sign * sin[j * step];
          const a = start + j,
            b = a + halfLen;
          const xr = zr[b] * wr - zi[b] * wi,
            xi = zr[b] * wi + zi[b] * wr;
          zr[b] = zr[a] - xr;
          zi[b] = zi[a] - xi;
          zr[a] += xr;
          zi[a] += xi;
        }
      }
    }
  }
}

export { SpectreFft };
