/** Offline measurement only; allocation is intentional. Coherent rectangular FFT. */
export function powerSpectrum(samples) {
  const n = samples.length,
    re = Float64Array.from(samples),
    im = new Float64Array(n);
  if (n < 2 || n & (n - 1)) throw Error('FFT length must be a power of two');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let width = 2; width <= n; width *= 2) {
    for (let base = 0; base < n; base += width) {
      for (let k = 0; k < width / 2; k++) {
        const angle = (-2 * Math.PI * k) / width,
          c = Math.cos(angle),
          s = Math.sin(angle);
        const a = base + k,
          b = a + width / 2;
        const r = re[b] * c - im[b] * s,
          v = re[b] * s + im[b] * c;
        re[b] = re[a] - r;
        im[b] = im[a] - v;
        re[a] += r;
        im[a] += v;
      }
    }
  }
  return Float64Array.from(
    { length: n / 2 + 1 },
    (_, i) => ((re[i] ** 2 + im[i] ** 2) * (i === 0 || i === n / 2 ? 1 : 2)) / n ** 2,
  );
}
export function db(power) {
  return 10 * Math.log10(Math.max(1e-30, power));
}
export function spectrumMetrics(samples, bin) {
  const powers = powerSpectrum(samples);
  let alias = 0,
    harmonics = 0;
  for (let i = 1; i < powers.length; i++) {
    if (i % bin !== 0) alias += powers[i];
    else if (i !== bin) harmonics += powers[i];
  }
  return {
    fundamentalDb: db(powers[bin]),
    harmonicDbc: db(harmonics / powers[bin]),
    nonHarmonicDbc: db(alias / powers[bin]),
  };
}
export function errorDb(actual, reference) {
  let error = 0,
    signal = 0;
  for (let i = 0; i < actual.length; i++) {
    error += (actual[i] - reference[i]) ** 2;
    signal += reference[i] ** 2;
  }
  return db(error / Math.max(1e-30, signal));
}
