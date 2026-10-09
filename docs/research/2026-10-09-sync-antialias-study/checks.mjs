/* global process, console */
/**
 * Decision 4's correctness checks (windsor#652), which the alias metric
 * cannot make. Research only.
 *
 *   node docs/research/2026-10-09-sync-antialias-study/checks.mjs [--variants A,C,B2,B4,AB2]
 *
 * 1. **Against the table path at a low note** (MIDI 36, a synced carrier at
 *    ratio 1 and at 3.7): each variant's peak, mean and its first ten
 *    harmonics' level and phase against shipped's, where both are band
 *    limited alike.
 * 2. **Against the 16× reference's waveform** (MIDI 72 and 84, ratio 3.7):
 *    the error energy under the reference's, and the correlation, for each
 *    variant and for A inverted. A sine and its inverse score the same alias
 *    figure; they do not score the same here.
 * 3. **Brightness**: the harmonic energy in four bands against the
 *    reference's, MIDI 72 and 84, ratio 3.7.
 *
 * Renders are aligned (`render.mjs`), so A is compared a sample after the
 * table path's instant has been taken out. Every figure skips the first
 * 0.1 s and reads 0.5 s.
 */
import { syncedCarrier } from './fallbackPatches.mjs';
import { SR, noteHz, renderNote, variant } from './render.mjs';
import { powerSpectrum } from './spectrum.mjs';

const WAVES = { saw: 1, square: 2, pulse: 10 };
const FROM = 4800;
const LEN = 24000;
const HARMONICS = 10;
const BANDS = [0, 5000, 10000, 15000, 20000];

const args = { variants: 'A,C,B2,B4,AB2', repo: '.' };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
}
const names = args.variants.split(',');
const db = (r) => 10 * Math.log10(r);

const carrier = (wave, ratio) => syncedCarrier(WAVES[wave], ratio, wave === 'pulse' ? 0.3 : 1);
const render = (name, wave, note, ratio) =>
  renderNote(variant(args.repo, name), carrier(wave, ratio), note, (FROM + LEN) / SR + 0.01);

/** Harmonic `h` of `f0` in `x`: a Hann-windowed projection, amplitude and phase. */
function harmonic(x, f0, h) {
  let re = 0;
  let im = 0;
  let wsum = 0;
  for (let n = 0; n < LEN; n++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (LEN - 1));
    const p = (2 * Math.PI * f0 * h * (FROM + n)) / SR;
    re += w * x[FROM + n] * Math.cos(p);
    im -= w * x[FROM + n] * Math.sin(p);
    wsum += w;
  }
  return { amp: (2 * Math.hypot(re, im)) / wsum, phase: Math.atan2(im, re) };
}

/** Peak, mean, and the worst level (dB) and phase (degrees) gap of `x` from `ref` over ten harmonics. */
function againstTable(x, ref, f0) {
  const seg = (y) => y.subarray(FROM, FROM + LEN);
  const peak = (y) => seg(y).reduce((m, s) => Math.max(m, Math.abs(s)), 0);
  const mean = (y) => seg(y).reduce((m, s) => m + s, 0) / LEN;
  let level = 0;
  let phase = 0;
  for (let h = 1; h <= HARMONICS; h++) {
    const a = harmonic(x, f0, h);
    const b = harmonic(ref, f0, h);
    if (b.amp < 1e-3) continue;
    level = Math.max(level, Math.abs(20 * Math.log10(a.amp / b.amp)));
    let d = ((a.phase - b.phase) * 180) / Math.PI;
    d = ((d + 540) % 360) - 180;
    phase = Math.max(phase, Math.abs(d));
  }
  return { peak: [peak(x), peak(ref)], mean: [mean(x), mean(ref)], level, phase };
}

/** The error energy of `x` under `ref`'s, in dB, and their correlation. */
function againstReference(x, ref) {
  let e = 0;
  let r = 0;
  let xx = 0;
  let xr = 0;
  for (let n = FROM; n < FROM + LEN; n++) {
    e += (x[n] - ref[n]) ** 2;
    r += ref[n] ** 2;
    xx += x[n] ** 2;
    xr += x[n] * ref[n];
  }
  return { error: db(e / r), corr: xr / Math.sqrt(xx * r) };
}

/** The harmonic energy in each band of `x` over `ref`'s, in dB. */
function bandLevels(x, ref, f0) {
  const n = 16384;
  const px = powerSpectrum(x, FROM, n);
  const pr = powerSpectrum(ref, FROM, n);
  const binHz = SR / n;
  const sums = BANDS.slice(1).map(() => [0, 0]);
  for (let k = 1; k < n / 2; k++) {
    const f = k * binHz;
    const h = Math.round(f / f0);
    if (h < 1 || Math.abs(k - (h * f0) / binHz) > 6 || f >= BANDS.at(-1)) continue;
    const band = BANDS.findIndex((b, j) => f >= b && f < BANDS[j + 1]);
    sums[band][0] += px[k];
    sums[band][1] += pr[k];
  }
  return sums.map(([a, b]) => (b > 0 ? db(a / b).toFixed(2) : '—'));
}

function section1() {
  console.log('\n1. Against the table path, MIDI 36: peak, mean, worst gap over harmonics 1-10');
  console.log(
    '| Variant | Wave | Ratio | Peak (variant / shipped) | Mean (variant / shipped) | Level gap dB | Phase gap ° |',
  );
  console.log('|---|---|---|---|---|---|---|');
  for (const ratio of [1, 3.7]) {
    for (const wave of Object.keys(WAVES)) {
      const ref = render('shipped', wave, 36, ratio);
      for (const name of names) {
        const c = againstTable(render(name, wave, 36, ratio), ref, noteHz(36));
        const pair = ([a, b], d) => `${a.toFixed(d)} / ${b.toFixed(d)}`;
        console.log(
          `| ${name} | ${wave} | ${ratio} | ${pair(c.peak, 3)} | ${pair(c.mean, 4)} | ${c.level.toFixed(2)} | ${c.phase.toFixed(1)} |`,
        );
      }
    }
  }
}

function sections23() {
  console.log('\n2. Against the 16x reference: error energy under it (dB) and correlation');
  console.log('3. Harmonic energy against it, per band (dB): 0-5k, 5-10k, 10-15k, 15-20k');
  console.log(
    '| Variant | Wave | Note | Error dB | Correlation | 0-5k | 5-10k | 10-15k | 15-20k |',
  );
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const note of [72, 84]) {
    for (const wave of Object.keys(WAVES)) {
      const ref = render('ref16', wave, note, 3.7);
      for (const name of ['shipped', ...names, '-A']) {
        const x =
          name === '-A'
            ? render('A', wave, note, 3.7).map((s) => -s)
            : render(name, wave, note, 3.7);
        const r = againstReference(x, ref);
        const bands = bandLevels(x, ref, noteHz(note));
        console.log(
          `| ${name} | ${wave} | ${note} | ${r.error.toFixed(1)} | ${r.corr.toFixed(4)} | ${bands.join(' | ')} |`,
        );
      }
    }
  }
}

section1();
sections23();
