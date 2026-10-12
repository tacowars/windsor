/* global process, console */
// The Size sweep of `mixer/reverbLowBand.test.ts` (0.05 to 4 and back over
// 8 s each way, a steady 220 Hz tone in) at each Build (windsor#761): the
// largest sample-to-sample step against the no-step ceiling, the tone's
// slew at the render's peak times 3.
// node sizeSweep.mjs <bundle> [lowDecay] [builds, comma-separated; omit for a bundle without Build]
import { BLOCK, loadPlate, render } from './buildRig.mjs';

const [file, lowDecayArg = '1', buildsArg] = process.argv.slice(2);
const rate = 48000;
const plate = loadPlate(file, rate);
const span = 8;
const tone = (block, l, r) => {
  for (let i = 0; i < BLOCK; i++) {
    const t = (block * BLOCK + i) / rate;
    l[i] = r[i] = Math.sin(2 * Math.PI * 220 * t) * 0.3;
  }
};
const size = (block) => {
  const t = (block * BLOCK) / rate - 1;
  const at = Math.min(Math.max(t, 0), 2 * span);
  return 0.05 + (3.95 * (at < span ? at : 2 * span - at)) / span;
};
for (const b of buildsArg ? buildsArg.split(',').map(Number) : [undefined]) {
  const params = { size: 0.05, lowDecay: Number(lowDecayArg) };
  if (b !== undefined) params.build = b;
  const { L, R, maxStep } = render(plate, 2 * span + 2, params, {
    feed: tone,
    automate: (block, values) => {
      values.size[0] = size(block);
    },
  });
  let peak = 0;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const ceiling = ((2 * Math.PI * 220) / rate) * peak * 3;
  console.log(`build ${b ?? '-'}\tstep ${maxStep.toFixed(4)}\tceiling ${ceiling.toFixed(4)}\tratio ${(maxStep / ceiling).toFixed(3)}`);
}
