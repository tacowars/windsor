/* global process, console */
// windsor#763's acceptance figures at the processor, `main` (d627d18) beside
// the new plate, at 48 kHz unless a row names another rate. Every click
// waits half a second so the plate has settled at its Size and Build, and
// every window is read from the end of the pre-delay. Prints the tables the
// research note carries, in order.
// node criteria.mjs <new bundle> <main bundle> [rate]
import { loadPlate } from './rig.mjs';
import { clickSecond, clickT30, clickWindows, db, noiseFigures, THIRDS } from './measure.mjs';

const [file, mainFile, rateArg = '48000'] = process.argv.slice(2);
const rate = Number(rateArg);
const plate = loadPlate(file, rate);
const main = loadPlate(mainFile, rate);
const invertPatch = (source) =>
  source.replace('const splitLeft = buildRight +', 'const splitLeft = -buildRight +');
const inverted = loadPlate(file, rate, invertPatch);
const WINDOWS = [
  [0, 50],
  [50, 200],
  [200, 1000],
];
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const table = (title, head, rows) => {
  console.log(`\n${title}\n`);
  console.log(`| ${head.join(' | ')} |`);
  console.log(`|${head.map(() => '---').join('|')}|`);
  for (const row of rows) console.log(`| ${row.join(' | ')} |`);
};

// 1. The side follows the input, and the mirror.
{
  const rows = [];
  for (const build of [0, 1]) {
    for (const size of [0.25, 1, 4]) {
      const l = clickWindows(plate, { size, build }, 'left', WINDOWS);
      const r = clickWindows(plate, { size, build }, 'right', WINDOWS);
      rows.push([
        build,
        size,
        ...l.map((w) => f(db(w.l / w.r), 1)),
        ...r.map((w) => f(db(w.r / w.l), 1)),
        ...l.map((w, i) => f(db(w.l / r[i].r))),
      ]);
    }
  }
  table(
    `Side and mirror at ${rate} Hz: one click on L alone, then on R alone, the default space. ` +
      'Lead is the fed side over the other, dB; mirror is L alone\'s left energy over R alone\'s right, dB.',
    ['Build', 'Size', 'L lead 0–50', '50–200', '200–1000', 'R lead 0–50', '50–200', '200–1000', 'mirror 0–50', '50–200', '200–1000'],
    rows,
  );
}

// 2. A centred source stays central; a one-channel input too.
{
  const rows = [];
  for (const build of [0, 0.5, 1]) {
    const click = clickSecond(plate, { build }, 'centred');
    const one = clickSecond(plate, { build }, 'left', { channels: 1 });
    const noise = noiseFigures(plate, { build }, 'centred', { bands: false });
    const oneNoise = noiseFigures(plate, { build }, 'left', { channels: 1, bands: false });
    rows.push([
      build,
      f(db((click.rmsL / click.rmsR) ** 2)),
      f(db((noise.rmsL / noise.rmsR) ** 2)),
      f(db((one.rmsL / one.rmsR) ** 2)),
      f(db((oneNoise.rmsL / oneNoise.rmsR) ** 2)),
    ]);
  }
  table(
    `Balance at ${rate} Hz, wet L over R in dB, the default space: a click over its first second, and 10 s of noise.`,
    ['Build', 'L = R click', 'L = R noise', 'one channel, click', 'one channel, noise'],
    rows,
  );
}

// 3. No level jump.
{
  const rows = [];
  for (const build of [0, 0.5, 1]) {
    for (const side of ['centred', 'left']) {
      const a = clickSecond(main, { build }, side);
      const b = clickSecond(plate, { build }, side);
      const rms = (x) => Math.sqrt((x.rmsL ** 2 + x.rmsR ** 2) / 2);
      rows.push([build, side === 'centred' ? 'L = R' : 'L alone', f(rms(a), 5), f(rms(b), 5), f(db((rms(b) / rms(a)) ** 2))]);
    }
  }
  table(
    `Level at ${rate} Hz: one click's wet RMS over its first second (both sides), the default space.`,
    ['Build', 'Input', 'main', 'new', 'new − main, dB'],
    rows,
  );
}

// 4. Mono-compatible, and the inversion trial.
{
  const base = noiseFigures(main, {}, 'centred');
  const rows = [];
  const bandRows = [];
  for (const [name, p] of [
    ['new', plate],
    ['new, left injection inverted', inverted],
  ]) {
    const n = noiseFigures(p, {}, 'centred');
    const gaps = n.bands.map((e, i) => db(e / base.bands[i]));
    rows.push([
      name,
      f(db((n.rmsMono / base.rmsMono) ** 2)),
      f(Math.min(...gaps)),
      `${THIRDS[gaps.indexOf(Math.min(...gaps))]} Hz`,
      f(n.corr, 3),
      f(base.corr, 3),
    ]);
    bandRows.push([name, ...gaps.map((g) => f(g, 1))]);
  }
  table(
    `Mono sum at ${rate} Hz: 10 s of centred noise, the default space, (L + R) / 2 against main's.`,
    ['Plate', 'total, dB', 'lowest band, dB', 'at', 'L/R correlation', "main's"],
    rows,
  );
  table('Each third-octave band of the mono sum against main\'s, dB.', ['Plate', ...THIRDS.map(String)], bandRows);
}

// 5. Anti-phase.
{
  const rows = [];
  for (const build of [0, 0.5, 1]) {
    const a = clickSecond(main, { build }, 'anti');
    const b = clickSecond(plate, { build }, 'anti');
    const c = clickSecond(plate, { build }, 'centred');
    const inv = clickSecond(inverted, { build }, 'anti');
    rows.push([
      build,
      f(a.rmsL, 6),
      f(b.rmsL, 5),
      f(b.rmsR, 5),
      f(b.rmsMono, 5),
      f(db(((b.rmsL ** 2 + b.rmsR ** 2) / (c.rmsL ** 2 + c.rmsR ** 2))), 1),
      f(inv.rmsMono, 5),
    ]);
  }
  table(
    `Anti-phase at ${rate} Hz: one click with L = −R, wet RMS over the first second, the default space.`,
    ['Build', 'main L', 'new L', 'new R', 'new mono sum', 'level against L = R, dB', 'mono sum, inverted'],
    rows,
  );
}

// 6. The tail's length.
{
  const rows = [];
  for (const decay of [2, 10]) {
    for (const size of [0.25, 1, 4]) {
      const params = { tankLowCut: 10, tankHighCut: 20000, modDepth: 0, decay, size };
      const seconds = 1.5 * decay + 3.5;
      const m = clickT30(main, params, 'centred', seconds);
      const c = clickT30(plate, params, 'centred', seconds);
      const l = clickT30(plate, params, 'left', seconds);
      const pct = (t) => `${f(t, 2)} (${f((t / decay - 1) * 100, 1)} %)`;
      rows.push([decay, size, pct(m), pct(c), pct(l)]);
    }
  }
  table(
    `T30 at ${rate} Hz, seconds (against Decay): one click, the default Build, tank filters open and no modulation, as the Decay tests read it.`,
    ['Decay', 'Size', 'main', 'new, L = R', 'new, L alone'],
    rows,
  );
}
