/* global process, console */
// Level (windsor#746): one centred click's wet RMS over its first second
// (both sides), in the default space at Build 0, 0.1, 0.5 and 1, on `main`
// and in each voicing; the plate voicing against `main` and the room against
// the plate, dB; and the room trim that would put the room's mean in dB over
// Build 0, 0.5 and 1 on the plate's.
// node level.mjs <new bundle> <main bundle> [rate] [size]
import { loadPlate } from '../2026-10-12-plate-stereo-input/rig.mjs';
import { centred } from './voicingMeasures.mjs';

const [file, mainFile, rateArg = '48000', sizeArg = '1'] = process.argv.slice(2);
const rate = Number(rateArg);
const size = Number(sizeArg);
const plate = loadPlate(file, rate);
const main = loadPlate(mainFile, rate);
const db = (x) => 20 * Math.log10(x);
const f = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;

console.log(`Level of a centred click at ${rate} Hz, Size ${size}, the default space\n`);
console.log('| Build | main RMS | plate − main, dB | room − plate, dB | plate balance | room balance |');
console.log('|---|---|---|---|---|---|');
const gaps = [];
for (const build of [0, 0.1, 0.5, 1]) {
  const m = centred(main, 0, { build, size });
  const p = centred(plate, 0, { build, size });
  const r = centred(plate, 1, { build, size });
  if (build !== 0.1) gaps.push(db(r.rms / p.rms));
  console.log(
    `| ${build} | ${m.rms.toFixed(6)} | ${f(db(p.rms / m.rms))} | ${f(db(r.rms / p.rms))} | ${f(p.balance)} | ${f(r.balance)} |`,
  );
}
const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
console.log(`\nroom − plate, mean over Build 0, 0.5 and 1: ${f(mean)} dB; trim × ${(10 ** (-mean / 20)).toFixed(4)}`);
