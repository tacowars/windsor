// Tap captures (windsor#766). The output taps feed nothing back, so the wet
// output is linear in the tap gains: left = trim × (Σ g_t y_t + direct_L).
// This patches the new bundle so each tap's read y_t and each side's Build
// direct path land in `globalThis.__CAP` sample by sample, renders a time
// layout once per case, and turns every criterion into a sum over those
// captures that `optimise.mjs` reads for any gains without rendering again.
import { BLOCK, CASES, clickAt, noiseFrom, render } from '../2026-10-12-plate-stereo-input/rig.mjs';
import { SETTLE, THIRDS } from '../2026-10-12-plate-stereo-input/measure.mjs';
import { loadTable } from './tapRig.mjs';
import { welchBands } from './welch.mjs';

const swapOnce = (s, from, to) => {
  if (s.split(from).length !== 2) throw new Error(`instrument: "${from}" is not in the bundle once`);
  return s.replace(from, to);
};

/** The new bundle's tap loops, writing each read and each direct path into `__CAP` as well. */
function instrument(source) {
  let s = source;
  const read = '(a + (line[whole + 1 & masks[tapLine]] - a) * (position - whole))';
  s = swapOnce(s, `left += ${read} * TAP_GAIN[t];`, `left += (__CAP.y[t][__CAP.n] = ${read}) * TAP_GAIN[t];`);
  s = swapOnce(s, `right += ${read} * TAP_GAIN[t];`, `right += (__CAP.y[t][__CAP.n] = ${read}) * TAP_GAIN[t];`);
  s = swapOnce(
    s,
    'left += buildLeft * direct;',
    '__CAP.d[0][__CAP.n] = buildLeft * direct; __CAP.d[1][__CAP.n] = buildRight * direct; __CAP.n++; left += buildLeft * direct;',
  );
  return s;
}

/** The new bundle at `layout`'s times and lines, every gain 1 and the trim 1, instrumented. */
export function capturePlate(file, rate, layout) {
  const table = { ...layout, gain: layout.line.map(() => 1), trim: 1 };
  return loadTable(file, rate, table, instrument);
}

const settleBlocks = (rate) => Math.round((SETTLE * rate) / BLOCK);

/**
 * Render `seconds` and return the captures from sample `from` for `length`
 * samples: rows 0..2N−1 the taps, 2N and 2N+1 the left and right direct paths.
 */
function run(plate, taps, { seconds, params, feed, from, length }) {
  const total = Math.ceil((seconds * plate.sampleRate) / BLOCK) * BLOCK;
  globalThis.__CAP = {
    y: Array.from({ length: taps }, () => new Float32Array(total)),
    d: [new Float32Array(total), new Float32Array(total)],
    n: 0,
  };
  render(plate, seconds, params, { feed, options: { sleep: false } });
  const { y, d } = globalThis.__CAP;
  return [...y, ...d].map((row) => row.subarray(from, from + length));
}

/** Gram matrix of `rows` over [lo, hi). */
function gram(rows, lo = 0, hi = rows[0].length) {
  const n = rows.length;
  const g = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const a = rows[i];
      const b = rows[j];
      let s = 0;
      for (let k = lo; k < hi; k++) s += a[k] * b[k];
      g[i * n + j] = g[j * n + i] = s;
    }
  }
  return g;
}

export const SIZES = [0.25, 1, 4];
export const BUILDS = [0, 1];
export const LEVEL_BUILDS = [0, 0.5, 1];
/**
 * The T30 cells the output taps move most (Decay 2 s at Size 4, where the
 * 0.6 s lines lose 18 dB a pass and few passes span the fit), as
 * `mixer/reverbBuild.test.ts` and `mixer/reverbModulation.test.ts` read them:
 * a centred click, tank filters open, at Build 0, the default 0.1, 0.5 and 1
 * with the modulation off, and at the deepest modulation.
 */
