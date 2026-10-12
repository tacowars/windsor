/* global process, console */
// T30 against Decay (windsor#746): one centred click, damping open and the
// modulation off as `mixer/reverbDecay.test.ts` measures Decay, at
// Decay 0.5, 2 and 10 s and Size 0.25, 1 and 4, Build 0, 0.1 and 1, in each
// voicing of the new bundle and on `main`, as a percentage off Decay.
// node t30.mjs <new bundle> <main bundle> [rate]
import { clickT30 } from '../2026-10-12-plate-stereo-input/measure.mjs';
import { loadPlate } from '../2026-10-12-plate-stereo-input/rig.mjs';

const [file, mainFile, rateArg = '48000'] = process.argv.slice(2);
const rate = Number(rateArg);
const plate = loadPlate(file, rate);
const main = loadPlate(mainFile, rate);
/** Damping open and modulation off: the conditions Decay is measured in. */
const OPEN = { tankLowCut: 10, tankHighCut: 20000, modDepth: 0, lowDecay: 1 };
const f = (x) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}` : 'n/a');

console.log(`T30 off Decay at ${rate} Hz, %, a centred click, damping open, modulation off\n`);
console.log('| Decay | Size | Build | main | plate | room |');
console.log('|---|---|---|---|---|---|');
for (const decay of [0.5, 2, 10]) {
  for (const size of [0.25, 1, 4]) {
    for (const build of [0, 0.1, 1]) {
      const seconds = 1.5 * decay + 3;
      const params = { ...OPEN, decay, size, build };
      const read = (p, voicing) => clickT30(p, { ...params, voicing }, 'centred', seconds) / decay - 1;
      console.log(`| ${decay} | ${size} | ${build} | ${f(read(main, 0))} | ${f(read(plate, 0))} | ${f(read(plate, 1))} |`);
    }
  }
}
