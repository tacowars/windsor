// How long a wave's tables take to build, shipped and sized. The worklet
// builds an uncached wave (a tone other than 1, a User wave) on the audio
// thread when a patch arrives, inside one render quantum (2.67 ms at 48 kHz).
// Usage (from the repo root): npx tsx docs/research/2026-10-08-wavetable-floor/buildTime.mts
import { performance } from 'node:perf_hooks';
import { buildMips, buildMipsSized, buildMipsSizedFft } from './tables.mts';

const RUNS = 15;
const med = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];
for (const [label, fn] of [
  ['shipped, saw, tone 1', () => buildMips('saw', 2048)],
  ['sized 22x, saw, tone 1', () => buildMipsSized('saw', 22, 2048, 16384)],
  ['shipped, square, tone 1', () => buildMips('square', 2048)],
  ['sized 22x, square, tone 1', () => buildMipsSized('square', 22, 2048, 16384)],
  ['sized 22x FFT, saw, tone 1', () => buildMipsSizedFft('saw', 22, 2048, 16384)],
  ['sized 22x FFT, square, tone 1', () => buildMipsSizedFft('square', 22, 2048, 16384)],
  ['shipped, saw, tone 0.5', () => buildMips('saw', 2048, 0.5)],
  ['sized 22x, saw, tone 0.5', () => buildMipsSized('saw', 22, 2048, 16384, 0.5)],
  ['sized 22x FFT, saw, tone 0.5', () => buildMipsSizedFft('saw', 22, 2048, 16384, 0.5)],
] as [string, () => Float32Array[]][]) {
  const t: number[] = [];
  let bytes = 0;
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    const m = fn();
    t.push(performance.now() - t0);
    bytes = m.reduce((s, x) => s + x.byteLength, 0);
  }
  console.log(`${label.padEnd(28)} median ${med(t).toFixed(2)} ms   ${(bytes / 1024).toFixed(0)} KB`);
}

// The FFT build against the summation: the largest sample difference over every table.
for (const w of ['saw', 'square', 'triangle'] as const) {
  const a = buildMipsSized(w, 22, 2048, 16384);
  const b = buildMipsSizedFft(w, 22, 2048, 16384);
  let d = 0;
  let same2048 = true;
  for (let k = 0; k < a.length; k++) {
    for (let i = 0; i < a[k].length; i++) d = Math.max(d, Math.abs(a[k][i] - b[k][i]));
    if (a[k].length === 2049) same2048 &&= Buffer.compare(Buffer.from(a[k].buffer), Buffer.from(b[k].buffer)) === 0;
  }
  console.log(`${w}: FFT vs summation, max |diff| ${d.toExponential(2)}; 2048 tables bit-identical: ${same2048}`);
}
