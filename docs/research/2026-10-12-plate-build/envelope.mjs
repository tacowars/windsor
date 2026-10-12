/* global process, console */
// The wet envelope of one click, in 10 ms windows from the end of the
// pre-delay, in dB against its peak window (windsor#761).
// node envelope.mjs <bundle> <space> <builds, comma-separated> [ms]
import { SPACES, WINDOW, loadPlate, render } from './buildRig.mjs';

const [file, name, buildsArg, msArg = '400'] = process.argv.slice(2);
const rate = 48000;
const plate = loadPlate(file, rate);
const space = SPACES[name];
const preDelay = space.preDelay ?? 0;
const win = Math.round(WINDOW * rate);
const count = Math.round(Number(msArg) / (WINDOW * 1000));
for (const b of buildsArg.split(',')) {
  const params = b === '-' ? space : { ...space, build: Number(b) };
  const { L, R } = render(plate, preDelay + Number(msArg) / 1000 + 0.05, params);
  const from = Math.round(preDelay * rate);
  const e = [];
  for (let w = 0; w < count; w++) {
    let s = 0;
    for (let i = from + w * win; i < from + (w + 1) * win; i++) s += L[i] * L[i] + R[i] * R[i];
    e.push(s);
  }
  const peak = Math.max(...e);
  console.log(`${b}\t${e.map((v) => (10 * Math.log10(v / peak)).toFixed(0)).join(' ')}`);
}
