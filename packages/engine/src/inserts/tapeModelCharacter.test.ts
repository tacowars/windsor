/**
 * Each tape model's magnetic character (windsor#289 decision 3): its row
 * alone in the magnetic core at 2× and 48 kHz — the `TapeOversampler` pair,
 * so no Bias, model EQ, DC block, motion or hiss — fed a 1 kHz sine at
 * -12, -6 and 0 dBFS with Drive at 0 (a source-field gain of 1). After a
 * quarter second to settle, fifty whole cycles are read: the harmonics by a
 * DFT at their exact bins, the THD as the harmonics' RMS over the
 * fundamental's, and the fundamental's gain in dB (negative is compression;
 * the core is normalised to unity small-signal gain, so a quiet tone reads
 * about 0 dB).
 *
 * The table below is the one in `docs/log/2026-10-01-tape-per-model-magnetic-rows.md`,
 * rounded as printed there; this test holds the record to the shipped rows.
 * The tone and the DFT's sines come from `tapePortableMath.ts`, so the
 * figures are the same on arm64 and x64.
 */
import { describe, expect, it } from 'vitest';
import { magneticControls } from '../worklet/tape/tapeMagneticRows';
import { TapeOversampler } from '../worklet/tape/tapeOversample';
import { TAPE_MODELS, TAPE_TYPES } from './tapeConstants';
import { cosine, sine } from './tapePortableMath';

const RATE = 48000;
const HZ = 1000;
const PERIOD = RATE / HZ;
const SETTLE = RATE / 4;
const FRAMES = PERIOD * 50;
const LEVELS_DB = [-12, -6, 0] as const;

/** THD in percent and fundamental gain in dB at -12, -6 and 0 dBFS, as the record prints them. */
const RECORD: Record<(typeof TAPE_TYPES)[number], [thd: number, gain: number][]> = {
  studio: [
    [0.54, 0.2],
    [0.95, 0.42],
    [1.58, 0.72],
  ],
  ferric: [
    [1.4, 0.1],
    [4.72, -0.3],
    [12.27, -1.78],
  ],
  vintage: [
    [3.41, 1.27],
    [6.22, 2.07],
    [12.17, 2.16],
  ],
  studio15: [
    [1.44, 0.44],
    [3.38, 0.61],
    [8.91, 0.16],
  ],
  chrome: [
    [0.29, 0.01],
    [1.19, -0.12],
    [4.36, -0.74],
  ],
  metal: [
    [1.15, 0.43],
    [1.97, 0.86],
    [3.5, 1.36],
  ],
  vhs: [
    [5.24, -0.54],
    [12.27, -1.99],
    [20.32, -4.36],
  ],
};

/** One row's THD (%) and fundamental gain (dB) for a 1 kHz sine at `db` dBFS. */
function character(row: readonly [number, number, number], db: number): [number, number] {
  const level = 10 ** (db / 20);
  const core = new TapeOversampler(RATE, 2);
  core.configure(magneticControls(row, { drive: NaN, width: NaN, saturation: NaN }));
  const out = new Float64Array(FRAMES);
  for (let n = 0; n < SETTLE + FRAMES; n++) {
    const y = core.process(level * sine((2 * Math.PI * HZ * n) / RATE));
    if (n >= SETTLE) out[n - SETTLE] = y;
  }
  const amplitudes: number[] = [];
  for (let k = 1; k * HZ < RATE / 2; k++) {
    let re = 0,
      im = 0;
    for (let n = 0; n < FRAMES; n++) {
      const phase = (2 * Math.PI * k * n) / PERIOD;
      re += out[n]! * cosine(phase);
      im += out[n]! * sine(phase);
    }
    amplitudes.push((2 * Math.hypot(re, im)) / FRAMES);
  }
  const [fundamental, ...harmonics] = amplitudes;
  const distortion = Math.sqrt(harmonics.reduce((sum, a) => sum + a * a, 0));
  return [(100 * distortion) / fundamental!, 20 * Math.log10(fundamental! / level)];
}

describe('each tape model’s magnetic character (windsor#289)', () => {
  const measured = TAPE_TYPES.map((_, i) =>
    LEVELS_DB.map((db) => character(TAPE_MODELS[i]!.magnetic, db)),
  );

  it('matches the decision record’s table', () => {
    TAPE_TYPES.forEach((type, i) => {
      LEVELS_DB.forEach((db, l) => {
        const [thd, gain] = measured[i]![l]!;
        const [recordThd, recordGain] = RECORD[type][l]!;
        expect(thd, `${type} THD at ${db} dBFS`).toBeCloseTo(recordThd, 2);
        expect(gain, `${type} gain at ${db} dBFS`).toBeCloseTo(recordGain, 2);
      });
    });
  });

  it('orders the models clean to dirty at -6 dBFS as the issue expected', () => {
    const thdAt = (type: (typeof TAPE_TYPES)[number]): number =>
      measured[TAPE_TYPES.indexOf(type)]![1]![0];
    const order = [...TAPE_TYPES].sort((a, b) => thdAt(a) - thdAt(b));
    expect(order).toEqual(['studio', 'chrome', 'metal', 'studio15', 'ferric', 'vintage', 'vhs']);
  });
});
