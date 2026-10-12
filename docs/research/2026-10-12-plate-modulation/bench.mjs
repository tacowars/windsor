/* global process, console */
// The plate's render cost per quantum: noise in at 0.25, sleep off, 48 kHz.
// node bench.mjs <variant: main|new> '<params json>' [rounds]
// The median of `rounds` runs of 20 000 quanta, after two warm-up runs.
import { BLOCK, loadPlate } from './rig.mjs';

const [variant, extra = '{}', roundsArg = '7'] = process.argv.slice(2);
const plate = loadPlate(variant, 48000);
const params = JSON.parse(extra);
const values = {};
for (const d of plate.descriptors) values[d.name] = new Float32Array([params[d.name] ?? d.defaultValue]);
const proc = new plate.Proc({ processorOptions: { sleep: false } });
const inL = new Float32Array(BLOCK);
const inR = new Float32Array(BLOCK);
const outL = new Float32Array(BLOCK);
const outR = new Float32Array(BLOCK);
let seed = 1;
const quanta = 20000;
const run = () => {
  for (let q = 0; q < quanta; q++) {
    for (let i = 0; i < BLOCK; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      inL[i] = inR[i] = (seed / 0x80000000 - 1) * 0.25;
    }
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
  `${variant} ${extra}: median ${times[times.length >> 1].toFixed(2)} us/quantum  min ${times[0].toFixed(2)}  max ${times.at(-1).toFixed(2)}`,
);
