/* global process, console */
// Measures reverbDecayTables.ts (windsor#748). Run against a bundle built with
// every factor 1, so the knob's Decay is the Decay the gains are cut from.
// For each (Size, Decay) cell where one trip round the tank is under a quarter
// of Decay, it finds the factor f with T30(Decay × f) = Decay by three (or,
// where those leave it more than 1 % off, more) fixed-point steps, f ← f × Decay / T30(Decay × f), each a fresh render: an impulse, damping open (10 Hz, 20 kHz), modulation off, the
// default diffusions, 48 kHz. A cell where the trip is longer holds the factor
// of the shortest measured Decay at its Size, and a factor under 1 is held at
// 1. Each impulse comes after 0.5 s at the asked Size: the plate starts at
// Size 1 and glides.
// node decayTable.mjs <bundle>
import { loadPlate, render, t30 } from './plateRig.mjs';

const TRIP = 0.725412453;
const SIZES = [0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 4];
const DECAYS = [0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10, 15, 20, 30, 40, 60];
const STEPS = 3;
// Past three steps, a cell keeps stepping while its T30 misses Decay by more
// than TOLERANCE, up to MAX_STEPS. Near Decay 60 s at the smallest Sizes the
// tank's own per-pass loss is close to the whole decay and each step closes only
// about a third of the gap; every cell up to 20 s had converged in three.
const TOLERANCE = 0.01;
const MAX_STEPS = 12;

const plate = loadPlate(process.argv[2], 48000);
const measure = (size, decay) => {
  const seconds = 1.5 * decay + 2 * TRIP * size + 0.5;
  const params = { decay, size, tankLowCut: 10, tankHighCut: 20000, lowDecay: 1, modDepth: 0, wet: 1, dry: 0 };
  const { L, R } = render(plate, seconds, params);
  return t30(L, R, plate.sampleRate);
};

const factors = [];
for (const size of SIZES) {
  const row = [];
  for (const decay of DECAYS) {
    if (TRIP * size >= decay / 4) {
      row.push(null);
      continue;
    }
    let f = 1;
    for (let s = 0; s < MAX_STEPS; s++) {
      const ratio = decay / measure(size, decay * f);
      if (s >= STEPS && Math.abs(ratio - 1) < TOLERANCE) break;
      f *= ratio;
    }
    // The tank's own passes only shorten its tail, so a factor under 1 says the
    // T30 is the input diffusers' ring (about 0.2 s, outside the loop), which
    // no factor steers: such a cell holds 1.
    row.push(Math.max(1, f));
  }
  const first = row.findIndex((v) => v !== null);
  for (let j = 0; j < first; j++) row[j] = row[first];
  factors.push(row.map((v) => Number(v.toFixed(4))));
  console.error(size, row.map((v) => v.toFixed(3)).join(' '));
}
console.log(JSON.stringify({ sizes: SIZES, decays: DECAYS, factors }));
