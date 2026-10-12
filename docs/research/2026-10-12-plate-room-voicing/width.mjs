/* global process, console */
// Width and the mono sum (windsor#746): 10 s of centred noise in the default
// space at Size 0.25, 1 and 4, Build 0.1 (the default), on `main` and in each
// voicing. Balance is wet L over R; the mono sum is (L + R) / 2, its RMS
// against `main`'s, and the lowest of its third-octave bands from 100 Hz to
// 10 kHz against `main`'s same band; correlation is the wet L/R Pearson.
// node width.mjs <new bundle> <main bundle> [rate]
import { loadPlate } from '../2026-10-12-plate-stereo-input/rig.mjs';
import { THIRDS } from '../2026-10-12-plate-stereo-input/measure.mjs';
import { mono } from './voicingMeasures.mjs';

const [file, mainFile, rateArg = '48000'] = process.argv.slice(2);
const rate = Number(rateArg);
const plate = loadPlate(file, rate);
const main = loadPlate(mainFile, rate);
const db = (x) => 20 * Math.log10(x);
const f = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;

console.log(`Centred noise at ${rate} Hz, the default space\n`);
console.log('| Size | voicing | balance dB | mono − main dB | lowest band − main dB (Hz) | correlation |');
console.log('|---|---|---|---|---|---|');
for (const size of [0.25, 1, 4]) {
  const m = mono(main, 0, { size });
  console.log(`| ${size} | main | ${f(m.balance)} | — | — | ${m.corr.toFixed(4)} |`);
  for (const [name, voicing] of [['plate', 0], ['room', 1]]) {
    const v = mono(plate, voicing, { size });
    let lowest = Infinity;
    let at = 0;
    v.bands.forEach((e, i) => {
      const gap = 10 * Math.log10(e / m.bands[i]);
      if (gap < lowest) [lowest, at] = [gap, THIRDS[i]];
    });
    console.log(
      `| ${size} | ${name} | ${f(v.balance)} | ${f(db(v.rms / m.rms))} | ${f(lowest)} (${at}) | ${v.corr.toFixed(4)} |`,
    );
  }
}
