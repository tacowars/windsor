/* global process, console */
// Where the Size sweep's largest step is, and whether it stands out from the
// samples around it (a discontinuity) or not (Doppler-raised content).
import { BLOCK, loadPlate, render } from './plateRig.mjs';

const [file, extra = '{}'] = process.argv.slice(2);
const plate = loadPlate(file, 48000);
const fs = 48000;
const tone = (block, l, r) => {
  for (let i = 0; i < BLOCK; i++) l[i] = r[i] = Math.sin((2 * Math.PI * 220 * (block * BLOCK + i)) / fs) * 0.3;
};
const { L } = render(plate, 7, { size: 0.05, ...JSON.parse(extra) }, {
  feed: tone,
  automate: (b, v) => {
    const t = (b * BLOCK) / fs;
    v.size[0] = t < 1 ? 0.05 : t < 3 ? 0.05 + ((t - 1) / 2) * 3.95 : t < 5 ? 4 - ((t - 3) / 2) * 3.95 : 0.05;
  },
});
const d = new Float64Array(L.length);
for (let i = 1; i < L.length; i++) d[i] = Math.abs(L[i] - L[i - 1]);
const order = [...d.keys()].filter((i) => i > 5 * BLOCK).sort((a, b) => d[b] - d[a]).slice(0, 5);
for (const i of order) {
  let s = 0;
  let n = 0;
  for (let k = i - 64; k <= i + 64; k++) if (k !== i) { s += d[k] * d[k]; n++; }
  const local = Math.sqrt(s / n);
  console.log(`t ${(i / fs).toFixed(4)} s  sample-in-quantum ${i % BLOCK}  step ${d[i].toFixed(4)}  local rms step ${local.toFixed(4)}  ratio ${(d[i] / local).toFixed(2)}`);
}
// Mean zero-crossing rate of L in 0.25 s windows: the content's pitch.
for (let t = 0.5; t < 7; t += 0.5) {
  let z = 0;
  const a = Math.floor(t * fs);
  for (let i = a + 1; i < a + fs * 0.25; i++) if ((L[i] >= 0) !== (L[i - 1] >= 0)) z++;
  process.stdout.write(`${t}:${Math.round(z * 2)}Hz `);
}
console.log();
