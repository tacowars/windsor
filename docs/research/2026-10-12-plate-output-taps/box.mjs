/* global process, console, URL */
// The whole box (windsor#766): every control the output taps interact with,
// over its range, with each input case, at one rate, through the new plate
// and `main` side by side. One click per cell after the settle; HOLD, when
// on, engages 0.1 s after the click and holds to the end.
//   input           centred (L = R), left, right, anti (L = −R)
//   size            0.05, 0.25, 1, 4
//   build           0, 1
//   diffusionTank1  0, 0.5, 0.8, 1
//   diffusionTank2  0, 0.5, 0.8, 1
//   decay           0.2, 10, 60 s
//   hold            off, on
// The tank diffusions' descriptor ceiling is 0.8 (`MAX_TANK_DIFFUSION`), so a
// live AudioParam clamps 1 to 0.8; the rig writes raw values, so 1 is read
// past the ceiling, as the issue asks. Each cell's row, per plate: the wet L
// and R energy in 0–50 ms and 0–1000 ms, the early density (centred only),
// the peak, the count of non-finite samples, and under HOLD each side's
// energy over 2.0–2.5 s against 0.6–1.1 s. Writes every row to
// `box<rate>.tsv` beside it and prints the summary the note tables.
// node box.mjs <new bundle> <main bundle> <rate>
import { writeFileSync } from 'node:fs';

import { BLOCK, CASES, clickAt, db, energy, loadPlate, render } from '../2026-10-12-plate-stereo-input/rig.mjs';

const [file, mainFile, rateArg = '48000'] = process.argv.slice(2);
const rate = Number(rateArg);
const plates = { new: loadPlate(file, rate), main: loadPlate(mainFile, rate) };
const SETTLE = Math.round((0.5 * rate) / BLOCK);
const ms = (t) => Math.round((t * rate) / 1000);

