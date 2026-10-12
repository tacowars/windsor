/* global process, console, URL */
// The whole box (windsor#763): every interacting control over its range, with
// each input case, at one rate. One click per cell after the settle; HOLD,
// when on, engages 0.1 s after the pre-delay and holds to the end.
//   input        left, right, centred (L = R), anti (L = −R), one (a
//                one-channel input)
//   size         0.05, 0.25, 1, 4
//   build        0, 0.5, 1
//   diffusionIn1 0, 0.5, 1
//   diffusionIn2 0, 0.5, 1
//   preDelay     0, 1 s
//   decay        0.2, 60 s
//   hold         off, on
// Each cell's row: the wet L and R energy in 0–50 ms and 0–1000 ms from the
// pre-delay, the peak, the count of non-finite samples, and under HOLD each
// side's energy over 2.0–2.5 s against 0.6–1.1 s. Writes every row to
// `sweep<rate>.tsv` beside it and prints the summary the note tables.
// node sweep.mjs <bundle> <rate>
import { writeFileSync } from 'node:fs';
import { BLOCK, clickAt, CASES, db, energy, loadPlate, render } from './rig.mjs';

const [file, rateArg = '48000'] = process.argv.slice(2);
const rate = Number(rateArg);
const plate = loadPlate(file, rate);
const SETTLE = Math.round((0.5 * rate) / BLOCK);
const ms = (t) => Math.round((t * rate) / 1000);

const INPUTS = ['left', 'right', 'centred', 'anti', 'one'];
const GRID = {
  size: [0.05, 0.25, 1, 4],
  build: [0, 0.5, 1],
  diffusionIn1: [0, 0.5, 1],
  diffusionIn2: [0, 0.5, 1],
  preDelay: [0, 1],
  decay: [0.2, 60],
  hold: [0, 1],
};
const NAMES = Object.keys(GRID);

function* cells(k = 0, at = {}) {
  if (k === NAMES.length) {
    yield { ...at };
    return;
  }
  for (const v of GRID[NAMES[k]]) yield* cells(k + 1, { ...at, [NAMES[k]]: v });
}

function cell(input, params) {
  const { hold, ...rest } = params;
  const origin = SETTLE * BLOCK + Math.round(params.preDelay * rate);
  const holdBlock = Math.floor((origin + ms(100)) / BLOCK);
  const seconds = 0.5 + params.preDelay + (hold ? 2.6 : 1.1);
  const r = render(plate, seconds, rest, {
    feed: clickAt(SETTLE, input === 'one' ? CASES.left : CASES[input]),
    channels: input === 'one' ? 1 : 2,
    automate: (b, values) => {
      values.hold[0] = hold && b >= holdBlock ? 1 : 0;
    },
  });
  let peak = 0;
  let nonFinite = 0;
  for (let i = 0; i < r.L.length; i++) {
    if (!Number.isFinite(r.L[i]) || !Number.isFinite(r.R[i])) nonFinite++;
    else peak = Math.max(peak, Math.abs(r.L[i]), Math.abs(r.R[i]));
  }
  const e = (x, a, b) => energy(x, origin + ms(a), origin + ms(b));
  return {
    l50: e(r.L, 0, 50),
    r50: e(r.R, 0, 50),
    l1: e(r.L, 0, 1000),
    r1: e(r.R, 0, 1000),
    peak,
    nonFinite,
    heldL: hold ? e(r.L, 2000, 2500) / e(r.L, 600, 1100) : NaN,
    heldR: hold ? e(r.R, 2000, 2500) / e(r.R, 600, 1100) : NaN,
  };
}

