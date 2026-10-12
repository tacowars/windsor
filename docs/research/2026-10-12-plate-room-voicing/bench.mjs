/* global process, console */
// The plate's render cost per quantum (windsor#746): stereo noise in at 0.25,
// L and R apart, the default space, sleep off, at 48 kHz, as windsor#763's
// `bench.mjs` runs it. `mode` is `plate` or `room` (the voicing held), or
// `duck`, which flips the voicing every 6 quanta so the plate spends nearly
// every quantum ducking down or coming back up (at 48 kHz a duck is two quanta
// down and two up). `main`'s bundle ignores the voicing. Two warm-up runs,
// then the median of `rounds` runs of 20 000 quanta, in microseconds a
// quantum. `benchPage.html` runs the same loop on a page.
// node bench.mjs <bundle> [mode] [rounds]
import { BLOCK, loadPlate } from '../2026-10-12-plate-stereo-input/rig.mjs';

const [file, mode = 'plate', roundsArg = '7'] = process.argv.slice(2);
const plate = loadPlate(file, 48000);
const values = {};
for (const d of plate.descriptors) values[d.name] = new Float32Array([d.defaultValue]);
if (values.voicing) values.voicing[0] = mode === 'room' ? 1 : 0;
const proc = new plate.Processor({ processorOptions: { sleep: false } });
const inL = new Float32Array(BLOCK);
const inR = new Float32Array(BLOCK);
const outL = new Float32Array(BLOCK);
const outR = new Float32Array(BLOCK);
const FLIP = 6;
let seed = 1;
const quanta = 20000;
const run = () => {
  for (let q = 0; q < quanta; q++) {
    for (let i = 0; i < BLOCK; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      inL[i] = (seed / 0x80000000 - 1) * 0.25;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      inR[i] = (seed / 0x80000000 - 1) * 0.25;
    }
    if (mode === 'duck' && values.voicing && q % FLIP === 0) values.voicing[0] = 1 - values.voicing[0];
    outL.fill(0);
    outR.fill(0);
    proc.process([[inL, inR]], [[outL, outR]], values);
  }
};
run();
run();
const times = [];
for (let r = 0; r < Number(roundsArg); r++) {
  const t0 = process.hrtime.bigint();
  run();
  times.push(Number(process.hrtime.bigint() - t0) / quanta / 1000);
}
times.sort((a, b) => a - b);
console.log(
  `${mode}: median ${times[times.length >> 1].toFixed(2)} us/quantum  min ${times[0].toFixed(2)}  max ${times.at(-1).toFixed(2)}`,
);
