/* global process, console */
// The largest gain point, and the low band's gain at DC on it (the shelf's
// largest), over 58 Sizes from 0.05 to 4, at Decay 60 × lowDecay 4, 60 × 1
// and 0.2 × 0.25, outside HOLD, lowCross 10 kHz (windsor#748, fix round 2).
// node gainSweep.mjs <bundle>
import { loadPlate, render } from './plateRig.mjs';

const plate = loadPlate(process.argv[2], 48000);
let overall = { gain: 0 };
for (const [decay, lowDecay] of [
  [60, 4],
  [60, 1],
  [0.2, 0.25],
]) {
  for (let size = 0.05; size <= 4.0001; size *= 1.08) {
    let largest = 0;
    const params = { decay, lowDecay, size, lowCross: 10000, tankLowCut: 10, tankHighCut: 20000 };
    render(plate, 1, params, {
      settle: 1,
      automate: (_block, _values, proc) => {
        for (let p = 0; p < proc._gain.length; p++) {
          largest = Math.max(largest, proc._gain[p], proc._gain[p] + proc._lowExtra[p]);
        }
      },
    });
    if (largest > overall.gain) overall = { gain: largest, decay, lowDecay, size };
  }
}
console.log(JSON.stringify(overall), `1 − largest = ${1 - overall.gain}`);
