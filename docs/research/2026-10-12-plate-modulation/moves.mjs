/* global process, console */
// Live moves: the no-step test (tone slew x3, and drum loop vs still plate).
import { loadPlate, render, fmt } from './rig.mjs';
const variant = process.argv[2] ?? 'new';
const rate = Number(process.argv[3] ?? 48000);
const plate = loadPlate(variant, rate);
const SR = rate, BLOCK = 128;

const tone = (b, l, r) => {
  for (let i = 0; i < BLOCK; i++) l[i] = r[i] = Math.sin((2 * Math.PI * 220 * (b * BLOCK + i)) / SR) * 0.3;
};
function drums() {
  let seed = 1;
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 0x80000000 - 1);
  return (b, l, r) => {
    for (let i = 0; i < BLOCK; i++) {
      const t = (b * BLOCK + i) / SR;
      const beat = t % 0.5;
      let v = t < 0.4 ? noise() * 0.5 : 0;
      if (t >= 0.5) v += Math.sin(2 * Math.PI * 55 * beat) * Math.exp(-beat / 0.08) * 0.8;
      if (t >= 0.5 && t % 0.25 < 0.004) v += noise() * 0.4;
      l[i] = r[i] = v;
    }
  };
}
/** param from lo at 1 s to hi over span s and back. */
const sweep = (name, lo, hi, span, fixed = {}) => (b, values) => {
  const t = (b * BLOCK) / SR;
  const at = Math.min(Math.max(t - 1, 0), 2 * span);
  const x = at < span ? at / span : (2 * span - at) / span;
  values[name][0] = lo + (hi - lo) * x;
  for (const [k, v] of Object.entries(fixed)) values[k][0] = v;
};
const still = (fixed) => (b, values) => { for (const [k, v] of Object.entries(fixed)) values[k][0] = v; };

function stepFrom1s(feed, automate, seconds) {
  const { L } = render(plate, seconds, feed, {}, automate);
  let step = 0, peak = 0;
  for (let i = SR + 1; i < L.length; i++) step = Math.max(step, Math.abs(L[i] - L[i - 1]));
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]));
  return { step, peak };
}

const moves = [
  ['depth 0-4 1s', sweep('modDepth', 0, 4, 1, { modRate: 8 }), 4, [{ modDepth: 0, modRate: 8 }, { modDepth: 4, modRate: 8 }]],
  ['depth 0-4 8s', sweep('modDepth', 0, 4, 8, { modRate: 8 }), 18, [{ modDepth: 0, modRate: 8 }, { modDepth: 4, modRate: 8 }]],
  ['rate 0-8 1s', sweep('modRate', 0, 8, 1, { modDepth: 4 }), 4, [{ modDepth: 4, modRate: 0 }, { modDepth: 4, modRate: 8 }]],
  ['rate 0-8 8s', sweep('modRate', 0, 8, 8, { modDepth: 4 }), 18, [{ modDepth: 4, modRate: 0 }, { modDepth: 4, modRate: 8 }]],
  ['size .05-4 8s deep', sweep('size', 0.05, 4, 8, { modDepth: 4, modRate: 8 }), 18, [{ size: 0.05, modDepth: 4, modRate: 8 }, { size: 4, modDepth: 4, modRate: 8 }]],
];
for (const [name, automate, seconds, ends] of moves) {
  const t = stepFrom1s(tone, automate, seconds);
  const ceiling = ((2 * Math.PI * 220) / SR) * t.peak * 3;
  const d = stepFrom1s(drums(), automate, seconds);
  const stillStep = Math.max(...ends.map((e) => stepFrom1s(drums(), still(e), seconds).step));
  console.log(
    `${name}: tone step ${fmt(t.step, 4)} / ceiling ${fmt(ceiling, 4)} (${fmt(t.step / ceiling, 2)}) | drums ${fmt(d.step, 4)} / still ${fmt(stillStep, 4)} (${fmt(d.step / stillStep, 3)})`,
  );
}
