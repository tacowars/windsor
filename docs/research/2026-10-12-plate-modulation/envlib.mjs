// The Welch-averaged envelope spectrum the held and fed beats are read from.
import { fft } from './rig.mjs';
export function envWelch(env, envRate, segS = 10) {
  const n = Math.round(segS * envRate);
  let N = 1; while (N < n) N <<= 1;
  let mean = 0; for (const v of env) mean += v; mean /= env.length;
  const acc = new Float64Array(N / 2);
  let count = 0, wsum = 0;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) { w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)); wsum += w[i]; }
  for (let s = 0; s + n <= env.length; s += Math.floor(n / 2)) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < n; i++) re[i] = (env[s + i] - mean) * w[i];
    fft(re, im);
    for (let k = 0; k < N / 2; k++) acc[k] += re[k] ** 2 + im[k] ** 2;
    count++;
  }
  let best = 0, at = 0;
  for (let k = 1; k < N / 2; k++) {
    const f = (k * envRate) / N;
    if (f < 0.1 || f > 10) continue;
    const a = (2 * Math.sqrt(acc[k] / count)) / wsum;
    if (a > best) { best = a; at = f; }
  }
  return { db: 20 * Math.log10(best / mean), hz: at };
}

