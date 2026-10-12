/* global process, console */
// windsor#766's acceptance figures, `main` (94a14d6) beside the new plate:
// early density, width, the mono sum, level and T30. The side-lead and mirror
// cells are windsor#763's own script, `../2026-10-12-plate-stereo-input/criteria.mjs`.
// Prints the note's tables in order.
// node criteria.mjs <new bundle> <main bundle> [rate]
import { clickT30 } from '../2026-10-12-plate-stereo-input/measure.mjs';
import { db, earlyDensity, level, loadTable, THIRDS, width } from './tapRig.mjs';

const [file, mainFile, rateArg = '48000'] = process.argv.slice(2);
const rate = Number(rateArg);
const plate = loadTable(file, rate);
const main = loadTable(mainFile, rate);
const SIZES = [0.25, 1, 4];
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const table = (title, head, rows) => {
  console.log(`\n${title}\n`);
  console.log(`| ${head.join(' | ')} |`);
  console.log(`|${head.map(() => '---').join('|')}|`);
  for (const row of rows) console.log(`| ${row.join(' | ')} |`);
};

// 1. Early density.
{
  const rows = [];
  for (const build of [0, 1]) {
    for (const size of SIZES) {
      const a = earlyDensity(main, { build, size }).count;
      const b = earlyDensity(plate, { build, size }).count;
      rows.push([build, size, a, b, `${f((b / a - 1) * 100, 1)} %`]);
    }
  }
  table(
    `Early density at ${rate} Hz: one centred click, wet samples (both sides) within 40 dB of the wet peak in the first 100 ms, of ${2 * Math.round(0.1 * rate)}.`,
    ['Build', 'Size', 'main', 'new', 'new against main'],
    rows,
  );
}

// 2. Width and the mono sum.
{
  const rows = [];
  const bandRows = [];
  for (const size of SIZES) {
    const a = width(main, size);
    const b = width(plate, size);
    const gaps = b.bands.map((e, i) => db(e / a.bands[i]));
    const low = Math.min(...gaps);
    rows.push([
      size,
      f(a.corr, 4),
      f(b.corr, 4),
      f(db((b.mono / a.mono) ** 2)),
      f(low),
      `${THIRDS[gaps.indexOf(low)]} Hz`,
    ]);
    bandRows.push([size, ...gaps.map((g) => f(g, 1))]);
  }
  table(
    `Width at ${rate} Hz: 10 s of centred noise, the default space but Size, read to a second past its end: the wet's L/R correlation, and its mono sum (L + R) / 2 against main's.`,
    ['Size', "main's correlation", 'new', 'mono sum, total, dB', 'lowest band, dB', 'at'],
    rows,
  );
  table("Each third-octave band of the mono sum against main's, dB.", ['Size', ...THIRDS.map(String)], bandRows);
}

// 3. Level.
{
  const rows = [];
  for (const build of [0, 0.1, 0.5, 1]) {
    const a = level(main, build);
    const b = level(plate, build);
    rows.push([build, f(a, 5), f(b, 5), f(db((b / a) ** 2))]);
  }
  table(
    `Level at ${rate} Hz: one centred click's wet RMS over its first second, both sides, the default space.`,
    ['Build', 'main', 'new', 'new − main, dB'],
    rows,
  );
}

// 4. The tail's length.
{
  const rows = [];
  for (const decay of [2, 10, 60]) {
    for (const size of SIZES) {
      const params = { tankLowCut: 10, tankHighCut: 20000, modDepth: 0, lowDecay: 1, decay, size };
      const seconds = 1.5 * decay + 3.5;
      const a = clickT30(main, params, 'centred', seconds);
      const b = clickT30(plate, params, 'centred', seconds);
      const pct = (t) => `${f(t, 2)} (${f((t / decay - 1) * 100, 1)} %)`;
      rows.push([decay, size, pct(a), pct(b)]);
    }
  }
  table(
    `T30 at ${rate} Hz, seconds (against Decay): one centred click, the default Build, tank filters open and no modulation, as the Decay tests read it.`,
    ['Decay', 'Size', 'main', 'new'],
    rows,
  );
}
