/* global process, console */
// Today's broadband T30 of DEFAULT_SPACE and every SPACES row, on main's bundle.
import { loadPlate, render, t30 } from './plateRig.mjs';

const DEFAULT = {
  preDelay: 0, inputLowCut: 20, inputHighCut: 10000, diffusionIn1: 0.75, diffusionIn2: 0.625,
  size: 1, decay: 0.7, diffusionTank1: 0.7, diffusionTank2: 0.5, tankLowCut: 20,
  tankHighCut: 8000, modRate: 0.5, modDepth: 0.7,
};
const ROWS = {
  default: {},
  plate: { size: 0.5, decay: 0.62, preDelay: 0.005, inputLowCut: 100, inputHighCut: 12000, tankLowCut: 120, tankHighCut: 7000, modRate: 1, modDepth: 0.5 },
  room: { size: 0.28, decay: 0.45, preDelay: 0.008, inputLowCut: 120, inputHighCut: 11000, tankLowCut: 150, tankHighCut: 5500, modRate: 0.4, modDepth: 0.3 },
  hall: { size: 1.4, decay: 0.78, preDelay: 0.025, inputLowCut: 60, tankLowCut: 60, tankHighCut: 6500, modDepth: 0.8 },
  cathedral: { size: 3, decay: 0.9, preDelay: 0.05, inputLowCut: 45, inputHighCut: 8000, tankLowCut: 40, tankHighCut: 4200, modRate: 0.3, modDepth: 1.2 },
  wash: { size: 2.2, decay: 0.95, inputLowCut: 90, inputHighCut: 6000, tankLowCut: 200, tankHighCut: 5000, modRate: 1.6, modDepth: 2.5 },
  shimmer: { size: 0.7, decay: 0.85, preDelay: 0.012, inputLowCut: 200, inputHighCut: 16000, tankLowCut: 250, tankHighCut: 11000, modRate: 2.4, modDepth: 1.8 },
};

const [file, rate = '48000', extra = '{}'] = process.argv.slice(2);
const plate = loadPlate(file, Number(rate));
const override = JSON.parse(extra);
for (const [name, row] of Object.entries(ROWS)) {
  const params = { ...DEFAULT, ...row, ...(override[name] ?? {}), wet: 1, dry: 0 };
  let seconds = 20;
  let value = null;
  while (value === null && seconds <= 160) {
    const { L, R } = render(plate, seconds, params);
    value = t30(L, R, plate.sampleRate);
    if (value !== null && value * 1.2 > seconds) value = null;
    seconds *= 2;
  }
  console.log(`${name}\t${value?.toFixed(3)}`);
}