const OPEN = { tankLowCut: 10, tankHighCut: 20000, lowDecay: 1, size: 4, decay: 2 };
export const T30_CELLS = [
  ...[0, 0.1, 0.5, 1].map((build) => ({ ...OPEN, modDepth: 0, build })),
  { ...OPEN, modRate: 8, modDepth: 4 },
];
/** The bin each T30 cell's energy is gathered in, seconds. */
const T30_BIN = 0.005;

export const WINDOWS = [
  [0, 50],
  [50, 200],
  [200, 1000],
];

/** windsor#763's side cells, a click on L alone and on R alone, at both the rates its note reads them. */
function captureSides(file, layout, plate) {
  const taps = layout.line.length;
  return [plate.sampleRate, 44100].flatMap((at) => {
    const p = at === plate.sampleRate ? plate : capturePlate(file, at, layout);
    const cells = [];
    for (const build of BUILDS) {
      for (const size of SIZES) {
        const cell = {};
        for (const side of ['left', 'right']) {
          const rows = run(p, taps, {
            seconds: SETTLE + 1.01,
            params: { build, size },
            feed: clickAt(settleBlocks(at), CASES[side]),
            from: settleBlocks(at) * BLOCK,
            length: at,
          });
          const ms = (t) => Math.round((t * at) / 1000);
          cell[side] = WINDOWS.map(([a, b]) => gram(rows, ms(a), ms(b)));
        }
        cells.push(cell);
      }
    }
    return cells;
  });
}

/** One T30 cell: a centred click's energy Gram per T30_BIN. */
function captureT30(plate, taps, params) {
  const rate = plate.sampleRate;
  const length = Math.round((1.5 * params.decay + 3.5) * rate);
  const rows = run(plate, taps, {
    seconds: SETTLE + length / rate + 0.01,
    params,
    feed: clickAt(settleBlocks(rate), CASES.centred),
    from: settleBlocks(rate) * BLOCK,
    length,
  });
  const bin = Math.round(T30_BIN * rate);
  const bins = [];
  for (let lo = 0; lo + bin <= length; lo += bin) bins.push(gram(rows, lo, lo + bin));
  return { decay: params.decay, bin: T30_BIN, bins };
}

/**
 * Every capture the criteria read for one layout at 48 kHz: the early-density
 * cells (a centred click's first second), the side windows (a click on L
 * alone and on R alone, each side's Gram per window, at 48 and then 44.1
 * kHz), the noise Grams (all of 10 s of centred noise and a second after, and
 * per third-octave), the level Grams (a centred click's first second at Build
 * 0, 0.5 and 1), and the T30 cells' binned Grams.
 */
export function captureLayout(file, layout, { noiseSeconds = 10 } = {}) {
  const rate = 48000;
  const taps = layout.line.length;
  const plate = capturePlate(file, rate, layout);
  const from = settleBlocks(rate) * BLOCK;
  const click = (side, params) =>
    run(plate, taps, {
      seconds: SETTLE + 1.01,
      params,
      feed: clickAt(settleBlocks(rate), CASES[side]),
      from,
      length: rate,
    });
  const density = [];
  for (const build of BUILDS) for (const size of SIZES) density.push(click('centred', { build, size }));
  const sides = captureSides(file, layout, plate);
  const noise = SIZES.map((size) => {
    const length = Math.round((noiseSeconds + 1) * rate);
    const rows = run(plate, taps, {
      seconds: SETTLE + noiseSeconds + 1,
      params: { size },
      feed: noiseFrom(settleBlocks(rate), noiseSeconds, CASES.centred, rate),
      from,
      length,
    });
    return { length, all: gram(rows), bands: welchBands(rows, rate, THIRDS) };
  });
  const level = LEVEL_BUILDS.map((build) => gram(click('centred', { build })));
  const t30 = T30_CELLS.map((params) => captureT30(plate, taps, params));
  return { taps, rate, density, sides, noise, level, t30 };
}
