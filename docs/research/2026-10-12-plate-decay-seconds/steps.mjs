/* global process, console */
// No-step checks (windsor#748), as the Size-sweep test measures them: a steady
// 220 Hz tone at 0.3 into the plate, a move made with the tail ringing, and
// the largest left-channel sample-to-sample step after the first 5 quanta
// against the tone's own slew at the render's peak, times 3.
// node steps.mjs <bundle> <rate>
import { BLOCK, loadPlate, render } from './plateRig.mjs';

const [file, rate = '48000'] = process.argv.slice(2);
const plate = loadPlate(file, Number(rate));
const fs = plate.sampleRate;
const HZ = 220;
const tone = (block, l, r) => {
  for (let i = 0; i < BLOCK; i++) l[i] = r[i] = Math.sin((2 * Math.PI * HZ * (block * BLOCK + i)) / fs) * 0.3;
};
const at = (s) => Math.round((s * fs) / BLOCK);
const ceilingOf = (peak) => ((2 * Math.PI * HZ) / fs) * peak * 3;

function check(name, params, automate, seconds = 6) {
  const { L, R } = render(plate, seconds, params, { feed: tone, automate });
  let peak = 0;
  let step = 0;
  for (let i = 0; i < L.length; i++) {
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    if (i > 5 * BLOCK) step = Math.max(step, Math.abs(L[i] - L[i - 1]));
  }
  const ceiling = ceilingOf(peak);
  console.log(`${name}\tstep ${step.toFixed(4)}\tceiling ${ceiling.toFixed(4)}\t${step < ceiling ? 'pass' : 'FAIL'}\tpeak ${peak.toFixed(3)}`);
}

for (const lowDecay of [0.25, 1, 4]) {
  check(`HOLD on at 2 s, off at 4 s, lowDecay ${lowDecay}`, { lowDecay }, (b, v) => {
    v.hold[0] = b >= at(2) && b < at(4) ? 1 : 0;
  });
}
for (const lowDecay of [0.25, 4]) {
  check(`lowDecay 1 -> ${lowDecay} at 2 s, back at 4 s`, {}, (b, v) => {
    if (v.lowDecay) v.lowDecay[0] = b >= at(2) && b < at(4) ? lowDecay : 1;
  });
}
check('Size 0.05 -> 4 over 2 s and back over 2 s', { size: 0.05 }, (b, v) => {
  const t = (b * BLOCK) / fs;
  v.size[0] = t < 1 ? 0.05 : t < 3 ? 0.05 + ((t - 1) / 2) * 3.95 : t < 5 ? 4 - ((t - 3) / 2) * 3.95 : 0.05;
}, 7);
check('Decay 0.2 -> 60 at 2 s, back at 4 s', { decay: 0.2 }, (b, v) => {
  v.decay[0] = b >= at(2) && b < at(4) ? 60 : 0.2;
});
check('Decay 60 -> 0.2 at 2 s, back at 4 s', { decay: 60 }, (b, v) => {
  v.decay[0] = b >= at(2) && b < at(4) ? 0.2 : 60;
});
check('lowDecay 4, Decay 0.2 -> 60 at 2 s, back at 4 s', { decay: 0.2, lowDecay: 4 }, (b, v) => {
  v.decay[0] = b >= at(2) && b < at(4) ? 60 : 0.2;
});
for (const lowDecay of [0.25, 1, 4]) {
  check(`Decay 60, HOLD on at 2 s, off at 4 s, lowDecay ${lowDecay}`, { decay: 60, lowDecay }, (b, v) => {
    v.hold[0] = b >= at(2) && b < at(4) ? 1 : 0;
  });
}
check('lowDecay 0.25, Size 0.05 -> 4 and back', { size: 0.05, lowDecay: 0.25 }, (b, v) => {
  const t = (b * BLOCK) / fs;
  v.size[0] = t < 1 ? 0.05 : t < 3 ? 0.05 + ((t - 1) / 2) * 3.95 : t < 5 ? 4 - ((t - 3) / 2) * 3.95 : 0.05;
}, 7);
check('steady, defaults', {}, undefined);
