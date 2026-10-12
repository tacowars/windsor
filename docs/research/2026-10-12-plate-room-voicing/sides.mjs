/* global process, console */
// windsor#763's side cells in each voicing (windsor#746): one click on L
// alone and one on R alone, Build 0 and 1, Size 0.25, 1 and 4, the default
// space; each side's lead over the other in the 0–50, 50–200 and 200–1000 ms
// windows, and the mirror (L alone's left over R alone's right), dB, beside
// `main`'s.
// node sides.mjs <new bundle> <main bundle> [rate]
import { loadPlate } from '../2026-10-12-plate-stereo-input/rig.mjs';
import { sideCell } from './voicingMeasures.mjs';

const [file, mainFile, rateArg = '48000'] = process.argv.slice(2);
const rate = Number(rateArg);
const plate = loadPlate(file, rate);
const main = loadPlate(mainFile, rate);
const f = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x));

console.log(`Side lead and mirror at ${rate} Hz, dB: main / plate / room\n`);
console.log('| Build | Size | L lead 0–50 | 50–200 | 200–1000 | R lead 0–50 | 50–200 | 200–1000 | mirror 0–50 | 50–200 | 200–1000 |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const build of [0, 1]) {
  for (const size of [0.25, 1, 4]) {
    const cells = [sideCell(main, 0, build, size), sideCell(plate, 0, build, size), sideCell(plate, 1, build, size)];
    const col = (key, w) => cells.map((c) => f(c[key][w])).join(' / ');
    console.log(
      `| ${build} | ${size} | ${[0, 1, 2].map((w) => col('leadL', w)).join(' | ')} | ` +
        `${[0, 1, 2].map((w) => col('leadR', w)).join(' | ')} | ${[0, 1, 2].map((w) => col('mirror', w)).join(' | ')} |`,
    );
  }
}
