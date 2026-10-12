/* global process, console */
// The box's corners (windsor#748): Decay 0.2 and 60, lowDecay 0.25 and 4,
// Size 0.05 and 4, both tank diffusions 0 and 0.8, lowCross 80 Hz and 10 kHz,
// HOLD off and on. A 1 s noise burst; damping open, modulation at its default.
// HOLD off: the level 3 × the longest RT60 after the burst against the first
// second's peak (both as 128-sample RMS). HOLD on from 1.5 s to 11.5 s: the
// RMS over the hold's last second against its second second (a held tank
// neither grows nor dies), then released, the level 3 × the longest RT60 later.
// node corners.mjs <bundle> <rate>
import { BLOCK, grid, loadPlate, render } from './plateRig.mjs';

const [file, rate = '48000'] = process.argv.slice(2);
const plate = loadPlate(file, Number(rate));
const fs = plate.sampleRate;
let seed = 7;
const noise = (block, l, r) => {
  if (block * BLOCK >= fs) return;
  for (let i = 0; i < BLOCK; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    l[i] = r[i] = (seed / 0x80000000 - 1) * 0.5;
  }
};
const rms = (L, R, a, b) => {
  let s = 0;
  const from = Math.floor(a * fs);
  const to = Math.min(L.length, Math.floor(b * fs));
  for (let i = from; i < to; i++) s += L[i] * L[i] + R[i] * R[i];
  return Math.sqrt(s / Math.max(1, 2 * (to - from)));
};
const peakRms = (L, R, a, b) => {
  let p = 0;
  for (let t = a; t < b; t += BLOCK / fs) p = Math.max(p, rms(L, R, t, t + BLOCK / fs));
  return p;
};
const db = (x) => (20 * Math.log10(x)).toFixed(0);
console.log('decay\tlowDecay\tsize\ttank\tlowCross\thold\tresult');
const corners = grid([0.2, 60], [0.25, 4], [0.05, 4], [0, 0.8], [80, 10000], [false, true]);
for (const [decay, lowDecay, size, tank, lowCross, hold] of corners) {
    const longest = decay * Math.max(1, lowDecay);
    const params = {
      decay, lowDecay, size, lowCross, diffusionTank1: tank, diffusionTank2: tank,
      tankLowCut: 10, tankHighCut: 20000, wet: 1, dry: 0,
    };
    const release = 11.5;
    const end = (hold ? release : 1) + 3 * longest + 0.5;
    const at = (s) => Math.round((s * fs) / BLOCK);
    seed = 7;
    // The largest gain point outside HOLD, and the low band's gain at DC on it
    // (the shelf's largest), read before each block: every one under 1 means
    // no loop round the tank gains, since the all-passes and damping never do.
    let largest = 0;
    let wasHeld = false;
    const { L, R } = render(plate, end, params, {
      feed: noise,
      automate: (b, v, proc) => {
        const held = hold && b >= at(1.5) && b < at(release);
        v.hold[0] = held ? 1 : 0;
        if (!held && !wasHeld) {
          for (let p = 0; p < proc._gain.length; p++) {
            largest = Math.max(largest, proc._gain[p], proc._gain[p] + proc._lowExtra[p]);
          }
        }
        wasHeld = held;
      },
    });
    const first = peakRms(L, R, 0, 1);
    const tailAt = (hold ? release : 1) + 3 * longest;
    const tail = rms(L, R, tailAt, tailAt + 0.1);
    const finite = L.every(Number.isFinite) && R.every(Number.isFinite);
    let result = `largest gain ${largest.toFixed(6)}; ${finite ? '' : 'NON-FINITE '}after 3×RT60 ${db(tail / first)} dB re first second's peak`;
    if (hold) {
      const early = rms(L, R, 2.5, 3.5);
      const late = rms(L, R, release - 1, release);
      result = `held: last second ${db(late / early)} dB re its second second; ${result}`;
    }
    console.log([decay, lowDecay, size, tank, lowCross, hold ? 'on' : 'off', result].join('\t'));
  }
