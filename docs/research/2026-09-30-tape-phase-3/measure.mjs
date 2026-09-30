/* global process, console */
/** Reproducible offline experiment. No thresholds are inferred from timings. */
import { writeReport } from './report.mjs';
import { cpus, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { URL } from 'node:url';
import { loadSource, researchEntry } from './load.mjs';
import { spectrumMetrics, errorDb } from './spectra.mjs';
const { Hysteresis, ResampledHysteresis, EXPERIMENT: E } = await loadSource(researchEntry);
const results = {
  baseline: E.baseline,
  upstream: E.upstream,
  environment: {
    cpu: cpus()[0].model,
    arch: process.arch,
    os: release(),
    node: process.version,
    v8: process.versions.v8,
    browser: 'none',
    backend: 'Node source DSP, Float64, mono unless stated',
  },
  settings: E,
  spectra: [],
  stability: [],
  benchmarks: [],
  referenceConvergence: [],
};
function render(options, bin, amplitude) {
  const dsp = new ResampledHysteresis(options),
    output = new Float64Array(E.frames);
  for (let i = 0; i < E.settleFrames + E.frames; i++) {
    // Analytic phase uses the same host samples for all factors.
    const y = dsp.tick(amplitude * Math.sin((2 * Math.PI * bin * i) / E.frames));
    if (i >= E.settleFrames) output[i - E.settleFrames] = y;
  }
  return { dsp, output };
}
function spectrumSweep(rate, bin, amplitude) {
  const reference = render({ rate, factor: E.referenceFactor }, bin, amplitude);
  const finer = render({ rate, factor: 64 }, bin, amplitude);
  results.referenceConvergence.push({
    rate,
    bin,
    amplitude,
    errorDb: errorDb(reference.output, finer.output),
    resets: finer.dsp.core.resets,
  });
  for (const solver of E.solvers)
    for (const factor of E.factors) {
      const actual = render({ rate, factor, solver }, bin, amplitude);
      // Match FIR delay only. Solver phase/gain differences remain in the error.
      const aligned =
        factor === 1
          ? Float64Array.from(
              actual.output,
              (_, i) => actual.output[(i - E.firSpan + E.frames) % E.frames],
            )
          : actual.output;
      results.spectra.push({
        rate,
        bin,
        hz: (bin * rate) / E.frames,
        amplitude,
        solver,
        factor,
        ...spectrumMetrics(actual.output, bin),
        errorVs32xDb: errorDb(aligned, reference.output),
        resets: actual.dsp.core.resets,
        clips: actual.dsp.core.clips,
      });
    }
}
function stress(rate, solver, factor, controls) {
  const core = new Hysteresis(rate * factor, solver);
  core.configure(...controls);
  let peak = 0,
    final = 0;
  // Abrupt sign changes, DC, silence, tiny values and overload, then silence recovery.
  const segments = E.stressLevels;
  for (const level of segments)
    for (let i = 0; i < E.blockSize * factor; i++) {
      final = core.tick(level);
      peak = Math.max(peak, Math.abs(final));
      if (!Number.isFinite(final)) throw Error('Nonfinite output');
    }
  results.stability.push({
    rate,
    solver,
    factor,
    controls,
    peak,
    finalMagnetization: final,
    resets: core.resets,
    clips: core.clips,
  });
}
function stressCorners(rate, solver, factor) {
  for (const drive of [0, 1])
    for (const width of [0, 1])
      for (const sat of [0, 1]) stress(rate, solver, factor, [drive, width, sat]);
}
function benchmark() {
  const rate = E.benchmarkRate,
    frames = rate * E.benchmarkSeconds;
  const input = Float64Array.from(
    { length: frames },
    (_, i) => 0.3 * Math.sin(i * 0.057) + 0.1 * Math.sin(i * 0.37),
  );
  const cases = E.solvers.flatMap((solver) =>
    E.factors.map((factor) => ({
      solver,
      factor,
      channels: [
        new ResampledHysteresis({ rate, factor, solver }),
        new ResampledHysteresis({ rate, factor, solver }),
      ],
      timesMs: [],
      checksum: 0,
    })),
  );
  for (let round = -1; round < E.rounds; round++) {
    const order = round % 2 ? [...cases].reverse() : cases;
    for (const entry of order) {
      const start = performance.now();
      let sum = 0;
      for (let i = 0; i < frames; i++) {
        sum += entry.channels[0].tick(input[i]);
        sum += entry.channels[1].tick(-input[i]);
      }
      if (round >= 0) entry.timesMs.push(performance.now() - start);
      entry.checksum += sum;
    }
  }
  return cases.map(({ channels: _channels, ...entry }) => ({
    ...entry,
    medianMs: [...entry.timesMs].sort((a, b) => a - b)[Math.floor(E.rounds / 2)],
    rate,
    frames,
    channels: 2,
  }));
}
for (const rate of E.rates) {
  for (const bin of E.bins) for (const amplitude of E.levels) spectrumSweep(rate, bin, amplitude);
  for (const solver of E.solvers)
    for (const factor of E.factors) stressCorners(rate, solver, factor);
  console.log('Measured spectra and extremes at', rate);
}
results.benchmarks = benchmark();
results.sourceDiff = execFileSync(
  'git',
  ['diff', E.baseline, '--stat', '--', 'packages/engine', 'packages/app'],
  { encoding: 'utf8' },
);
writeReport(new URL('./measurement.json', import.meta.url), results);
console.log(
  'Wrote measurement.json',
  results.benchmarks.map(({ solver, factor, medianMs }) => ({ solver, factor, medianMs })),
);
