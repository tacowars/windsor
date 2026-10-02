/**
 * Spectra for the filter tests (windsor#331), by an in-place radix-2 FFT.
 * `responseOf` is a filter's exact response, from its impulse response.
 * `transfer`, over Hann-windowed segments of a power-of-two length, half
 * overlapped, is a filter's response read from a render of white
 * noise through it (`output`) and the same noise without it (`input`): the
 * cross spectrum over the input's power (the H1 estimate), averaged over the
 * segments. The voice's noise is seeded, so the two renders carry the same
 * noise, and a linear filter's response comes out with none of the scatter
 * a single noise spectrum has, where a broad peak's top is too flat to place
 * against the noise. `peakNear` finds the loudest bin inside a window and
 * refines it with a parabola through its neighbours, so a peak is read finer
 * than a bin.
 */

/** In-place radix-2 FFT over `re` and `im`, whose length is a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos(step * k);
        const wi = Math.sin(step * k);
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b]! * wr - im[b]! * wi;
        const ti = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
      }
    }
  }
}

/** A spectrum: a power (or a response's squared magnitude) in each bin from 0 to Nyquist, and the bin width in Hz. */
export interface PowerSpectrum {
  power: Float64Array;
  binHz: number;
}

/** One windowed segment of `samples` from `from`, transformed in place into `re` and `im`. */
function segment(
  samples: ArrayLike<number>,
  from: number,
  window: Float64Array,
  re: Float64Array,
  im: Float64Array,
): void {
  for (let i = 0; i < window.length; i++) {
    re[i] = samples[from + i]! * window[i]!;
    im[i] = 0;
  }
  fft(re, im);
}

/**
 * The squared magnitude of the response that took `input` to `output` (two
 * renders of equal length): the averaged cross spectrum over the averaged
 * input power, in segments of `size`.
 */
export function transfer(
  input: ArrayLike<number>,
  output: ArrayLike<number>,
  sampleRate: number,
  size: number,
): PowerSpectrum {
  const bins = size / 2 + 1;
  const window = Float64Array.from(
    { length: size },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size),
  );
  const xr = new Float64Array(size);
  const xi = new Float64Array(size);
  const yr = new Float64Array(size);
  const yi = new Float64Array(size);
  const crossRe = new Float64Array(bins);
  const crossIm = new Float64Array(bins);
  const inputPower = new Float64Array(bins);
  for (let from = 0; from + size <= input.length; from += size / 2) {
    segment(input, from, window, xr, xi);
    segment(output, from, window, yr, yi);
    for (let k = 0; k < bins; k++) {
      // Y · conj(X), and |X|².
      crossRe[k]! += yr[k]! * xr[k]! + yi[k]! * xi[k]!;
      crossIm[k]! += yi[k]! * xr[k]! - yr[k]! * xi[k]!;
      inputPower[k]! += xr[k]! * xr[k]! + xi[k]! * xi[k]!;
    }
  }
  const power = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    power[k] = (crossRe[k]! ** 2 + crossIm[k]! ** 2) / inputPower[k]! ** 2;
  }
  return { power, binHz: sampleRate / size };
}

/** The squared magnitude of an impulse response `h`, zero-padded to `size`, unwindowed. */
export function responseOf(h: ArrayLike<number>, sampleRate: number, size: number): PowerSpectrum {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < Math.min(size, h.length); i++) re[i] = h[i]!;
  fft(re, im);
  const power = Float64Array.from({ length: size / 2 + 1 }, (_, k) => re[k]! ** 2 + im[k]! ** 2);
  return { power, binHz: sampleRate / size };
}

/** A peak: its centre in Hz and its level in dB. */
export interface Peak {
  hz: number;
  db: number;
}

/**
 * The loudest point between `lowHz` and `highHz`, refined by a parabola
 * through the dB of the loudest bin and its two neighbours.
 */
export function peakNear(spectrum: PowerSpectrum, lowHz: number, highHz: number): Peak {
  const { power, binHz } = spectrum;
  const at = (k: number): number => 10 * Math.log10(power[k]!);
  const first = Math.ceil(lowHz / binHz);
  const last = Math.floor(highHz / binHz);
  let best = first;
  for (let k = first; k <= last; k++) if (at(k) > at(best)) best = k;
  const [l, c, r] = [at(best - 1), at(best), at(best + 1)];
  const denominator = l - 2 * c + r;
  const offset = denominator === 0 ? 0 : (0.5 * (l - r)) / denominator;
  return { hz: (best + offset) * binHz, db: c - 0.25 * (l - r) * offset };
}
