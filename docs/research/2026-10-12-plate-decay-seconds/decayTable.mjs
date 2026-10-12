/* global process, console */
// Measures reverbDecayTables.ts (windsor#748). Run against a bundle built with
// every factor 1, so the knob's Decay is the Decay the gains are cut from.
// For each (Size, Decay) cell where one trip round the tank is under a quarter
// of Decay, it finds the factor f with T30(Decay × f) = Decay by three (or,
// where those leave it more than 1 % off, more) fixed-point steps,
// f ← f × Decay / T30(Decay × f), each a fresh render: an impulse, damping
// open (10 Hz, 20 kHz), modulation off, the default diffusions, 48 kHz. A cell
// where the trip is longer holds the factor of the shortest measured Decay at
// its Size, and a factor under 1 is held at 1. Each impulse comes after 0.5 s
// at the asked Size: the plate starts at Size 1 and glides.
//
// Fix round 2 widened the Decay axis to 0.05–240 s, the low band's own
// targets (Decay × lowDecay). Two rules came with it, and neither touches a
// cell measured before:
// - The ceiling. With every gain at 1 the tank still loses a little on each
//   pass, so at each Size there is a longest T30 it can ring at all (73.9 s at
//   Size 0.05). It is measured the same way, with gains cut from a Decay of
//   10^6 s. A cell whose Decay is past CEILING_SHARE of it steps towards that
//   share of the ceiling instead of its Decay: its factor is the one that
//   rings within 1 % of 95 % of the longest the tank can, where the factor
//   still moves the T30 (past it, every doubling buys under 2 %).
// - The render's length is 1.5 × Decay × f, as before, but never past
//   1.5 × RENDER_CAP × the cell's goal, which only a ceiling cell reaches
//   (every factor measured before is under 6).
// node decayTable.mjs <bundle> [size,size,...]
// With sizes, only those rows are measured (to run the rows in parallel).
import { loadPlate, render, t30 } from './plateRig.mjs';

const TRIP = 0.725412453;
const SIZES = [0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 4];
const DECAYS = [
  0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10, 15, 20, 30, 40, 60, 80, 120, 180,
  240,
];
const STEPS = 3;
// Past three steps, a cell keeps stepping while its T30 misses its goal by
// more than TOLERANCE, up to MAX_STEPS: twelve on the 0.2–60 s axis measured
// before fix round 2, so the run reproduces it (every cell up to 20 s had
// converged in three), and LONG_MAX_STEPS on the columns past 60 s, where near
// the ceiling each step closes only a few percent of the gap.
const TOLERANCE = 0.01;
const MAX_STEPS = 12;
const LONG_MAX_STEPS = 40;
const LONG = 60;
const CEILING_SHARE = 0.95;
const RENDER_CAP = 6;
/** A Decay the gains are cut from that leaves every gain point 1 to within 10^-7. */
const OPEN_LOOP = 1e6;

const plate = loadPlate(process.argv[2], 48000);
const sizes = process.argv[3] ? process.argv[3].split(',').map(Number) : SIZES;
const t30At = (size, decay, seconds) => {
  const params = { decay, size, tankLowCut: 10, tankHighCut: 20000, lowDecay: 1, modDepth: 0, wet: 1, dry: 0 };
  const { L, R } = render(plate, seconds, params);
  return t30(L, R, plate.sampleRate);
};
const measure = (size, decay, f, goal) =>
  t30At(size, decay * f, 1.5 * Math.min(decay * f, RENDER_CAP * goal) + 2 * TRIP * size + 0.5);
// The ceiling binds only where it is under the axis's top over CEILING_SHARE;
// past that (or where the render never reaches −35 dB) it is Infinity.
const ceilingOf = (size) => {
  const top = DECAYS[DECAYS.length - 1] / CEILING_SHARE;
  const seconds = 1.5 * top + 2 * TRIP * size + 0.5;
  const value = t30At(size, OPEN_LOOP, seconds);
  return value === null || value > top ? Infinity : value;
};

const rows = [];
for (const size of sizes) {
  const ceiling = ceilingOf(size);
  const row = [];
  const notes = [];
  for (const decay of DECAYS) {
    if (TRIP * size >= decay / 4) {
      row.push(null);
      continue;
    }
    const goal = Math.min(decay, CEILING_SHARE * ceiling);
    const maxSteps = decay > LONG ? LONG_MAX_STEPS : MAX_STEPS;
    let f = 1;
    let t = 0;
    let s = 0;
    for (; s < maxSteps; s++) {
      t = measure(size, decay, f, goal);
      const ratio = goal / t;
      if (s >= STEPS && Math.abs(ratio - 1) < TOLERANCE) break;
      f *= ratio;
    }
    if (s === maxSteps) t = measure(size, decay, f, goal);
    // The tank's own passes only shorten its tail, so a factor under 1 says the
    // T30 is the input diffusers' ring (about 0.2 s, outside the loop), which
    // no factor steers: such a cell holds 1.
    row.push(Math.max(1, f));
    notes.push(
      `${decay}s: f ${f.toFixed(4)} T30 ${t.toFixed(3)} goal ${goal.toFixed(3)} steps ${s}` +
        (goal < decay ? ' CEILING' : '') +
        (s === maxSteps ? ' UNCONVERGED' : ''),
    );
  }
  const first = row.findIndex((v) => v !== null);
  for (let j = 0; j < first; j++) row[j] = row[first];
  rows.push({ size, ceiling, factors: row.map((v) => Number(v.toFixed(4))) });
  console.error(`Size ${size}, ceiling ${ceiling.toFixed(2)} s\n  ${notes.join('\n  ')}`);
}
console.log(JSON.stringify({ decays: DECAYS, rows }));
