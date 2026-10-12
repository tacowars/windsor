/* global process, console */
// The table search (windsor#766): draws candidate tables (`candidates.mjs`),
// patches each into the new bundle, and reads it against `main` at 48 kHz on
// the criteria the issue names: early density at Build 0 and 1 and Size 0.25,
// 1 and 4; the L/R correlation of 10 s of centred noise and its mono sum, in
// total and per third-octave band, at the same Sizes; and windsor#763's
// side-lead and mirror cells. Each table's trim is the one that puts a
// centred click's wet RMS over its first second at `main`'s, averaged in dB
// over Build 0, 0.5 and 1, and the mono figures are read at it. Prints one
// TSV row a table.
// node search.mjs <new bundle> <main bundle> <first seed> <count> '<draw options json>'
import { drawTable, shares } from './candidates.mjs';
import { db, earlyDensity, level, loadTable, sides, width } from './tapRig.mjs';

const SIZES = [0.25, 1, 4];
const BUILDS = [0, 1];
const LEVEL_BUILDS = [0, 0.5, 1];

/** Every figure the criteria read, for one plate. */
export function figures(plate) {
  return {
    density: BUILDS.flatMap((build) => SIZES.map((size) => earlyDensity(plate, { build, size }).count)),
    width: SIZES.map((size) => width(plate, size)),
    level: LEVEL_BUILDS.map((build) => level(plate, build)),
    sides: sides(plate),
  };
}

/**
 * The trim that matches `main`'s level, and each criterion's margin against
 * `main` (positive passes): density as the least ratio, correlation as
 * `main`'s less the new, the mono sum's total and least band in dB, and the
 * worst side-lead and mirror cell against the 0.5 dB allowance.
 */
export function compare(fig, base, trim = 0.6) {
  const gap = LEVEL_BUILDS.map((_, i) => db((base.level[i] / fig.level[i]) ** 2));
  const newTrim = trim * 10 ** (gap.reduce((s, g) => s + g, 0) / gap.length / 20);
  const scale = db((newTrim / trim) ** 2);
  const density = Math.min(...fig.density.map((d, i) => d / base.density[i]));
  const corr = Math.min(...fig.width.map((w, i) => base.width[i].corr - w.corr));
  const monoTotal = Math.max(
    ...fig.width.map((w, i) => Math.abs(db((w.mono / base.width[i].mono) ** 2) + scale)),
  );
  const monoBand = Math.min(
    ...fig.width.flatMap((w, i) => w.bands.map((e, k) => db(e / base.width[i].bands[k]) + scale)),
  );
  let lead = Infinity;
  let mirror = Infinity;
  fig.sides.forEach((cell, c) => {
    const b = base.sides[c];
    for (let w = 0; w < 3; w++) {
      // A lead over 300 dB is a window the other side hears nothing in: kept, or lost.
      const keep = (x, y) => (y > 300 ? (x > 300 ? 0.5 : -999) : x - y + 0.5);
      lead = Math.min(lead, keep(cell.leadL[w], b.leadL[w]), keep(cell.leadR[w], b.leadR[w]));
      mirror = Math.min(mirror, Math.abs(b.mirror[w]) + 0.5 - Math.abs(cell.mirror[w]));
    }
  });
  const level = gap.map((g) => g - scale);
  const densities = fig.density.map((d, i) => d / base.density[i]);
  return { trim: newTrim, density, densities, corr, monoTotal, monoBand, lead, mirror, level };
}

export function passes(c) {
  return c.density > 1 && c.corr >= 0 && c.monoTotal <= 1.5 && c.monoBand >= -3 && c.lead >= 0 && c.mirror >= 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, mainFile, firstArg, countArg, optsArg = '{}'] = process.argv.slice(2);
  const opts = JSON.parse(optsArg);
  const base = figures(loadTable(mainFile, 48000));
  console.log(
    ['seed', 'pass', 'trim', 'density', 'corr', 'monoTotal', 'monoBand', 'lead', 'mirror', 'share', 'densities', 'table'].join('\t'),
  );
  for (let seed = Number(firstArg); seed < Number(firstArg) + Number(countArg); seed++) {
    const table = drawTable({ ...opts, seed });
    if (!table) continue;
    const share = shares(table);
    if (share.some((s) => s.own <= s.other)) continue;
    const c = compare(figures(loadTable(file, 48000, table)), base);
    const f = (x, d = 3) => x.toFixed(d);
    console.log(
      [
        seed,
        passes(c) ? 'yes' : 'no',
        f(c.trim, 4),
        f(c.density),
        f(c.corr, 4),
        f(c.monoTotal, 2),
        f(c.monoBand, 2),
        f(c.lead, 2),
        f(c.mirror, 2),
        share.map((s) => `${s.own}/${s.other}`).join(' '),
        c.densities.map((d) => f(d, 2)).join(' '),
        JSON.stringify(table),
      ].join('\t'),
    );
  }
}
