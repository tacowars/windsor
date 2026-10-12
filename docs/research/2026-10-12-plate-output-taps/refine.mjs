/* global process, console */
// Refines one optimised table's tap times (windsor#766). Each tap is captured
// at its time and at `alts` steps of `step` either side, all in one bank, so a
// hill climb can move any tap along its line as well as flip its sign or
// magnitude, still without rendering. A move is kept only if it leaves the
// table's structure as dealt: no tap crosses another in its half's arrival
// order (so the interleaving and the owners' lead zones hold), every guest
// stays outside LEAD_ZONE, each owner's first tap stays inside FIRST_BY, and
// taps on one line stay SPACING apart.
// node refine.mjs <new bundle> <tsv> <seed> <restart> [step seconds] [alts]
import { readFileSync } from 'node:fs';

import {
  arrival,
  FIRST_BY,
  HALVES,
  LEAD_ZONE,
  LONGEST_SHARE,
  SHORTEST,
  SPACING,
  TANK,
} from './candidates.mjs';
import { captureLayout } from './capture.mjs';
import { figures, figuresAt, MAIN, margins, score } from './optimise.mjs';

const [file, tsv, seedArg, restartArg, stepArg = '0.002', altsArg = '2'] = process.argv.slice(2);
const row = readFileSync(tsv, 'utf8')
  .split('\n')
  .map((l) => l.split('\t'))
  .find((r) => r[0] === seedArg && r[1] === restartArg);
const table = JSON.parse(row.at(-1));
const step = Number(stepArg);
const alts = Number(altsArg);
const taps = table.line.length;
const perSide = table.perSide;

const halfOf = (line) => HALVES.find((h) => h.lines.includes(line));
const sideOf = (t) => (t < perSide ? 0 : 1);

// The bank: each tap at its time and at alts steps either side, where its line allows.
const bank = [];
const choices = [];
for (let t = 0; t < taps; t++) {
  const options = [];
  for (let k = -alts; k <= alts; k++) {
    const time = Number((table.time[t] + k * step).toFixed(6));
    if (time < SHORTEST || time > TANK[table.line[t]] * LONGEST_SHARE) continue;
    options.push({ time, row: bank.length });
    bank.push({ line: table.line[t], time });
  }
  choices.push(options);
}
const layout = {
  perSide: choices.slice(0, perSide).reduce((s, o) => s + o.length, 0),
  time: bank.map((b) => b.time),
  line: bank.map((b) => b.line),
};
console.error(`bank of ${bank.length} taps`);
const cap = captureLayout(file, layout);
const mainCap = captureLayout(file, MAIN);
const base = figures(mainCap, MAIN.gain, MAIN.perSide, null, MAIN.trim);

/** Whether the times at `pick` keep the table's structure (see the header). */
function valid(pick) {
  const time = pick.map((p, t) => choices[t][p].time);
  for (const half of HALVES) {
    const slots = [];
    for (let t = 0; t < taps; t++) {
      if (halfOf(table.line[t]) !== half) continue;
      const index = half.lines.indexOf(table.line[t]);
      slots.push({ t, at: arrival(half, index, time[t]), was: arrival(half, index, table.time[t]) });
      if (sideOf(t) !== half.owner && slots.at(-1).at < LEAD_ZONE) return false;
    }
    const now = [...slots].sort((a, b) => a.at - b.at).map((s) => s.t);
    const then = [...slots].sort((a, b) => a.was - b.was).map((s) => s.t);
    if (now.some((t, i) => t !== then[i])) return false;
    const first = slots.filter((s) => table.line[s.t] === half.lines[0] && sideOf(s.t) === half.owner);
    if (Math.min(...first.map((s) => time[s.t])) > FIRST_BY) return false;
  }
  for (let a = 0; a < taps; a++) {
    for (let b = a + 1; b < taps; b++) {
      if (table.line[a] === table.line[b] && Math.abs(time[a] - time[b]) < SPACING) return false;
    }
  }
  return true;
}

function evaluate(pick, gains) {
  const n = bank.length + 2;
  const vL = new Float64Array(n);
  const vR = new Float64Array(n);
  for (let t = 0; t < taps; t++) (sideOf(t) === 0 ? vL : vR)[choices[t][pick[t]].row] = gains[t];
  vL[n - 2] = 1;
  vR[n - 1] = 1;
  const fig = figuresAt(cap, vL, vR, base);
  return { fig, ...margins(fig, base, gains, perSide, table.line) };
}

let pick = choices.map((options, t) => options.findIndex((o) => o.time === Number(table.time[t].toFixed(6))));
let gains = Float64Array.from(table.gain);
let best = evaluate(pick, gains);
console.error(`start: least ${best.least.toFixed(2)} ${JSON.stringify(best.m)} t30 ${JSON.stringify(best.fig.t30)} main t30 ${JSON.stringify(base.t30)}`);
for (;;) {
  let move = null;
  for (let t = 0; t < taps; t++) {
    const tries = [];
    for (let p = 0; p < choices[t].length; p++) if (p !== pick[t]) tries.push({ p, g: gains[t] });
    tries.push({ p: pick[t], g: -gains[t] });
    tries.push({ p: pick[t], g: Math.sign(gains[t]) * (Math.abs(gains[t]) === 1 ? 0.75 : 1) });
    for (const { p, g } of tries) {
      const nextPick = pick.slice();
      nextPick[t] = p;
      if (p !== pick[t] && !valid(nextPick)) continue;
      const nextGains = Float64Array.from(gains);
      nextGains[t] = g;
      const r = evaluate(nextPick, nextGains);
      if (score(r) > score(move?.r ?? best) + 1e-9) move = { pick: nextPick, gains: nextGains, r };
    }
  }
  if (!move) break;
  ({ pick, gains } = move);
  best = move.r;
  console.error(`least ${best.least.toFixed(2)} gain ${best.gain.toFixed(3)} ${JSON.stringify(best.m)}`);
}
const out = {
  perSide,
  time: pick.map((p, t) => choices[t][p].time),
  line: table.line,
  gain: [...gains],
  trim: Number(best.fig.trim.toFixed(4)),
};
console.log([seedArg, restartArg, best.least.toFixed(2), best.gain.toFixed(3), JSON.stringify(best.m), JSON.stringify(out)].join('\t'));
