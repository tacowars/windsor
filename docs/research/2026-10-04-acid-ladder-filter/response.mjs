/* global process */
/**
 * The Acid Ladder's small-signal response on each solver candidate
 * (windsor#573, reading 1): a sine of 1e-4 through the bundle's `Ladder`
 * against the analog 1 / (D(s) + k HP(s)) at the bilinear image of the
 * candidate's step rate (M f_s), 100 Hz to 2 f_c (or 0.46 f_s), f_c 500 Hz, 2 kHz, 10 kHz and
 * 18 kHz (held to the candidate's cap), k 0, 8 and 16. Reported: the
 * largest gap in dB and in degrees per candidate and cutoff. The shipped
 * candidate's is also `ladder.test.ts`'s assertion; the 2× one's carries
 * its linear interpolation and its decimator, so its phase shows them.
 *
 *   node response.mjs <repo>
 */
import { CANDIDATES, SR, candidate, loadBundle, step } from './bundle.mjs';

const root = process.argv[2] ?? '.';
const { Ladder } = loadBundle(root);

const D = [1, 4 * 2 ** 0.75, 10 * Math.SQRT2, 8 * 2 ** 0.25, 1];
const image = (hz, rate) => Math.tan((Math.PI * hz) / rate);

function analog(hz, fc, k, rate) {
  const w = image(hz, rate) / image(fc, rate);
  const whp = image(150, rate) / image(fc, rate);
  let re = 0;
  let im = 0;
  for (const c of D) [re, im] = [-im * w + c, re * w];
  // HP = jw / (whp + jw)
  const den = whp * whp + w * w;
  const hpRe = (w * w) / den;
  const hpIm = (w * whp) / den;
  const r = re + k * hpRe;
  const i = im + k * hpIm;
  const mag = 1 / Math.hypot(r, i);
  return { db: 20 * Math.log10(mag), deg: (Math.atan2(-i, r) * 180) / Math.PI };
}

function measured(ladder, hz) {
  ladder.reset();
  const warm = SR / 5;
  const n = SR / 4;
  let re = 0;
  let im = 0;
  for (let i = 0; i < warm + n; i++) {
    const phase = (2 * Math.PI * hz * i) / SR;
    const y = step(ladder, 1e-4 * Math.sin(phase));
    if (i < warm) continue;
    re += y * Math.sin(phase);
    im += y * Math.cos(phase);
  }
  return { db: 20 * Math.log10((2 * Math.hypot(re, im)) / n / 1e-4), deg: (Math.atan2(im, re) * 180) / Math.PI };
}

const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

for (const [name, c] of Object.entries(CANDIDATES)) {
  for (const cutoffHz of [500, 2000, 10000, 18000]) {
    const fc = Math.min(cutoffHz, c.capHz);
    let worstDb = 0;
    let worstDeg = 0;
    for (const k of [0, 8, 16]) {
      const ladder = candidate(new Ladder(), name, { cutoffHz, k });
      const top = Math.min(2 * fc, 0.46 * SR);
      for (let j = 0; j <= 15; j++) {
        const hz = 4 * Math.round((100 * (top / 100) ** (j / 15)) / 4);
        const got = measured(ladder, hz);
        const want = analog(hz, fc, k, SR * c.oversample);
        worstDb = Math.max(worstDb, Math.abs(got.db - want.db));
        worstDeg = Math.max(worstDeg, Math.abs(wrap(got.deg - want.deg)));
      }
    }
    process.stdout.write(
      `${name} at ${String(cutoffHz).padStart(5)} Hz${fc < cutoffHz ? ` (plays ${fc})` : ''}: ` +
        `${worstDb.toFixed(3)} dB, ${worstDeg.toFixed(2)}°\n`,
    );
  }
}
