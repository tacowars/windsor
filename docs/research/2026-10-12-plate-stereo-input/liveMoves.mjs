/* global process, console */
// Live moves under a stereo loop (windsor#763), the no-step test of record
// `2026-08-31-dattorro-reverb-not-plateau` §3: the largest sample-to-sample
// step on either side from 1 s on, while a parameter moves, against the
// largest step of the same loop through a still plate (Size 0.05 and 4,
// Build 0 and 1). The loop is `mixer/reverbStereo.test.ts`'s: a 0.4 s noise
// burst for a tail, a kick every 0.5 s on both sides (the right at 0.6), a
// hat every 0.25 s on the left and 60 ms later on the right. A ratio at or
// under 1 passes.
// node liveMoves.mjs <bundle> [rate]
import { BLOCK, loadPlate, render } from './rig.mjs';

const [file, rateArg = '48000'] = process.argv.slice(2);
const rate = Number(rateArg);
const plate = loadPlate(file, rate);

function stereoDrums() {
  let seed = 1;
  const noise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x80000000 - 1;
  };
  return (block, left, right) => {
    for (let i = 0; i < left.length; i++) {
      const t = (block * BLOCK + i) / rate;
      const beat = t % 0.5;
      const kick = t >= 0.5 ? Math.sin(2 * Math.PI * 55 * beat) * Math.exp(-beat / 0.08) * 0.8 : 0;
      const hat = t >= 0.5 && t % 0.25 < 0.004 ? noise() * 0.4 : 0;
      left[i] = (t < 0.4 ? noise() * 0.5 : 0) + kick + hat;
      right[i] =
        (t < 0.4 ? noise() * 0.3 : 0) +
        kick * 0.6 +
        (t >= 0.5 && (t - 0.06) % 0.25 < 0.004 ? noise() * 0.4 : 0);
    }
  };
}

function stepFrom1s(automate, seconds) {
  const r = render(plate, seconds, {}, { feed: stereoDrums(), automate });
  let step = 0;
  for (const x of [r.L, r.R]) {
    for (let i = rate + 1; i < x.length; i++) step = Math.max(step, Math.abs(x[i] - x[i - 1]));
  }
  return step;
}

const sweep = (name, from, to, span) => (block, values) => {
  const at = Math.min(Math.max((block * BLOCK) / rate - 1, 0), 2 * span);
  values[name][0] = from + ((to - from) * (at < span ? at : 2 * span - at)) / span;
};

const still = Math.max(
  ...[0.05, 4].flatMap((size) =>
    [0, 1].map((build) =>
      stepFrom1s((_, values) => {
        values.size[0] = size;
        values.build[0] = build;
      }, 18),
    ),
  ),
);
const moves = [
  ['Size 0.05 → 4 → 0.05, 1 s each way', sweep('size', 0.05, 4, 1), 4],
  ['Size 0.05 → 4 → 0.05, 8 s each way', sweep('size', 0.05, 4, 8), 18],
  ['Build 0 → 1 → 0, 1 s each way', sweep('build', 0, 1, 1), 4],
  ['Build 0 → 1 → 0, 8 s each way', sweep('build', 0, 1, 8), 18],
  [
    'HOLD on at 2 s, off at 4 s',
    (block, values) => {
      values.hold[0] = block >= Math.round((2 * rate) / BLOCK) && block < Math.round((4 * rate) / BLOCK) ? 1 : 0;
    },
    6,
  ],
];
console.log(`${rate} Hz, the still plate's largest step ${still.toFixed(4)}`);
console.log('| Move | largest step | against the still plate |');
console.log('|---|---|---|');
for (const [name, automate, seconds] of moves) {
  const step = stepFrom1s(automate, seconds);
  console.log(`| ${name} | ${step.toFixed(4)} | ${(step / still).toFixed(2)} |`);
}
