/* global process, console */
// The onset of each space against Build (windsor#761), one click in.
// node onset.mjs <bundle> [rate] [builds, comma-separated; omit for a bundle without Build]
// Prints a TSV: rate, space, build, first arrival (ms), the loudest 10 ms
// window (ms), the time to the peak to within 1 dB (ms), energy in the first
// 20 and 100 ms, wet RMS over the first second (`buildRig.mjs`'s `onset`).
import { SPACES, loadPlate, onset, render } from './buildRig.mjs';

const [file, rateArg = '48000', buildsArg] = process.argv.slice(2);
const rate = Number(rateArg);
const plate = loadPlate(file, rate);
const builds = buildsArg ? buildsArg.split(',').map(Number) : [undefined];
console.log('rate\tspace\tbuild\tfirst ms\tloudest ms\tpeak ms\tE20\tE100\tRMS 1 s');
for (const [name, space] of Object.entries(SPACES)) {
  for (const build of builds) {
    const params = build === undefined ? space : { ...space, build };
    const preDelay = space.preDelay ?? 0;
    const o = onset(render(plate, 1.2 + preDelay, params), rate, preDelay);
    console.log(
      [
        rate,
        name,
        build ?? '-',
        o.firstMs.toFixed(2),
        o.peakMs.toFixed(0),
        o.riseMs.toFixed(0),
        o.e20.toFixed(4),
        o.e100.toFixed(4),
        o.rms1s.toExponential(3),
      ].join('\t'),
    );
  }
}
