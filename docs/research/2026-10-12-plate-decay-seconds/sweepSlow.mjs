/* global process, console, URL */
// The Size sweep 0.05 -> 4 -> 0.05 at three speeds, against the no-step ceiling.
import { BLOCK, loadPlate, render } from './plateRig.mjs';

const plate = loadPlate(new URL('./' + process.argv[2], import.meta.url).pathname, 48000);
const fs = 48000;
const tone = (block, l, r) => {
  for (let i = 0; i < BLOCK; i++) l[i] = r[i] = Math.sin((2 * Math.PI * 220 * (block * BLOCK + i)) / fs) * 0.3;
};
for (const span of [2, 4, 8]) {
  for (const lowDecay of [1, 0.25, 4]) {
    const { L, R } = render(plate, 2 * span + 2, { size: 0.05, lowDecay }, {
      feed: tone,
      automate: (b, v) => {
        const t = (b * BLOCK) / fs;
        v.size[0] =
          t < 1 ? 0.05 : t < 1 + span ? 0.05 + ((t - 1) / span) * 3.95
            : t < 1 + 2 * span ? 4 - ((t - 1 - span) / span) * 3.95 : 0.05;
      },
    });
    let peak = 0;
    let step = 0;
    for (let i = 0; i < L.length; i++) {
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      if (i > 640) step = Math.max(step, Math.abs(L[i] - L[i - 1]));
    }
    const ceiling = ((2 * Math.PI * 220) / fs) * peak * 3;
    console.log(`span ${span} s, lowDecay ${lowDecay}: step ${step.toFixed(4)}  ceiling ${ceiling.toFixed(4)}  ${step < ceiling ? 'pass' : 'FAIL'}`);
  }
}
