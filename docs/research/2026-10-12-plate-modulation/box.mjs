/* global process, console */
// The whole-box sweep (windsor#764): modRate × modDepth × Size × Decay × build × HOLD × rate.
// HOLD off: an impulse after 0.5 s at the asked Size; T30 against Decay, peak, non-finite count.
// HOLD on: a 220 Hz tone for 2 s, HOLD from 1.9 s for 30 s; the wet level in 5 s windows
// (min and max re the first, from 3 s) and the tank's stored energy at 33 s re 3 s.
import { loadPlate, render, impulseAt, sine, t30, fmt } from './rig.mjs';
const variant = process.argv[2];
const rates = (process.argv[3] ?? '44100,48000').split(',').map(Number);
const holdOnly = process.env.HOLD_ONLY === '1';
const RATES = [0, 3, 8];
const DEPTHS = [0, 0.35, 4];
const SIZES = [0.05, 0.25, 1, 4];
const DECAYS = [0.2, 10, 60];
const BUILDS = [0, 1];

function tankEnergy(p) {
  let e = 0;
  for (let line = 4; line < 12; line++) {
    const buf = p._buffers[line];
    const mask = p._mask[line];
    const n = Math.floor(p._length[line]);
    for (let k = 1; k <= n; k++) e += buf[(p._write[line] - k) & mask] ** 2;
  }
  return e;
}

console.log('variant\trate\tmodRate\tmodDepth\tsize\tdecay\tbuild\thold\tT30err%\tpeak\tnonFinite\twetMinDb\twetMaxDb\ttankDb');
const cells = rates.flatMap((sr) =>
  RATES.flatMap((modRate) =>
    DEPTHS.flatMap((modDepth) =>
      SIZES.flatMap((size) =>
        DECAYS.flatMap((decay) => BUILDS.map((build) => ({ sr, modRate, modDepth, size, decay, build }))),
      ),
    ),
  ),
);

/** HOLD off: the impulse's T30 against Decay, the peak and any non-finite sample. */
function tail(plate, { sr, modRate, modDepth, size, decay, build }, base) {
  const settle = Math.round((0.5 * sr) / 128);
  const { L, R } = render(plate, Math.min(1.5 * decay + 4, 96), impulseAt(settle), base);
  let peak = 0;
  let bad = 0;
  for (let i = 0; i < L.length; i++) {
    if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) bad++;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const t = t30(L.subarray(settle * 128), R.subarray(settle * 128), sr);
  return [variant, sr, modRate, modDepth, size, decay, build, 0, fmt((t / decay - 1) * 100, 1), fmt(peak, 3), bad, '', '', ''];
}

/** HOLD on: the held 220 Hz tone's wet level in 5 s windows, and the tank's energy at 33 s re 3 s. */
function held(plate, { sr, modRate, modDepth, size, build }, base) {
  const blockAt = (s) => Math.round((s * sr) / 128);
  const energies = [];
  const { L, R } = render(plate, 33, sine(220, 0.3, 2), base, (b, values, p) => {
    values.hold[0] = b >= blockAt(1.9) ? 1 : 0;
    if (b === blockAt(3) || b === blockAt(33) - 1) energies.push(tankEnergy(p));
  });
  let bad = 0;
  let peak = 0;
  for (let i = 0; i < L.length; i++) {
    if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) bad++;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const levels = [];
  for (let t = 3; t + 5 <= 33; t += 5) {
    let e = 0;
    for (let i = t * sr; i < (t + 5) * sr; i++) e += L[i] ** 2 + R[i] ** 2;
    levels.push(10 * Math.log10(e / (5 * sr)));
  }
  const rel = levels.map((l) => l - levels[0]);
  const tank = 10 * Math.log10(energies[1] / energies[0]);
  return [variant, sr, modRate, modDepth, size, '-', build, 1, '', fmt(peak, 3), bad, fmt(Math.min(...rel), 2), fmt(Math.max(...rel), 2), fmt(tank, 2)];
}

for (const cell of cells) {
  const plate = loadPlate(variant, cell.sr);
  const base = { modRate: cell.modRate, modDepth: cell.modDepth, size: cell.size, decay: cell.decay, build: cell.build, tankLowCut: 10, tankHighCut: 20000 };
  if (!holdOnly) console.log(tail(plate, cell, base).join('\t'));
  // HOLD ignores Decay: one Decay suffices.
  if (cell.decay === 10) console.log(held(plate, cell, base).join('\t'));
}
