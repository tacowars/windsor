/* global process, console */
// The onset of one centred click (windsor#746), in the default space at Size
// 0.05, 0.25, 1 and 4 and Build 0, 0.5 and 1: `main`, the plate voicing and
// the room voicing. The first arrival is the first wet sample within 40 dB of
// the wet peak (over the first second), after the pre-delay; the 20 ms
// energy sums both sides' squares over the first 20 ms; the early density
// counts wet samples, both sides, within 40 dB of the peak in the first
// 100 ms, as windsor#766 counted it.
// node onset.mjs <new bundle> <main bundle> [rate]
import { loadPlate } from '../2026-10-12-plate-stereo-input/rig.mjs';
import { onset } from './voicingRig.mjs';

const [file, mainFile, rateArg = '48000'] = process.argv.slice(2);
const rate = Number(rateArg);
const plate = loadPlate(file, rate);
const main = loadPlate(mainFile, rate);
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

console.log(`Onset of a centred click at ${rate} Hz, the default space\n`);
console.log(
  '| Size | Build | first ms: main | plate | room | 20 ms energy: main | plate | room | density: main | plate | room |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const size of [0.05, 0.25, 1, 4]) {
  for (const build of [0, 0.5, 1]) {
    const m = onset(main, { size, build });
    const p = onset(plate, { size, build, voicing: 0 });
    const r = onset(plate, { size, build, voicing: 1 });
    console.log(
      `| ${size} | ${build} | ${f(m.firstMs)} | ${f(p.firstMs)} | ${f(r.firstMs)} | ` +
        `${f(m.e20, 4)} | ${f(p.e20, 4)} | ${f(r.e20, 4)} | ${m.density} | ${p.density} | ${r.density} |`,
    );
  }
}
