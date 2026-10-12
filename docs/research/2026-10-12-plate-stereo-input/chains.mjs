/* global process, console */
// The right chain's lengths (windsor#763), chosen by measurement: candidate
// sets of four lengths, each its left counterpart (INPUT_DELAYS) times a
// factor drawn from 0.85 to 0.97 or 1.03 to 1.15, are patched into the new
// bundle and read at the default space against `main`'s bundle:
//   corr   the wet's L/R correlation on 10 s of centred noise (main's beside it)
//   mono   the mono sum's level against main's, dB, on that noise
//   worst  its lowest third-octave band against main's, dB (100 Hz to 10 kHz)
//   bal    |L/R| of the wet on that noise, dB
//   mirror the largest gap between L alone's fed side and R alone's, over the
//          0-50, 50-200 and 200-1000 ms windows of a click and Size 0.25, 1
//          and 4, dB, at Build 0 and at Build 1
//   t30    the largest |T30 / Decay − 1| at Decay 2 s, Size 0.25, 1 and 4,
//          Build 0, 0.5 and 1, a centred and a hard-left click (tank filters
//          open, no modulation, as `mixer/reverbBuild.test.ts` reads it)
//   rise   the largest fall, ms, of the time to the wet envelope's peak as
//          Build steps by 0.1 on `hall` and `plate` (Build's own criterion:
//          never more than one 10 ms window)
// `invert` also tries each set with the left loop's injection inverted.
// A set whose mirror at Build 0 is over 1.25 dB skips the last two columns.
// node chains.mjs <new bundle> <main bundle> [count] [invert] [seed]
import { loadPlate } from './rig.mjs';
import { clickT30, clickWindows, db, noiseFigures, riseMs, SPACES } from './measure.mjs';

const [file, mainFile, countArg = '40', invertArg, seedArg = '7'] = process.argv.slice(2);
const LEFT = [0.004771345, 0.003595309, 0.012734787, 0.009307483];
const WINDOWS = [
  [0, 50],
  [50, 200],
  [200, 1000],
];

let seed = Number(seedArg);
const rnd = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const factor = () => {
  const f = 0.03 + rnd() * 0.12;
  return rnd() < 0.5 ? 1 - f : 1 + f;
};

const candidates = [];
for (let c = 0; c < Number(countArg); c++) {
  candidates.push(LEFT.map((s) => Number((s * factor()).toFixed(6))));
}

const patchFor = (set, invert) => (source) => {
  let out = source.replace(
    /var INPUT_DELAYS_RIGHT = \[[^\]]*\];/,
    `var INPUT_DELAYS_RIGHT = [${set.join(', ')}];`,
  );
  if (invert) out = out.replace('const splitLeft = buildRight +', 'const splitLeft = -buildRight +');
  return out;
};

const main = loadPlate(mainFile);
const base = noiseFigures(main, {}, 'centred');

function mirror(plate, build) {
  let worst = 0;
  for (const size of [0.25, 1, 4]) {
    const l = clickWindows(plate, { size, build }, 'left', WINDOWS);
    const r = clickWindows(plate, { size, build }, 'right', WINDOWS);
    worst = Math.max(worst, ...l.map((w, i) => Math.abs(db(w.l / r[i].r))));
  }
  return worst;
}

function t30Worst(plate) {
  let worst = 0;
  for (const size of [0.25, 1, 4]) {
    for (const build of [0, 0.5, 1]) {
      for (const side of ['centred', 'left']) {
        const params = { tankLowCut: 10, tankHighCut: 20000, modDepth: 0, decay: 2, size, build };
        worst = Math.max(worst, Math.abs(clickT30(plate, params, side, 6.5) / 2 - 1));
      }
    }
  }
  return worst;
}

function riseFall(plate) {
  let worst = 0;
  for (const space of [SPACES.hall, SPACES.plate]) {
    const rise = Array.from({ length: 11 }, (_, i) => riseMs(plate, { ...space, build: i / 10 }));
    for (let i = 1; i < rise.length; i++) worst = Math.max(worst, rise[i - 1] - rise[i]);
  }
  return worst;
}

console.log(`main corr ${base.corr.toFixed(3)}`);
console.log('set\tinvert\tcorr\tmono\tworst\tbal\tmirror0\tmirror1\tt30\trise');
for (const set of candidates) {
  for (const invert of invertArg === 'invert' ? [false, true] : [false]) {
    const plate = loadPlate(file, 48000, patchFor(set, invert));
    const n = noiseFigures(plate, {}, 'centred');
    const worst = Math.min(...n.bands.map((e, i) => db(e / base.bands[i])));
    const mirror0 = mirror(plate, 0);
    const late = mirror0 <= 1.25;
    console.log(
      [
        set.join(','),
        invert ? 'yes' : 'no',
        n.corr.toFixed(3),
        db((n.rmsMono / base.rmsMono) ** 2).toFixed(2),
        worst.toFixed(2),
        Math.abs(db((n.rmsL / n.rmsR) ** 2)).toFixed(2),
        mirror0.toFixed(2),
        mirror(plate, 1).toFixed(2),
        late ? t30Worst(plate).toFixed(3) : '-',
        late ? riseFall(plate) : '-',
      ].join('\t'),
    );
  }
}
