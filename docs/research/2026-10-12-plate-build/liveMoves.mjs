/* global process, console */
// Build and HOLD moved with a tail ringing (windsor#761), judged by the
// no-step test of record `2026-08-31-dattorro-reverb-not-plateau` §3.
// Two inputs: a steady 220 Hz tone at 0.3, whose ceiling is its own slew at
// the render's peak times 3 (as `reverbProcessor.test.ts`); and a drum loop
// (a 0.4 s noise burst for the tail, then a kick every 0.5 s and a hat every
// 0.25 s), whose ceiling is the largest step of the same loop through the
// plate held still at Build 0, 0.25, 0.5, 0.75 and 1. Both are read from 1 s on,
// where the moves start, so the noise burst's own onset is not the measure.
// node liveMoves.mjs <bundle> [rate]
import { BLOCK, loadPlate, render } from './buildRig.mjs';

const [file, rateArg = '48000'] = process.argv.slice(2);
const rate = Number(rateArg);
const plate = loadPlate(file, rate);

const tone = (block, l, r) => {
  for (let i = 0; i < BLOCK; i++) {
    const t = (block * BLOCK + i) / rate;
    l[i] = r[i] = Math.sin(2 * Math.PI * 220 * t) * 0.3;
  }
};
let seed = 1;
const noise = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x80000000 - 1;
};
const drums = (block, l, r) => {
  for (let i = 0; i < BLOCK; i++) {
    const n = block * BLOCK + i;
    const t = n / rate;
    let v = t < 0.4 ? noise() * 0.5 : 0;
    const beat = t % 0.5;
    if (t >= 0.5) v += Math.sin(2 * Math.PI * 55 * beat) * Math.exp(-beat / 0.08) * 0.8;
    const eighth = t % 0.25;
    if (t >= 0.5 && eighth < 0.004) v += noise() * 0.4;
    l[i] = r[i] = v;
  }
};

/** Build from `from` at 1 s to `to` over `span` seconds, and back over the same. */
const sweep = (span, from, to) => (block, values) => {
  const t = (block * BLOCK) / rate - 1;
  const at = Math.min(Math.max(t, 0), 2 * span);
  values.build[0] = from + ((to - from) * (at < span ? at : 2 * span - at)) / span;
};
const step = (at, from, to) => (block, values) => {
  values.build[0] = (block * BLOCK) / rate < at ? from : to;
};
const hold = (on, off, build) => (block, values) => {
  const t = (block * BLOCK) / rate;
  values.hold[0] = t >= on && t < off ? 1 : 0;
  values.build[0] = build;
};

/** The largest sample-to-sample step in the left channel from 1 s on. */
const stepFrom1s = ({ L }) => {
  let m = 0;
  for (let i = rate + 1; i < L.length; i++) m = Math.max(m, Math.abs(L[i] - L[i - 1]));
  return m;
};

const peakOf = ({ L, R }) => {
  let p = 0;
  for (let i = 0; i < L.length; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
  return p;
};
const toneCeiling = (out) => ((2 * Math.PI * 220) / rate) * peakOf(out) * 3;

const cases = [
  ['Build 0 → 1 → 0 over 1 s each way', 4, sweep(1, 0, 1)],
  ['Build 0 → 1 → 0 over 4 s each way', 10, sweep(4, 0, 1)],
  ['Build 0 → 1 → 0 over 8 s each way', 18, sweep(8, 0, 1)],
  ['Build 0 → 1 in one block, and back', 4, (b, v) => step(2, 0, 1)(b, v) || ((b * BLOCK) / rate >= 3 && (v.build[0] = 0))],
  ['HOLD on 2 s to 4 s at Build 0', 6, hold(2, 4, 0)],
  ['HOLD on 2 s to 4 s at Build 1', 6, hold(2, 4, 1)],
];

const space = { decay: 3.35 };
const still = Math.max(
  ...[0, 0.25, 0.5, 0.75, 1].map((build) => {
    seed = 1;
    return stepFrom1s(render(plate, 18, { ...space, build }, { feed: drums, settle: 0 }));
  }),
);
console.log(`case\ttone step\ttone ceiling\tratio\tdrums step\tdrums ceiling (still)\tratio`);
for (const [name, seconds, automate] of cases) {
  const t = render(plate, seconds, space, { feed: tone, automate, settle: 0 });
  seed = 1;
  const d = render(plate, seconds, space, { feed: drums, automate, settle: 0 });
  d.maxStep = stepFrom1s(d);
  const ceiling = toneCeiling(t);
  console.log(
    [name, t.maxStep.toFixed(4), ceiling.toFixed(4), (t.maxStep / ceiling).toFixed(2), d.maxStep.toFixed(4), still.toFixed(4), (d.maxStep / still).toFixed(2)].join('\t'),
  );
  seed = 1;
}
