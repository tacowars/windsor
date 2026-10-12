/* global process, console */
// Broadband T30 (or an octave band's) against Decay: impulse after 0.5 s at the asked Size.
import { loadPlate, render, impulseAt, t30, fmt } from './rig.mjs';
const variants = process.argv[2].split(',');
const decays = (process.argv[3] ?? '2,10,60').split(',').map(Number);
const sizes = (process.argv[4] ?? '0.25,1,4').split(',').map(Number);
const depths = (process.argv[5] ?? '0,0.35,4').split(',').map(Number);
const rate = Number(process.argv[6] ?? 48000);
const extra = JSON.parse(process.argv[7] ?? '{}');
const modRate = Number(process.argv[8] ?? 8);
const OPEN = { tankLowCut: 10, tankHighCut: 20000, lowDecay: 1 };
for (const v of variants) {
  const plate = loadPlate(v, rate);
  console.log(`${v} @${rate}: T30/Decay - 1 (%) ; rows decay×size, cols depth ${depths.join(',')} (modRate ${modRate} for depth>0.35, else default)`);
  for (const decay of decays) {
    for (const size of sizes) {
      const row = [];
      for (const d of depths) {
        const settle = Math.round((0.5 * rate) / 128);
        const seconds = 1.5 * decay + 3.5;
        const p = { ...OPEN, decay, size, modDepth: d, ...(d > 0.35 ? { modRate } : {}), ...extra };
        const { L, R } = render(plate, seconds, impulseAt(settle), p);
        const from = settle * 128;
        const t = t30(L.subarray(from), R.subarray(from), rate);
        row.push(`${fmt((t / decay - 1) * 100, 1)}%`);
      }
      console.log(`  Decay ${decay}\tSize ${size}\t${row.join('\t')}`);
    }
  }
}
