// The output-tap rig (windsor#766): loads a reverb-processor.js bundle with a
// candidate tap table patched into its source, so a table is tried without a
// rebuild, and reads the figures the issue's criteria name. Renders go
// through windsor#763's rig and measures (`../2026-10-12-plate-stereo-input/`).
import { BLOCK, CASES, clickAt, db, loadPlate, render } from '../2026-10-12-plate-stereo-input/rig.mjs';
import { clickSecond, clickWindows, noiseFigures, SETTLE, THIRDS } from '../2026-10-12-plate-stereo-input/measure.mjs';

const list = (xs) => `[${xs.join(', ')}]`;

/**
 * Rewrite the bundle's tap table: `table` holds `time` (seconds), `line`,
 * `gain` (signed), `perSide` and `trim`. Each replacement must hit exactly
 * once, so a renamed constant fails loudly rather than silently testing the
 * shipped table.
 */
export function patchTaps(source, table) {
  const swap = (s, pattern, text) => {
    const hits = s.match(new RegExp(pattern, 'gs'));
    if (!hits || hits.length !== 1) throw new Error(`patchTaps: ${pattern} hit ${hits?.length ?? 0} times`);
    return s.replace(new RegExp(pattern, 's'), text);
  };
  let s = source;
  s = swap(s, 'var TAP_TIME = \\[[^\\]]*\\];', `var TAP_TIME = ${list(table.time)};`);
  s = swap(s, 'var TAP_LINE = \\[[^\\]]*\\];', `var TAP_LINE = ${list(table.line)};`);
  s = swap(s, 'var TAP_GAIN = \\[[^\\]]*\\];', `var TAP_GAIN = ${list(table.gain)};`);
  s = swap(s, 'var TAPS_PER_SIDE = [0-9]+;', `var TAPS_PER_SIDE = ${table.perSide};`);
  s = swap(s, 'var OUTPUT_TRIM = [0-9.e-]+;', `var OUTPUT_TRIM = ${table.trim};`);
  return s;
}

/**
 * A bundle with `table` patched in, or the bundle as built when `table` is
 * absent; `more` rewrites the source after it (`capture.mjs`'s instrument).
 */
export function loadTable(file, rate, table, more = (s) => s) {
  return loadPlate(file, rate, (s) => more(table ? patchTaps(s, table) : s));
}

const settleBlocks = (rate) => Math.round((SETTLE * rate) / BLOCK);

/**
 * Early density (windsor#766): one centred click, and the count of wet
 * samples, both sides, within 40 dB of the wet peak (over the click's first
 * second) in the first 100 ms after the pre-delay. Also returns the first
 * 100 ms's energy, for context.
 */
export function earlyDensity(plate, params) {
  const rate = plate.sampleRate;
  const r = render(plate, SETTLE + (params.preDelay ?? 0) + 1.01, params, {
    feed: clickAt(settleBlocks(rate), CASES.centred),
  });
  const from = settleBlocks(rate) * BLOCK + Math.round((params.preDelay ?? 0) * rate);
  let peak = 0;
  for (let i = from; i < from + rate; i++) peak = Math.max(peak, Math.abs(r.L[i]), Math.abs(r.R[i]));
  const floor = peak * 10 ** (-40 / 20);
  const to = from + Math.round(0.1 * rate);
  let count = 0;
  for (let i = from; i < to; i++) {
    if (Math.abs(r.L[i]) >= floor) count++;
    if (Math.abs(r.R[i]) >= floor) count++;
  }
  return { count, peak };
}

export const WINDOWS = [
  [0, 50],
  [50, 200],
  [200, 1000],
];

/**
 * windsor#763's side-lead and mirror cells, as its `criteria.mjs` reads them:
 * per Build (0, 1) and Size (0.25, 1, 4), L alone's lead and R alone's lead
 * in each window, and the mirror (L alone's left over R alone's right).
 */
export function sides(plate) {
  const cells = [];
  for (const build of [0, 1]) {
    for (const size of [0.25, 1, 4]) {
      const l = clickWindows(plate, { size, build }, 'left', WINDOWS);
      const r = clickWindows(plate, { size, build }, 'right', WINDOWS);
      cells.push({
        build,
        size,
        leadL: l.map((w) => db(w.l / w.r)),
        leadR: r.map((w) => db(w.r / w.l)),
        mirror: l.map((w, i) => db(w.l / r[i].r)),
      });
    }
  }
  return cells;
}

/** 10 s of centred noise at `size`: the L/R correlation and the mono sum's total and third-octave energies. */
export function width(plate, size, seconds = 10) {
  const n = noiseFigures(plate, { size }, 'centred', { seconds });
  return { corr: n.corr, mono: n.rmsMono, bands: n.bands, rmsL: n.rmsL, rmsR: n.rmsR };
}

/** One centred click's wet RMS over its first second, both sides, at `build` in the default space. */
export function level(plate, build) {
  const c = clickSecond(plate, { build }, 'centred');
  return Math.sqrt((c.rmsL ** 2 + c.rmsR ** 2) / 2);
}

export { db, THIRDS };
