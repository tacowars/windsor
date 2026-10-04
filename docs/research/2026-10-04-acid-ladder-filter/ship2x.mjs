/**
 * The 2× solver at the Reso ceiling of 17.2 (windsor#593): the readings the
 * switch from 1× four steps rests on, on one root's bundle.
 *
 * - Convergence: three Newton steps at 2× against 24, the research matrix's
 *   inputs (saw and square at peak 2 and 8 in the ladder's units), k 0, 8
 *   and 17.2, the worst cell at each cutoff, dBr, at 44.1 and 48 kHz.
 * - The tail: an impulse of 1e-6 at k 17.2, the peak |y| at 2–5 ms and at
 *   180–200 ms, and the decay rate between them in dB/s (negative decays),
 *   at every cutoff from 100 Hz to the 10 kHz cap, at 44.1 and 48 kHz; and
 *   the least k at which the ring grows instead, bisected, so the margin
 *   above 17.2 is read on the solver itself.
 *
 *   node ship2x.mjs <repo>
 */
/* global process */
import { candidate, loadBundle, step } from './bundle.mjs';

const root = process.argv[2] ?? '.';
const { Ladder } = loadBundle(root);
const K_TOP = 17.2;
const RATES = [44100, 48000];

function bandLimited(kind, peak, rate) {
  const out = new Float64Array(Math.round(rate / 2));
  let max = 0;
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    for (let h = 1; h <= 127; h += kind === 'square' ? 2 : 1) {
      if (110 * h < rate / 2) v += Math.sin((2 * Math.PI * 110 * h * i) / rate) / h;
    }
    out[i] = v;
    max = Math.max(max, Math.abs(v));
  }
  // Carrier units: the ladder's over its input scale of 0.25.
  return out.map((v) => (v * peak) / max / 0.25);
}

function errorDb(settings, input) {
  const shipped = candidate(new Ladder(), '2x3', settings);
  const converged = candidate(new Ladder(), '2x3', settings);
  converged.steps = 24;
  let peak = 0;
  let error = 0;
  for (let i = 0; i < input.length; i++) {
    const want = step(converged, input[i]);
    const got = step(shipped, input[i]);
    if (i < input.length / 2) continue;
    peak = Math.max(peak, Math.abs(want));
    error = Math.max(error, Math.abs(got - want));
  }
  return error === 0 ? -Infinity : 20 * Math.log10(error / peak);
}

/** The worst cell over k, wave and level at one cutoff and rate: its error and where. */
function worstCell(cutoffHz, rate, inputs) {
  let worst = -Infinity;
  let at = '';
  for (const k of [0, 8, K_TOP]) {
    for (const { kind, peak, samples } of inputs) {
      const db = errorDb({ cutoffHz, k, rate }, samples);
      if (db > worst) [worst, at] = [db, `k ${k}, ${kind} at peak ${peak}`];
    }
  }
  return { worst, at };
}

for (const rate of RATES) {
  const inputs = [];
  for (const kind of ['saw', 'square']) {
    for (const peak of [2, 8]) inputs.push({ kind, peak, samples: bandLimited(kind, peak, rate) });
  }
  for (const cutoffHz of [500, 2000, 5000, 10000]) {
    const { worst, at } = worstCell(cutoffHz, rate, inputs);
    process.stdout.write(
      `convergence 2x3 at ${rate / 1000} kHz, ${String(cutoffHz).padStart(5)} Hz: ${worst.toFixed(0)} dBr (${at})\n`,
    );
  }
}

/** An impulse of 1e-6 at `cutoffHz` and `k`: the peak |y| at 2–5 ms and in the last 20 ms of `seconds`. */
function ring(cutoffHz, k, rate, seconds) {
  const ladder = candidate(new Ladder(), '2x3', { cutoffHz, k, rate });
  const n = Math.round(rate * seconds);
  let early = 0;
  let late = 0;
  for (let i = 0; i < n; i++) {
    const y = Math.abs(step(ladder, i === 0 ? 1e-6 : 0));
    if (i >= rate / 500 && i < rate / 200) early = Math.max(early, y);
    if (i >= n - rate / 50) late = Math.max(late, y);
  }
  return { early, late };
}

/** The least k (to 0.005) at which the ring grows: its last 20 ms of 0.5 s over its 2–5 ms, or held past the impulse, or not finite. */
function growsFrom(cutoffHz, rate) {
  let lo = K_TOP;
  let hi = 80;
  while (hi - lo > 0.005) {
    const mid = (lo + hi) / 2;
    const { early, late } = ring(cutoffHz, mid, rate, 0.5);
    if (!(late <= early && late <= 1e-6)) hi = mid;
    else lo = mid;
  }
  return hi;
}

for (const rate of RATES) {
  for (const cutoffHz of [100, 200, 500, 1000, 2000, 5000, 8000, 10000]) {
    const { early, late } = ring(cutoffHz, K_TOP, rate, 0.2);
    const seconds = 0.19 - 0.0035;
    const rateDb = (20 * Math.log10(late / early)) / seconds;
    const from = growsFrom(cutoffHz, rate);
    process.stdout.write(
      `tail k ${K_TOP} at ${rate / 1000} kHz, ${String(cutoffHz).padStart(5)} Hz: ${early.toExponential(2)} → ${late.toExponential(2)} at 180–200 ms, ${rateDb.toFixed(0)} dB/s; grows from k ${from.toFixed(2)}\n`,
    );
  }
}