const rows = [];
const lines = [`input\t${NAMES.join('\t')}\tl50\tr50\tl1\tr1\tpeak\tnonFinite\theldL\theldR`];
for (const input of INPUTS) {
  for (const params of cells()) {
    const m = cell(input, params);
    rows.push({ input, params, ...m });
    lines.push(
      [input, ...NAMES.map((n) => params[n]), m.l50, m.r50, m.l1, m.r1, m.peak, m.nonFinite, m.heldL, m.heldR]
        .map((v) => (typeof v === 'number' && !Number.isInteger(v) ? v.toExponential(4) : v))
        .join('\t'),
    );
  }
}
writeFileSync(new URL(`./sweep${Math.round(rate / 100) / 10}k.tsv`, import.meta.url), `${lines.join('\n')}\n`);

const where = (row) => NAMES.map((n) => `${n} ${row.params[n]}`).join(', ');
const fed = (row) => (row.input === 'right' ? [row.r50, row.l50] : [row.l50, row.r50]);
console.log(`\n${rate} Hz: ${rows.length} cells`);
console.log(`non-finite samples: ${rows.reduce((s, r) => s + r.nonFinite, 0)}`);
const loudest = rows.reduce((a, b) => (b.peak > a.peak ? b : a));
console.log(`largest peak: ${loudest.peak.toFixed(3)} (${loudest.input}; ${where(loudest)})`);

for (const input of ['left', 'right']) {
  const mine = rows.filter((r) => r.input === input);
  for (const build of GRID.build) {
    const leads = mine.filter((r) => r.params.build === build).map((r) => ({ r, lead: db(fed(r)[0] / fed(r)[1]) }));
    const short = leads.filter((x) => !(x.lead >= 3));
    const min = leads.reduce((a, b) => (b.lead < a.lead ? b : a));
    console.log(
      `${input} alone, Build ${build}: lead 0–50 ms under 3 dB in ${short.length} of ${leads.length}; least ${min.lead.toFixed(1)} dB (${where(min.r)})`,
    );
  }
}
for (const input of ['centred', 'one']) {
  const bal = rows.filter((r) => r.input === input).map((r) => ({ r, b: Math.abs(db(r.l1 / r.r1)) }));
  const over = bal.filter((x) => !(x.b <= 1));
  const worst = bal.reduce((a, b) => (b.b > a.b ? b : a));
  console.log(
    `${input}: |L/R| over the first second above 1 dB in ${over.length} of ${bal.length}; worst ${worst.b.toFixed(2)} dB (${where(worst.r)})`,
  );
  for (const x of over.slice(0, 12)) console.log(`  ${x.b.toFixed(2)} dB: ${where(x.r)}`);
}
{
  const anti = rows.filter((r) => r.input === 'anti');
  const centred = new Map(rows.filter((r) => r.input === 'centred').map((r) => [where(r), r]));
  const rel = anti.map((r) => {
    const c = centred.get(where(r));
    return { r, d: db((r.l1 + r.r1) / (c.l1 + c.r1)) };
  });
  const quiet = rel.reduce((a, b) => (b.d < a.d ? b : a));
  const silent = anti.filter((r) => !(r.l1 + r.r1 > 1e-12));
  console.log(
    `anti: silent in ${silent.length} of ${anti.length}; least against L = R ${quiet.d.toFixed(1)} dB (${where(quiet.r)})`,
  );
  for (const r of silent.slice(0, 12)) console.log(`  silent: ${where(r)}`);
}
{
  const held = rows.filter((r) => r.params.hold === 1);
  const weak = held.filter((r) => !(r.heldL >= 0.25 && r.heldR >= 0.25));
  const least = held.reduce((a, b) => (Math.min(b.heldL, b.heldR) < Math.min(a.heldL, a.heldR) ? b : a));
  console.log(
    `HOLD: a side under a quarter of its energy at 2 s in ${weak.length} of ${held.length}; least ${Math.min(least.heldL, least.heldR).toFixed(3)} (${least.input}; ${where(least)})`,
  );
  for (const r of weak.slice(0, 12)) console.log(`  ${r.input} L ${r.heldL.toFixed(3)} R ${r.heldR.toFixed(3)}: ${where(r)}`);
}
