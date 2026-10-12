/* global process, console, URL */
// The whole box (windsor#746), in both voicings and on `main`, at one rate.
// One click a cell after the settle; HOLD, when on, engages 0.1 s after the
// click and holds to the end.
//   input      centred (L = R), left (L alone)
//   size       0.05, 0.25, 1, 4
//   build      0, 0.5, 1
//   decay      0.2, 0.5, 2, 10, 60 s
//   hold       off, on
//   variant    the default space; all four diffusions (diffusionIn1,
//              diffusionIn2, diffusionTank1, diffusionTank2) at 0; all four
//              at 1; preDelay 1 s; modDepth 4 ms
// The tank diffusions' descriptor ceiling is 0.8 (`MAX_TANK_DIFFUSION`): a live
// AudioParam clamps 1 to 0.8, and the rig writes raw values, so 1 is read past
// the ceiling. Each row, per plate (`main`, plate voicing, room voicing): the
// wet L and R energy in 0–50 ms and 0–1000 ms after the pre-delay, the first
// arrival (ms to the first wet sample within 40 dB of the peak), the early
// density (both sides within 40 dB of the peak in the first 100 ms), the peak,
// non-finite samples, and under HOLD each side's energy over 2.0–2.5 s against
// 0.6–1.1 s. Writes `box<rate>.tsv` beside it and prints the summary the note
// tables.
// node box.mjs <new bundle> <main bundle> <rate>
import { writeFileSync } from 'node:fs';

import { BLOCK, CASES, clickAt, energy, loadPlate, render } from '../2026-10-12-plate-stereo-input/rig.mjs';

const [file, mainFile, rateArg = '48000'] = process.argv.slice(2);
const rate = Number(rateArg);
const bundles = { main: loadPlate(mainFile, rate), next: loadPlate(file, rate) };
const PLATES = [
  ['main', 'main', 0],
  ['plate', 'next', 0],
  ['room', 'next', 1],
];
const SETTLE = Math.round((0.5 * rate) / BLOCK);
const at = (ms) => Math.round((ms * rate) / 1000);
const DIFFUSIONS = ['diffusionIn1', 'diffusionIn2', 'diffusionTank1', 'diffusionTank2'];
const VARIANTS = {
  default: {},
  diffusion0: Object.fromEntries(DIFFUSIONS.map((d) => [d, 0])),
  diffusion1: Object.fromEntries(DIFFUSIONS.map((d) => [d, 1])),
  preDelay1: { preDelay: 1 },
  modDepth4: { modDepth: 4 },
};

function cell(plate, voicing, input, params) {
  const { hold, ...rest } = params;
  const pre = rest.preDelay ?? 0;
  const origin = SETTLE * BLOCK + at(pre * 1000);
  const holdBlock = Math.floor((SETTLE * BLOCK + at(100)) / BLOCK);
  const r = render(plate, 0.5 + pre + (hold ? 2.6 : 1.1), { ...rest, voicing }, {
    feed: clickAt(SETTLE, CASES[input]),
    automate: (b, values) => {
      values.hold[0] = hold && b >= holdBlock ? 1 : 0;
    },
  });
  let peak = 0;
  let nonFinite = 0;
  for (let i = 0; i < r.L.length; i++) {
    if (!Number.isFinite(r.L[i]) || !Number.isFinite(r.R[i])) nonFinite++;
    if (i >= origin && i < origin + rate) peak = Math.max(peak, Math.abs(r.L[i]), Math.abs(r.R[i]));
  }
  const floor = peak / 100;
  let first = -1;
  let dense = 0;
  for (let i = origin; i < origin + at(100); i++) {
    const l = Math.abs(r.L[i]) >= floor;
    const rr = Math.abs(r.R[i]) >= floor;
    if (first < 0 && (l || rr)) first = i - origin;
    dense += Number(l) + Number(rr);
  }
  const held = (x) => energy(x, origin + at(2000), origin + at(2500)) / energy(x, origin + at(600), origin + at(1100));
  return [
    energy(r.L, origin, origin + at(50)),
    energy(r.R, origin, origin + at(50)),
    energy(r.L, origin, origin + rate),
    energy(r.R, origin, origin + rate),
    first < 0 ? NaN : (first * 1000) / rate,
    dense,
    peak,
    nonFinite,
    hold ? held(r.L) : NaN,
    hold ? held(r.R) : NaN,
  ];
}

const FIELDS = ['l50', 'r50', 'l1', 'r1', 'firstMs', 'dense', 'peak', 'nonFinite', 'heldL', 'heldR'];
const GRID = {
  variant: Object.keys(VARIANTS),
  input: ['centred', 'left'],
  size: [0.05, 0.25, 1, 4],
  build: [0, 0.5, 1],
  decay: [0.2, 0.5, 2, 10, 60],
  hold: [0, 1],
};
const AXES = Object.keys(GRID);

function* cells(k = 0, at = {}) {
  if (k === AXES.length) {
    yield { ...at };
    return;
  }
  for (const v of GRID[AXES[k]]) yield* cells(k + 1, { ...at, [AXES[k]]: v });
}