const INPUTS = ['centred', 'left', 'right', 'anti'];
const GRID = {
  size: [0.05, 0.25, 1, 4],
  build: [0, 1],
  diffusionTank1: [0, 0.5, 0.8, 1],
  diffusionTank2: [0, 0.5, 0.8, 1],
  decay: [0.2, 10, 60],
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

function cell(plate, input, params) {
  const { hold, ...rest } = params;
  const origin = SETTLE * BLOCK;
  const holdBlock = Math.floor((origin + ms(100)) / BLOCK);
  const r = render(plate, 0.5 + (hold ? 2.6 : 1.1), rest, {
    feed: clickAt(SETTLE, CASES[input]),
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
  let first = 0;
  for (let i = origin; i < origin + rate; i++) first = Math.max(first, Math.abs(r.L[i]), Math.abs(r.R[i]));
  let dense = 0;
  for (let i = origin; i < origin + ms(100); i++) {
    if (Math.abs(r.L[i]) >= first / 100) dense++;
    if (Math.abs(r.R[i]) >= first / 100) dense++;
  }
  const e = (x, a, b) => energy(x, origin + ms(a), origin + ms(b));
  return {
    l50: e(r.L, 0, 50),
    r50: e(r.R, 0, 50),
    l1: e(r.L, 0, 1000),
    r1: e(r.R, 0, 1000),
    dense,
    peak,
    nonFinite,
    heldL: hold ? e(r.L, 2000, 2500) / e(r.L, 600, 1100) : NaN,
    heldR: hold ? e(r.R, 2000, 2500) / e(r.R, 600, 1100) : NaN,
  };
}

const KEYS = ['l50', 'r50', 'l1', 'r1', 'dense', 'peak', 'nonFinite', 'heldL', 'heldR'];
const rows = [];
const lines = [
  ['input', ...NAMES, ...KEYS.map((k) => `new ${k}`), ...KEYS.map((k) => `main ${k}`)].join('\t'),
];
for (const input of INPUTS) {
  for (const params of cells()) {
    const n = cell(plates.new, input, params);
    const m = cell(plates.main, input, params);
    rows.push({ input, params, n, m });
    lines.push(
      [input, ...NAMES.map((k) => params[k]), ...KEYS.map((k) => n[k]), ...KEYS.map((k) => m[k])]
        .map((v) => (typeof v === 'number' && !Number.isInteger(v) ? v.toExponential(4) : v))
        .join('\t'),
    );
  }
}
writeFileSync(new URL(`./box${Math.round(rate / 100) / 10}k.tsv`, import.meta.url), `${lines.join('\n')}\n`);

const where = (row) => `${row.input}; ${NAMES.map((k) => `${k} ${row.params[k]}`).join(', ')}`;
const worst = (list, key) => list.reduce((a, b) => (b[key] < a[key] ? b : a));
console.log(`\n${rate} Hz: ${rows.length} cells a plate`);
for (const p of ['n', 'm']) {
  const loud = rows.reduce((a, b) => (b[p].peak > a[p].peak ? b : a));
  console.log(
    `${p === 'n' ? 'new' : 'main'}: non-finite samples ${rows.reduce((s, r) => s + r[p].nonFinite, 0)}; largest peak ${loud[p].peak.toFixed(3)} (${where(loud)})`,
  );
}
{
  const level = rows
    .filter((r) => r.m.l1 + r.m.r1 > 1e-12)
    .map((r) => ({ ...r, d: db((r.n.l1 + r.n.r1) / (r.m.l1 + r.m.r1)) }));
  for (const input of INPUTS) {
    const mine = level.filter((r) => r.input === input).map((r) => r.d).sort((a, b) => a - b);
    console.log(
      `level, ${input}: new − main over the first second, dB: least ${mine[0].toFixed(2)}, median ${mine[mine.length >> 1].toFixed(2)}, most ${mine.at(-1).toFixed(2)}`,
    );
  }
}
{
  const centred = rows.filter((r) => r.input === 'centred');
  const fewer = centred.filter((r) => !(r.n.dense > r.m.dense));
  console.log(`early density, centred: new not above main in ${fewer.length} of ${centred.length}`);
  for (const r of fewer.slice(0, 16)) console.log(`  ${r.n.dense} against ${r.m.dense}: ${where(r)}`);
  const bal = centred.map((r) => ({ r, b: Math.abs(db(r.n.l1 / r.n.r1)), was: Math.abs(db(r.m.l1 / r.m.r1)) }));
  const w = bal.reduce((a, b) => (b.b > a.b ? b : a));
  console.log(
    `centred: worst |L/R| over the first second ${w.b.toFixed(2)} dB (main there ${w.was.toFixed(2)}); over 1 dB in ${bal.filter((x) => x.b > 1).length} of ${bal.length} (main ${bal.filter((x) => x.was > 1).length})`,
  );
}
for (const [key, span] of [
  ['50', '0–50 ms'],
  ['1', '0–1000 ms'],
]) {
  const leads = rows
    .filter((r) => r.input === 'left' || r.input === 'right')
    .map((r) => {
      const fed = r.input === 'left' ? ['l', 'r'] : ['r', 'l'];
      const lead = (x) => db(x[`${fed[0]}${key}`] / x[`${fed[1]}${key}`]);
      return { ...r, now: lead(r.n), was: lead(r.m) };
    })
    .filter((r) => r.n[`l${key}`] + r.n[`r${key}`] > 1e-12);
  const finite = leads.filter((r) => r.was < 300);
  const lost = leads.filter((r) => r.was >= 300 && r.now < 300);
  const worse = finite.filter((r) => r.now < r.was - 0.5);
  const d = finite.map((r) => ({ ...r, gap: r.now - r.was }));
  const least = d.length ? worst(d, 'gap') : null;
  console.log(
    `lead ${span}, one side fed: worse than main by over 0.5 dB in ${worse.length} of ${finite.length}; ` +
      `silent on main and heard now in ${lost.length}; least new − main ${least ? least.gap.toFixed(2) : '—'} dB${least ? ` (${where(least)})` : ''}`,
  );
  for (const r of worse.slice(0, 16)) console.log(`  ${r.was.toFixed(2)} → ${r.now.toFixed(2)}: ${where(r)}`);
}
{
  const anti = rows.filter((r) => r.input === 'anti');
  const centred = new Map(rows.filter((r) => r.input === 'centred').map((r) => [where({ ...r, input: '' }), r]));
  const rel = anti.map((r) => {
    const c = centred.get(where({ ...r, input: '' }));
    return { ...r, d: db((r.n.l1 + r.n.r1) / (c.n.l1 + c.n.r1)) };
  });
  const quiet = worst(rel, 'd');
  console.log(`anti: least against L = R ${quiet.d.toFixed(1)} dB (${where(quiet)})`);
}
{
  const held = rows
    .filter((r) => r.params.hold === 1)
    .map((r) => ({ ...r, keep: Math.min(r.n.heldL, r.n.heldR), was: Math.min(r.m.heldL, r.m.heldR) }));
  const least = worst(held, 'keep');
  const weaker = held.filter((r) => r.keep < r.was * 0.9);
  console.log(
    `HOLD: least a side keeps at 2 s ${least.keep.toFixed(3)} (main there ${least.was.toFixed(3)}; ${where(least)}); under 0.9 of main's in ${weaker.length} of ${held.length}`,
  );
  for (const r of weaker.slice(0, 16)) console.log(`  ${r.keep.toFixed(3)} against ${r.was.toFixed(3)}: ${where(r)}`);
}
