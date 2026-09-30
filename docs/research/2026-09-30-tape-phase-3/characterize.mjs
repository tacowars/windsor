/* global console */
/** Pinned phase-2 baseline and extra prototype evidence; run from repo root. */
import { writeReport } from './report.mjs';
import { URL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { loadSource, researchEntry } from './load.mjs';
import { spectrumMetrics, powerSpectrum, errorDb, db } from './spectra.mjs';
const { EXPERIMENT: E, ResampledHysteresis } = await loadSource(researchEntry);
const { TapeDsp, TAPE_DEFAULTS } = await loadSource(
  `
export { TapeDsp } from './packages/engine/src/worklet/tape/tapeDsp.ts';
export { TAPE_DEFAULTS } from './packages/engine/src/inserts/tapeConstants.ts';`,
  E.baseline,
);
function legacy(rate, values, signal, frames = E.frames, settle = E.settleFrames) {
  const params = Object.fromEntries(
    Object.entries({ ...TAPE_DEFAULTS, model: 0, ...values }).map(([k, v]) => [
      k,
      new Float32Array([Number(v)]),
    ]),
  );
  const dsp = new TapeDsp(rate, params),
    output = new Float64Array(frames);
  for (let i = 0; i < frames + settle; i++) {
    if (i % E.blockSize === 0) dsp.configure(params, E.blockSize);
    const x = signal(i);
    dsp.tick(x, x);
    if (i >= settle) output[i - settle] = dsp.left;
  }
  return output;
}
const result = {
  baseline: E.baseline,
  response: [],
  impulse: [],
  motion: [],
  twoTone: [],
  recovery: [],
  corners: [],
};
for (const rate of E.rates) {
  for (const bin of E.bins)
    for (const amplitude of E.levels) {
      const samples = legacy(
        rate,
        {},
        (i) => amplitude * Math.sin((2 * Math.PI * bin * i) / E.frames),
      );
      result.response.push({ rate, bin, amplitude, ...spectrumMetrics(samples, bin) });
    }
  const impulse = legacy(rate, {}, (i) => (i === 0 ? 0.001 : 0), 512, 0);
  result.impulse.push({
    rate,
    peakSample: impulse.findIndex((x) => Math.abs(x) === Math.max(...impulse.map(Math.abs))),
    firstNonzero: impulse.findIndex((x) => x !== 0),
  });
  for (const wear of [0, 50]) {
    const frames = 65536,
      bin = 1361;
    const samples = legacy(
      rate,
      { wear, seed: 123 },
      (i) => 0.01 * Math.sin((2 * Math.PI * bin * i) / frames),
      frames,
      frames,
    );
    const power = powerSpectrum(samples);
    // ±100 Hz skirt, excluding the carrier; includes modulation, not an alias claim.
    const width = Math.floor((100 * frames) / rate);
    let skirt = 0;
    for (let b = bin - width; b <= bin + width; b++) if (b !== bin) skirt += power[b];
    result.motion.push({
      rate,
      wear,
      seed: 123,
      frames,
      carrierHz: (bin * rate) / frames,
      skirtDbc: db(skirt / power[bin]),
    });
  }
  const reference = twoTone(rate, 32);
  for (const factor of E.factors) {
    const output = twoTone(rate, factor);
    const aligned =
      factor === 1
        ? Float64Array.from(output, (_, i) => output[(i - E.firSpan + E.frames) % E.frames])
        : output;
    result.twoTone.push({
      rate,
      factor,
      solver: 'rk4',
      bins: [997, 1361],
      amplitudeEach: 0.5,
      residualVs32xDb: errorDb(aligned, reference),
    });
    result.recovery.push(recovery(rate, factor));
    for (const solver of E.solvers) result.corners.push(...corners(rate, factor, solver));
  }
}
function corners(rate, factor, solver) {
  const rows = [];
  for (let corner = 0; corner < 8; corner++) {
    const drive = (corner >> 2) & 1,
      width = (corner >> 1) & 1,
      sat = corner & 1;
    const dsp = new ResampledHysteresis({ rate, factor, solver });
    dsp.core.configure(drive, width, sat);
    let peak = 0;
    for (let i = 0; i < E.frames; i++) {
      const y = dsp.tick(Math.sin((2 * Math.PI * 173 * i) / E.frames));
      peak = Math.max(peak, Math.abs(y));
      if (!Number.isFinite(y)) throw Error('Nonfinite corner output');
    }
    rows.push({ rate, factor, solver, drive, width, sat, peak, resets: dsp.core.resets });
  }
  return rows;
}
function twoTone(rate, factor) {
  const dsp = new ResampledHysteresis({ rate, factor }),
    output = new Float64Array(E.frames);
  for (let i = 0; i < E.frames + E.settleFrames; i++) {
    const y = dsp.tick(
      0.5 *
        (Math.sin((2 * Math.PI * 997 * i) / E.frames) +
          Math.sin((2 * Math.PI * 1361 * i) / E.frames)),
    );
    if (i >= E.settleFrames) output[i - E.settleFrames] = y;
  }
  return output;
}
function recovery(rate, factor) {
  const dsp = new ResampledHysteresis({ rate, factor });
  const pole = Math.exp((-2 * Math.PI * E.dcHz) / rate);
  let last = 0,
    dc = 0,
    peak = 0,
    tail = 0;
  // Ten seconds driven, one second DC, two seconds silence; DC blocker is measured separately.
  for (let i = 0; i < rate * 13; i++) {
    const input =
      i < rate * 10 ? 0.8 * Math.sin((2 * Math.PI * 1000 * i) / rate) : i < rate * 11 ? 1 : 0;
    const y = dsp.tick(input);
    dc = y - last + pole * dc;
    last = y;
    peak = Math.max(peak, Math.abs(dc));
    if (i >= rate * 12) tail = Math.max(tail, Math.abs(dc));
  }
  return {
    rate,
    factor,
    seconds: 13,
    peak,
    lastMagnetization: last,
    finalSecondDcPeak: tail,
    resets: dsp.core.resets,
    clips: dsp.core.clips,
  };
}
function legacyTiming() {
  const rate = E.benchmarkRate,
    frames = rate * E.benchmarkSeconds;
  const input = Float64Array.from(
    { length: frames },
    (_, i) => 0.3 * Math.sin(i * 0.057) + 0.1 * Math.sin(i * 0.37),
  );
  const params = Object.fromEntries(
    Object.entries({ ...TAPE_DEFAULTS, model: 0 }).map(([k, v]) => [
      k,
      new Float32Array([Number(v)]),
    ]),
  );
  const dsp = new TapeDsp(rate, params),
    timesMs = [];
  let checksum = 0;
  for (let round = -1; round < E.rounds; round++) {
    const start = performance.now();
    for (let i = 0; i < frames; i++) {
      if (i % E.blockSize === 0) dsp.configure(params, E.blockSize);
      dsp.tick(input[i], -input[i]);
      checksum += dsp.left + dsp.right;
    }
    if (round >= 0) timesMs.push(performance.now() - start);
  }
  return {
    rate,
    frames,
    channels: 2,
    timesMs,
    medianMs: [...timesMs].sort((a, b) => a - b)[Math.floor(E.rounds / 2)],
    checksum,
  };
}
result.legacyTiming = legacyTiming();
writeReport(new URL('./characterization.json', import.meta.url), result);
console.log('Wrote characterization.json');
