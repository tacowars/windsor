/* global process, console */
// Build in each voicing (windsor#746): one centred click in the default space
// at Size 1, Build 0 to 1 in steps of 0.25, the time to the wet envelope's
// peak (windsor#761's reading: the first 10 ms window within 1 dB of the
// peak, each averaged with two either side), the first arrival and the early
// density (`voicingRig.mjs`'s `onset`).
// node build.mjs <new bundle> [rate] [size]
import { loadPlate } from '../2026-10-12-plate-stereo-input/rig.mjs';
import { riseMs } from '../2026-10-12-plate-stereo-input/measure.mjs';
import { onset } from './voicingRig.mjs';

const [file, rateArg = '48000', sizeArg = '1'] = process.argv.slice(2);
const plate = loadPlate(file, Number(rateArg));
const size = Number(sizeArg);
console.log(`Build at ${rateArg} Hz, Size ${size}, a centred click in the default space\n`);
console.log('| Build | plate: rise ms | first ms | density | room: rise ms | first ms | density |');
console.log('|---|---|---|---|---|---|---|');
for (const build of [0, 0.25, 0.5, 0.75, 1]) {
  const cells = [0, 1].map((voicing) => {
    const o = onset(plate, { build, size, voicing });
    return `${riseMs(plate, { build, size, voicing })} | ${o.firstMs.toFixed(2)} | ${o.density}`;
  });
  console.log(`| ${build} | ${cells.join(' | ')} |`);
}
