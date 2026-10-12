/* global process, console */
// The plate voicing's input diffusers (windsor#746), chosen by measurement.
// Each set is read for windsor#763's cells at Build 0 and Size 0.25, 1 and 4,
// at 48 and 44.1 kHz (`voicingMeasures.mjs`'s `sideCell`): each side's lead
// on its own click in the first 50 ms, and the mirror (L alone's left over R
// alone's right) in the 0–50, 50–200 and 200–1000 ms windows.
// - **Feasible:** every lead at least 3 dB and every mirror at Size 0.25 and
//   1 within 1 dB, each with 0.05 dB to spare (`mixer/reverbStereo.test.ts`'s
//   bounds), and the held 1 kHz sine beating under −18.5 dB at 48 kHz
//   (`mixer/reverbModulationSpread.test.ts`).
// - **Ranked** by the worst mirror at Size 4, which no set under 2 ms holds to
//   the test's 1.25 dB (the note's "The plate voicing's diffusers").
// Phase 1 draws `draws` sets: L's four lengths between 0.25 and 1.5 ms, so the
// longest stays well under 2 ms, and each of R's its L counterpart times 0.85
// to 0.97 or 1.03 to 1.15, as windsor#763 drew its right chain. Phase 2 climbs
// from the best feasible draw for `steps` steps, each moving one length by up
// to 12 % within the same bounds, kept when it stays feasible and lowers the
// worst Size 4 mirror. Prints every feasible set, then the best.
// node plateSearch.mjs <new bundle> [draws] [steps] [seed]
import { loadVoicing } from './voicingRig.mjs';
import { heldBeat, sideCell } from './voicingMeasures.mjs';

const [file, drawsArg = '400', stepsArg = '160', seedArg = '746'] = process.argv.slice(2);
const SHORTEST = 0.00025;
const LONGEST = 0.0015;
const SPARE = 0.05;
let seed = Number(seedArg);
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const round = (s) => +s.toFixed(6);
const clamp = (s) => round(Math.min(LONGEST, Math.max(SHORTEST, s)));
const tableOf = (lengths) => ({ plateInput: lengths.slice(0, 4), plateInputRight: lengths.slice(4) });

function draw() {
  const left = [0, 1, 2, 3].map(() => clamp(SHORTEST + random() * (LONGEST - SHORTEST)));
  const right = left.map((s) => {
    const off = 0.03 + random() * 0.12;
    return clamp(s * (random() < 0.5 ? 1 - off : 1 + off));
  });
  return [...left, ...right];
}

/** The least margin over the bounds at Size 0.25 and 1 and every lead, and the worst Size 4 mirror. */
function sides(lengths, rate) {
  const plate = loadVoicing(file, rate, tableOf(lengths));
  let margin = Infinity;
  let large = 0;
  for (const size of [0.25, 1, 4]) {
    const cell = sideCell(plate, 0, 0, size);
    margin = Math.min(margin, cell.leadL[0] - 3, cell.leadR[0] - 3);
    for (const m of cell.mirror) {
      if (size === 4) large = Math.max(large, Math.abs(m));
      else margin = Math.min(margin, 1 - Math.abs(m));
    }
  }
  return { margin, large };
}

/** The worst Size 4 mirror at both rates if the set is feasible, else Infinity. */
function rank(lengths) {
  const at48 = sides(lengths, 48000);
  if (at48.margin < SPARE) return { large: Infinity };
  const at44 = sides(lengths, 44100);
  if (at44.margin < SPARE) return { large: Infinity };
  const beat = heldBeat(loadVoicing(file, 48000, tableOf(lengths)), 0);
  if (beat > -18.5 - SPARE) return { large: Infinity };
  return { large: Math.max(at48.large, at44.large), margin: Math.min(at48.margin, at44.margin), beat };
}

const show = (label, lengths, r) =>
  console.log(
    `${label} size4 ${r.large.toFixed(2)} margin ${r.margin.toFixed(3)} beat ${r.beat.toFixed(2)} ` +
      `L ${lengths.slice(0, 4).join(',')} R ${lengths.slice(4).join(',')}`,
  );

let best = null;
let bestRank = { large: Infinity };
for (let n = 0; n < Number(drawsArg); n++) {
  const lengths = draw();
  const r = rank(lengths);
  if (r.large === Infinity) continue;
  show(`draw ${n}`, lengths, r);
  if (r.large < bestRank.large) [best, bestRank] = [lengths, r];
}
if (!best) throw new Error('no feasible draw');
for (let step = 0; step < Number(stepsArg); step++) {
  const next = [...best];
  const k = Math.floor(random() * next.length);
  next[k] = clamp(next[k] * (1 + (random() * 2 - 1) * 0.12));
  const r = rank(next);
  if (r.large >= bestRank.large) continue;
  [best, bestRank] = [next, r];
  show(`step ${step}`, best, r);
}
show('best', best, bestRank);
