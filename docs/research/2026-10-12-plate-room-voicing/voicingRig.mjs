// The voicing rig (windsor#746): loads a reverb-processor.js bundle with
// candidate voicing tables patched into its source, so a table is tried
// without a rebuild, and reads the onset figures the issue names. Renders go
// through windsor#763's rig and measures (`../2026-10-12-plate-stereo-input/`)
// and windsor#766's (`../2026-10-12-plate-output-taps/tapRig.mjs`).
import { BLOCK, CASES, clickAt, loadPlate, render } from '../2026-10-12-plate-stereo-input/rig.mjs';
import { SETTLE } from '../2026-10-12-plate-stereo-input/measure.mjs';

const list = (xs) => `[${xs.join(', ')}]`;

/** Each patchable table: its name in the bundle. A key of `table` absent leaves that table as built. */
const NAMES = {
  plateInput: 'PLATE_INPUT_DELAYS',
  plateInputRight: 'PLATE_INPUT_DELAYS_RIGHT',
  roomInput: 'ROOM_INPUT_DELAYS',
  roomInputRight: 'ROOM_INPUT_DELAYS_RIGHT',
  roomBuildTime: 'ROOM_BUILD_TAP_TIME',
  roomBuildDirect: 'ROOM_BUILD_DIRECT_ROWS',
  roomTapTime: 'ROOM_TAP_TIME',
  roomTapLine: 'ROOM_TAP_LINE',
  roomTapGain: 'ROOM_TAP_GAIN',
};

/**
 * Rewrite the bundle's voicing tables. Each replacement must hit exactly
 * once, so a renamed constant fails loudly rather than silently testing the
 * shipped table. `roomBuildRows` is the three gain rows, `roomTrim` the trim.
 */
export function patchVoicing(source, table = {}) {
  const swap = (s, pattern, text) => {
    const hits = s.match(new RegExp(pattern, 'gs'));
    if (!hits || hits.length !== 1) throw new Error(`patchVoicing: ${pattern} hit ${hits?.length ?? 0} times`);
    return s.replace(new RegExp(pattern, 's'), text);
  };
  let s = source;
  for (const [key, name] of Object.entries(NAMES)) {
    if (table[key]) s = swap(s, `var ${name} = \\[[^\\]]*\\];`, `var ${name} = ${list(table[key])};`);
  }
  if (table.roomBuildRows) {
    s = swap(
      s,
      'var ROOM_BUILD_GAIN_ROWS = \\[.*?\\]\\s*\\];',
      `var ROOM_BUILD_GAIN_ROWS = [${table.roomBuildRows.map(list).join(', ')}];`,
    );
  }
  if (table.roomTrim) s = swap(s, 'var ROOM_OUTPUT_TRIM = [0-9.e-]+;', `var ROOM_OUTPUT_TRIM = ${table.roomTrim};`);
  return s;
}

/** A bundle with `table` patched in, or as built when `table` is absent. */
export function loadVoicing(file, rate = 48000, table) {
  return loadPlate(file, rate, table ? (s) => patchVoicing(s, table) : undefined);
}

const settleBlocks = (rate) => Math.round((SETTLE * rate) / BLOCK);

/**
 * One centred click after the plate has settled, both wet channels from the
 * end of the pre-delay for `seconds`. `main`'s bundle ignores `voicing`.
 */
export function clickRender(plate, params, seconds = 1, side = 'centred') {
  const rate = plate.sampleRate;
  const r = render(plate, SETTLE + (params.preDelay ?? 0) + seconds + 0.01, params, {
    feed: clickAt(settleBlocks(rate), CASES[side]),
  });
  const from = settleBlocks(rate) * BLOCK + Math.round((params.preDelay ?? 0) * rate);
  const n = Math.round(seconds * rate);
  return { L: r.L.subarray(from, from + n), R: r.R.subarray(from, from + n), rate };
}

/**
 * The onset of one centred click: the first arrival (ms to the first wet
 * sample within 40 dB of the wet peak over the first second), the energy in
 * the first 20 ms, and the early density (wet samples, both sides, within
 * 40 dB of the peak in the first 100 ms), as windsor#766 counts it.
 */
export function onset(plate, params) {
  const { L, R, rate } = clickRender(plate, params, 1);
  let peak = 0;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const floor = peak * 10 ** (-40 / 20);
  let first = -1;
  let e20 = 0;
  let density = 0;
  for (let i = 0; i < Math.round(0.1 * rate); i++) {
    const loud = Math.abs(L[i]) >= floor || Math.abs(R[i]) >= floor;
    if (first < 0 && loud) first = i;
    if (Math.abs(L[i]) >= floor) density++;
    if (Math.abs(R[i]) >= floor) density++;
    if (i < Math.round(0.02 * rate)) e20 += L[i] * L[i] + R[i] * R[i];
  }
  return { firstMs: first < 0 ? NaN : (first * 1000) / rate, e20, density, peak };
}

export { BLOCK, CASES, SETTLE };
