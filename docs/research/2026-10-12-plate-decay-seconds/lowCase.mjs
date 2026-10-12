/* global process, console */
// One case of the low band against its own targets (windsor#748, fix round 2):
// the octave band three octaves below lowCross against Decay × lowDecay, and
// three octaves above (where it is under 0.45 × the rate) against Decay and
// against the same band at lowDecay 1. An impulse after half a second,
// damping open, modulation off.
// node lowCase.mjs <bundle> <size> <decay> <lowDecay> <lowCross> [rate]
import { loadPlate, octave, render, t30 } from './plateRig.mjs';

const [file, size, decay, lowDecay, lowCross, rate = '48000'] = process.argv.slice(2);
const fs = Number(rate);
const plate = loadPlate(file, fs);
const band = (ld, fc) => {
  const params = {
    size: +size,
    decay: +decay,
    lowDecay: ld,
    lowCross: +lowCross,
    tankLowCut: 10,
    tankHighCut: 20000,
    modDepth: 0,
    wet: 1,
    dry: 0,
  };
  const { L, R } = render(plate, 1.5 * decay * Math.max(1, ld) + 2, params);
  return t30(octave(L, fc, fs), octave(R, fc, fs), fs);
};
const pct = (value, want) => `${((value / want - 1) * 100).toFixed(1)} %`;
const lo = lowCross / 8;
const hi = lowCross * 8;
const low = band(+lowDecay, lo);
console.log(`low ${lo} Hz: ${low?.toFixed(2)} s against ${decay * lowDecay} (${pct(low, decay * lowDecay)})`);
if (hi < fs * 0.45) {
  const high = band(+lowDecay, hi);
  const neutral = band(1, hi);
  console.log(
    `high ${hi} Hz: ${high?.toFixed(2)} s against ${decay} (${pct(high, decay)}), ` +
      `at lowDecay 1 ${neutral?.toFixed(2)} (${pct(high, neutral)})`,
  );
}
