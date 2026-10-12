/* global process, console */
// Broadband T30 against Decay over the Size and tank-diffusion grid
// (windsor#748): damping open (10 Hz, 20 kHz), lowDecay 1, modulation off.
// node sweepT30.mjs <bundle> <rate> [decays] [sizes] [diffusions]
import { grid, loadPlate, render, t30 } from './plateRig.mjs';

const TRIP = 0.725412453; // one trip round the tank at Size 1, in seconds
const [file, rate = '48000', d = '0.2,0.5,1,2,5,10,20', z = '0.05,0.25,1,2,4', f = '0,0.4,0.8'] =
  process.argv.slice(2);
const plate = loadPlate(file, Number(rate));
const list = (s) => s.split(',').map(Number);
console.log('decay\tsize\ttank1\ttank2\ttrip<D/4\tT30\terror%');
let worst = 0;
for (const [decay, size, t1, t2] of grid(list(d), list(z), list(f), list(f))) {
  const trip = TRIP * size;
  const seconds = 1.5 * decay + 2 * trip + 0.5;
  const params = {
    decay, size, diffusionTank1: t1, diffusionTank2: t2, tankLowCut: 10,
    tankHighCut: 20000, lowDecay: 1, modDepth: 0, wet: 1, dry: 0,
  };
  const { L, R } = render(plate, seconds, params);
  const value = t30(L, R, plate.sampleRate);
  const valid = trip < decay / 4;
  const error = value === null ? null : (value / decay - 1) * 100;
  if (valid && error !== null) worst = Math.max(worst, Math.abs(error));
  console.log(
    `${decay}\t${size}\t${t1}\t${t2}\t${valid ? 'yes' : 'no'}\t${value?.toFixed(3) ?? '-'}\t${error?.toFixed(1) ?? '-'}`,
  );
}
console.log(`worst |error| where one trip is under a quarter of Decay: ${worst.toFixed(1)} %`);
