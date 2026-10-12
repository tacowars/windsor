/* global process, console */
// Octave-band T30s with the low band (windsor#748): one, two and three octaves
// below and above lowCross, against Decay × lowDecay below and Decay above,
// and against the same band at lowDecay 1. Damping open, modulation off.
// node lowBand.mjs <bundle> <rate>
import { grid, loadPlate, octave, render, t30 } from './plateRig.mjs';

const [file, rate = '48000'] = process.argv.slice(2);
const plate = loadPlate(file, Number(rate));
const fs = plate.sampleRate;
const CASES = [
  { size: 0.05, decay: 2 },
  { size: 1, decay: 12 },
  { size: 4, decay: 20 },
];
const band = (r, fc) =>
  fc < 20 || fc * Math.SQRT2 > Math.min(20000, fs * 0.45)
    ? null
    : t30(octave(r.L, fc, fs), octave(r.R, fc, fs), fs);
const fmt = (v) => (v === null ? '-' : v.toFixed(2));
const pct = (v, want) => (v === null ? '-' : `${((v / want - 1) * 100).toFixed(0)}%`);

console.log('size\tdecay\tlowCross\tlowDecay\tside\toct\tband Hz\tT30\twant\terr\tat lowDecay 1\tratio err');
for (const [{ size, decay }, lowCross] of grid(CASES, [80, 300, 10000])) {
  const base = { decay, size, lowCross, tankLowCut: 10, tankHighCut: 20000, modDepth: 0, wet: 1, dry: 0 };
  const neutral = render(plate, 1.5 * decay + 2, { ...base, lowDecay: 1 });
  for (const lowDecay of [0.25, 4]) {
    const r = render(plate, 1.5 * decay * Math.max(1, lowDecay) + 2, { ...base, lowDecay });
    for (const [oct, side] of grid([1, 2, 3], ['below', 'above'])) {
      const fc = side === 'below' ? lowCross / 2 ** oct : lowCross * 2 ** oct;
      const value = band(r, fc);
      if (value === null) continue;
      const want = side === 'below' ? decay * lowDecay : decay;
      const ref = band(neutral, fc);
      const refWant = side === 'below' ? ref * lowDecay : ref;
      console.log(
        [size, decay, lowCross, lowDecay, side, oct, fc, fmt(value), want, pct(value, want), fmt(ref), pct(value, refWant)].join('\t'),
      );
    }
  }
}
