/* global process, console */
// The room voicing's input diffusers (windsor#746), chosen by measurement.
// Each set draws every one of the eight lengths (L's four, then R's) at 0.85
// to 1.15 of the length its line held before windsor#746 (Dattorro's four
// proportions on L, windsor#763's right chain on R), so the room's diffusers
// sit around today's lengths; they scale with Size's square root. Each is read
// in the room voicing for windsor#763's cells at Build 0 and Size 0.25, 1 and
// 4, at 48 and 44.1 kHz (each side's lead on its own click in the first
// 50 ms at least 3 dB; the mirror within 1 dB, 1.25 at Size 4:
// `mixer/reverbStereo.test.ts`'s bounds), its early density at Size 1, Build 0
// under the plate voicing's (`voicingRig.mjs`'s `onset`), and the T30 of Decay
// 0.5 s at Size 1 and 2 s at Size 4, damping open, within 10 %. The least
// margin over every bound ranks them (dB for the cells, tenths of a percent
// point for the T30s). Prints each set that passes, then the best.
// node roomSearch.mjs <new bundle> [count] [seed]
import { clickT30 } from '../2026-10-12-plate-stereo-input/measure.mjs';
import { loadVoicing, onset } from './voicingRig.mjs';
import { sideCell } from './voicingMeasures.mjs';

const [file, countArg = '120', seedArg = '746'] = process.argv.slice(2);
const BEFORE = [
  0.004771345, 0.003595309, 0.012734787, 0.009307483, 0.005312, 0.003825, 0.011459, 0.008022,
];
const OPEN = { tankLowCut: 10, tankHighCut: 20000, modDepth: 0, lowDecay: 1 };
let seed = Number(seedArg);
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const round = (s) => +s.toFixed(6);
const tableOf = (l) => ({ roomInput: l.slice(0, 4), roomInputRight: l.slice(4) });

function margin(lengths) {
  let worst = Infinity;
  for (const rate of [48000, 44100]) {
    const plate = loadVoicing(file, rate, tableOf(lengths));
    for (const size of [0.25, 1, 4]) {
      const cell = sideCell(plate, 1, 0, size);
      worst = Math.min(worst, cell.leadL[0] - 3, cell.leadR[0] - 3);
      for (const m of cell.mirror) worst = Math.min(worst, (size === 4 ? 1.25 : 1) - Math.abs(m));
    }
  }
  const plate = loadVoicing(file, 48000, tableOf(lengths));
  const density = onset(plate, { build: 0, voicing: 0 }).density - onset(plate, { build: 0, voicing: 1 }).density;
  if (density <= 0) return -Infinity;
  for (const [decay, size] of [
    [0.5, 1],
    [2, 4],
  ]) {
    const t = clickT30(plate, { ...OPEN, decay, size, voicing: 1 }, 'centred', 1.5 * decay + 3) / decay - 1;
    worst = Math.min(worst, (0.1 - Math.abs(t)) * 10);
  }
  return worst;
}

let best = { margin: margin(BEFORE), lengths: BEFORE };
console.log(`today's lengths: ${best.margin.toFixed(3)}`);
best = { margin: -Infinity, lengths: null };
for (let n = 0; n < Number(countArg); n++) {
  const lengths = BEFORE.map((s) => round(s * (0.85 + random() * 0.3)));
  const m = margin(lengths);
  if (m < 0) continue;
  console.log(`${n} margin ${m.toFixed(3)} L ${lengths.slice(0, 4).join(',')} R ${lengths.slice(4).join(',')}`);
  if (m > best.margin) best = { margin: m, lengths };
}
console.log('best', JSON.stringify(best));
