/* global process */
/**
 * The Acid Ladder's convergence reading (windsor#573, decision 6, reading
 * 4): each solver candidate's fixed Newton count against 24 steps of the
 * same solver, through the shipped bundle's `Ladder` (its saturator, its
 * derivative, its decimator), on the research matrix's inputs: a 110 Hz
 * band-limited saw and square (harmonics through 127) at peak 2 and 8 in
 * the ladder's units, cutoffs 500 Hz to 18 kHz (held to the candidate's
 * cap), k 0, 8 and 16.5. Reported: the peak-relative maximum error (dBr)
 * over the second quarter second, the worst cell at each cutoff, at 48 kHz
 * and, for the capped candidate, at 44.1 kHz, where the cap's step is
 * longest.
 *
 *   node convergence.mjs <repo>
 */
import { CANDIDATES, SR, candidate, loadBundle, step } from './bundle.mjs';

const root = process.argv[2] ?? '.';
const { Ladder } = loadBundle(root);

/** A 110 Hz saw or square, harmonics through 127, at `peak` in the ladder's units (half that in the carrier's), 0.5 s. */
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
  return out.map((v) => (v * peak) / max / 2);
}

function errorDb(name, settings, input, steps) {
  const shipped = candidate(new Ladder(), name, settings);
  const converged = candidate(new Ladder(), name, settings);
  converged.steps = steps;
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

/** The worst cell over k, wave and level at one cutoff: its error and where. */
function worstCell(name, cutoffHz, rate, inputs) {
  let worst = -Infinity;
  let at = '';
  for (const k of [0, 8, 16.5]) {
    for (const { kind, peak, samples } of inputs) {
      const db = errorDb(name, { cutoffHz, k, rate }, samples, 24);
      if (db > worst) [worst, at] = [db, `k ${k}, ${kind} at peak ${peak}`];
    }
  }
  return { worst, at };
}

for (const [name, c] of Object.entries(CANDIDATES)) {
  for (const rate of name === '1x4' ? [SR, 44100] : [SR]) {
    const inputs = [];
    for (const kind of ['saw', 'square']) {
      for (const peak of [2, 8]) inputs.push({ kind, peak, samples: bandLimited(kind, peak, rate) });
    }
    for (const cutoffHz of [500, 2000, 5000, 10000, 18000]) {
      const { worst, at } = worstCell(name, cutoffHz, rate, inputs);
      const plays = Math.min(cutoffHz, c.capHz);
      const capped = plays < cutoffHz ? ` (plays ${plays})` : '';
      process.stdout.write(
        `${name} at ${rate / 1000} kHz, ${String(cutoffHz).padStart(5)} Hz${capped}: ${worst.toFixed(0)} dBr (${at})\n`,
      );
    }
  }
}
