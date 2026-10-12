/* global process, console */
// Wet level and peak of a fed tone at small Sizes, deep modulation.
import { loadPlate, render, sine, fmt } from './rig.mjs';
const [variant, size, rate, depth, hz, build] = process.argv.slice(2).map((v, i) => (i ? Number(v) : v));
const plate = loadPlate(variant, 48000);
let seed = 7;
const noise = (b, l, r) => { for (let i = 0; i < 128; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; l[i] = r[i] = (seed / 0x80000000 - 1) * 0.3; } };
const { L, R } = render(plate, 4, hz ? sine(hz, 0.3) : noise, { size, modRate: rate, modDepth: depth, build, tankLowCut: 10, tankHighCut: 20000, decay: 10 });
const out = [];
for (let t = 0; t < 4; t += 0.5) {
  let e = 0, pk = 0;
  for (let i = t * 48000; i < (t + 0.5) * 48000; i++) { e += L[i] ** 2 + R[i] ** 2; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
  out.push(`${t}s rms ${fmt(Math.sqrt(e / 48000), 3)} pk ${fmt(pk, 2)}`);
}
console.log(`${variant} size ${size} ${rate}Hz ${depth}ms ${hz}Hz build ${build}: ` + out.join(' | '));
