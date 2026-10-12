/* global process, console */
// The tail's length against Build (windsor#761): broadband T30 of one click
// at Decay 2 and 10 s, Size 0.25, 1 and 4, Build 0, 0.5 and 1, with the
// damping open and the modulation off (the conditions
// `mixer/reverbDecay.test.ts` measures Decay in). Prints a TSV.
// node t30.mjs <bundle> [rate]
import { loadPlate, render, t30 } from './buildRig.mjs';

const [file, rateArg = '48000'] = process.argv.slice(2);
const rate = Number(rateArg);
const plate = loadPlate(file, rate);
const OPEN = { tankLowCut: 10, tankHighCut: 20000, modDepth: 0 };
console.log('decay\tsize\tbuild\tT30 s\terror %');
for (const decay of [2, 10]) {
  for (const size of [0.25, 1, 4]) {
    for (const build of [0, 0.5, 1]) {
      const { L, R } = render(plate, 1.5 * decay + 3, { ...OPEN, decay, size, build });
      const measured = t30(L, R, rate);
      console.log(
        [decay, size, build, measured.toFixed(3), ((measured / decay - 1) * 100).toFixed(1)].join('\t'),
      );
    }
  }
}