const rows = [];
for (const at of cells()) {
  const { variant, input, ...rest } = at;
  const params = { ...VARIANTS[variant], ...rest };
  const out = {};
  for (const [name, bundle, voicing] of PLATES) out[name] = cell(bundles[bundle], voicing, input, params);
  rows.push({ ...at, out });
}

const head = ['variant', 'input', 'size', 'build', 'decay', 'hold'];
const lines = [[...head, ...PLATES.flatMap(([n]) => FIELDS.map((f) => `${n} ${f}`))].join('\t')];
for (const row of rows) {
  lines.push(
    [...head.map((h) => row[h]), ...PLATES.flatMap(([n]) => row.out[n].map((x) => (Number.isInteger(x) ? x : x.toExponential(4))))].join('\t'),
  );
}
writeFileSync(new URL(`box${rate / 1000}k.tsv`, import.meta.url), `${lines.join('\n')}\n`);

const dB = (a, b) => 10 * Math.log10(a / b);
const median = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];
const level = (o) => o[2] + o[3];
const sum = (name, pick) => rows.reduce((s, r) => s + pick(r.out[name], r), 0);
const report = {};
for (const [name] of PLATES) {
  report[`${name}: non-finite samples`] = sum(name, (o) => o[7]);
  report[`${name}: largest peak`] = Math.max(...rows.map((r) => r.out[name][6])).toFixed(3);
}
const live = rows.filter((r) => r.variant !== 'diffusion1');
report['plate − main, first second, median dB'] = median(rows.map((r) => dB(level(r.out.plate), level(r.out.main)))).toFixed(2);
report['plate − main, range inside the ceiling, dB'] = (() => {
  const d = live.map((r) => dB(level(r.out.plate), level(r.out.main)));
  return `${Math.min(...d).toFixed(2)} to ${Math.max(...d).toFixed(2)}`;
})();
report['room − plate, first second, median dB'] = median(rows.map((r) => dB(level(r.out.room), level(r.out.plate)))).toFixed(2);
report['room − plate, range inside the ceiling, dB'] = (() => {
  const d = live.map((r) => dB(level(r.out.room), level(r.out.plate)));
  return `${Math.min(...d).toFixed(2)} to ${Math.max(...d).toFixed(2)}`;
})();
const centred = rows.filter((r) => r.input === 'centred');
for (const name of ['main', 'plate', 'room']) {
  const off = centred.filter((r) => Math.abs(dB(r.out[name][2], r.out[name][3])) > 1.2);
  report[`${name}: centred |L/R| over 1.2 dB`] = `${off.length} of ${centred.length}`;
  const worst = live
    .filter((r) => r.input === 'centred')
    .reduce((w, r) => Math.max(w, Math.abs(dB(r.out[name][2], r.out[name][3]))), 0);
  report[`${name}: centred |L/R| worst inside the ceiling`] = `${worst.toFixed(2)} dB`;
}
const later = centred.filter((r) => r.out.plate[4] > r.out.main[4] + 1000 / rate);
report['plate: first arrival later than main, centred'] = `${later.length} of ${centred.length}`;
const lowE20 = centred.filter((r) => r.out.plate[0] + r.out.plate[1] < (r.out.main[0] + r.out.main[1]) * 0.999);
report['plate: 0–50 ms energy under main, centred'] = `${lowE20.length} of ${centred.length}`;
const left = rows.filter((r) => r.input === 'left');
for (const name of ['main', 'plate', 'room']) {
  const weak = left.filter((r) => dB(r.out[name][0], r.out[name][1]) < 3);
  report[`${name}: L alone leads under 3 dB in 0–50 ms`] = `${weak.length} of ${left.length}`;
}
// The room's first arrival against Size, every other setting held.
let grows = 0;
let groups = 0;
for (const r of rows.filter((x) => x.size === 0.05)) {
  const same = [0.25, 1, 4].map((size) =>
    rows.find((x) => x.size === size && ['variant', 'input', 'build', 'decay', 'hold'].every((k) => x[k] === r[k])),
  );
  const firsts = [r, ...same].map((x) => x.out.room[4]);
  groups++;
  if (firsts.every((f, i) => i === 0 || f > firsts[i - 1])) grows++;
}
report['room: first arrival grows with Size'] = `${grows} of ${groups}`;
const held = rows.filter((r) => r.hold === 1);
for (const name of ['main', 'plate', 'room']) {
  const least = Math.min(...held.flatMap((r) => [r.out[name][8], r.out[name][9]]));
  const leastLive = Math.min(...held.filter((r) => r.variant !== 'diffusion1').flatMap((r) => [r.out[name][8], r.out[name][9]]));
  report[`${name}: HOLD keeps, least`] = `${least.toFixed(2)} (${leastLive.toFixed(2)} inside the ceiling)`;
}
console.log(`The whole box at ${rate} Hz, ${rows.length} cells a plate\n`);
for (const [k, v] of Object.entries(report)) console.log(`| ${k} | ${v} |`);
