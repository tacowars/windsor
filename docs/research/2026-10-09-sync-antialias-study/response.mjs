/* global console */
/**
 * Each decimation chain's response (windsor#652, decisions 2 and 4): its
 * taps, its passband from 20 Hz to 20 kHz, the worst gain on anything that
 * folds into 0–20 kHz at each stage, its group delay, and its multiplies per
 * output sample. Research only.
 *
 *   node docs/research/2026-10-09-sync-antialias-study/response.mjs
 */
import { DECIMATORS, chainDelay, magnitude } from './decimators.mjs';

const SR = 48000;
const BAND = 20000;
const GRID = 4000;

const db = (g) => 20 * Math.log10(g);

/** The chain's gain at `f` Hz, each stage at its own input rate. */
function chainGain(stages, f) {
  let rate = SR * stages.reduce((r, s) => r * s.factor, 1);
  let g = 1;
  for (const { h, factor } of stages) {
    g *= magnitude(h, f, rate);
    rate /= factor;
  }
  return g;
}

/** The passband's lowest and highest gain in dB, 20 Hz to 20 kHz. */
function passband(stages) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j <= GRID; j++) {
    const g = db(chainGain(stages, 20 + ((BAND - 20) * j) / GRID));
    lo = Math.min(lo, g);
    hi = Math.max(hi, g);
  }
  return { lo, hi };
}

/** A stage's worst gain on what folds into 0–20 kHz at its output rate. */
function foldGain(h, inRate, outRate) {
  let worst = 0;
  for (let m = 1; m * outRate - BAND <= inRate / 2; m++) {
    const from = m * outRate - BAND;
    const to = Math.min(m * outRate + BAND, inRate / 2);
    for (let j = 0; j <= GRID; j++) {
      worst = Math.max(worst, magnitude(h, from + ((to - from) * j) / GRID, inRate));
    }
  }
  return worst;
}

for (const [name, stages] of Object.entries(DECIMATORS)) {
  const factor = stages.reduce((r, s) => r * s.factor, 1);
  let rate = SR * factor;
  const parts = [];
  let macs = 0;
  let outPerStage = factor;
  for (const { h, factor: f } of stages) {
    parts.push(
      `${h.length} taps ${rate / 1000}→${rate / f / 1000} kHz, fold ${db(foldGain(h, rate, rate / f)).toFixed(1)} dB`,
    );
    outPerStage /= f;
    macs += h.length * outPerStage;
    rate /= f;
  }
  const { lo, hi } = passband(stages);
  const delay = chainDelay(stages);
  console.log(`${name} (${factor}×): ${parts.join('; ')}`);
  console.log(
    `  passband ${lo.toFixed(3)} to ${hi.toFixed(3)} dB; delay ${delay} samples ` +
      `(${((delay / SR) * 1000).toFixed(3)} ms); ${macs} multiplies per output sample`,
  );
}
