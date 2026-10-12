// The figures the voicing's criteria read (windsor#746), each taking a
// `voicing` (0 plate, 1 room) beside the space: windsor#763's side lead and
// mirror, the tests' held-sine beat (`mixer/reverbModulationSpread.test.ts`,
// the same arithmetic), a centred click's level and balance, and the mono sum
// of centred noise. `main`'s bundle has no `voicing` parameter and ignores it.
import { clickSecond, clickWindows, noiseFigures } from '../2026-10-12-plate-stereo-input/measure.mjs';
import { BLOCK, render } from '../2026-10-12-plate-stereo-input/rig.mjs';

export const WINDOWS = [
  [0, 50],
  [50, 200],
  [200, 1000],
];

const db = (ratio) => 10 * Math.log10(ratio);

/**
 * windsor#763's cells at `build` and `size`: each side's lead in each window
 * (fed over the other, dB) and the mirror (L alone's left over R alone's
 * right, dB).
 */
export function sideCell(plate, voicing, build, size) {
  const l = clickWindows(plate, { size, build, voicing }, 'left', WINDOWS);
  const r = clickWindows(plate, { size, build, voicing }, 'right', WINDOWS);
  return {
    leadL: l.map((w) => db(w.l / w.r)),
    leadR: r.map((w) => db(w.r / w.l)),
    mirror: l.map((w, i) => db(w.l / r[i].r)),
  };
}

/** One centred click's wet RMS over its first second (both sides) and its balance, L over R in dB. */
export function centred(plate, voicing, params = {}) {
  const c = clickSecond(plate, { ...params, voicing }, 'centred');
  return { rms: Math.sqrt((c.rmsL ** 2 + c.rmsR ** 2) / 2), balance: db((c.rmsL / c.rmsR) ** 2) };
}

/** 10 s of centred noise: the balance, the mono sum's RMS and its third-octave energies. */
export function mono(plate, voicing, params = {}) {
  const n = noiseFigures(plate, { ...params, voicing }, 'centred');
  return { balance: db((n.rmsL / n.rmsR) ** 2), rms: n.rmsMono, bands: n.bands, corr: n.corr };
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos((-2 * Math.PI * k) / size);
        const wi = Math.sin((-2 * Math.PI * k) / size);
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/**
 * A 1 kHz sine at 0.3 held under HOLD from 1.9 s: the strongest component
 * between 0.1 and 10 Hz of its wet envelope (RMS over 10 ms) from 3 s to 33 s,
 * in dB re the envelope's mean, Welch over 10 s segments, the louder side.
 */
export function heldBeat(plate, voicing, params = {}) {
  const rate = plate.sampleRate;
  const r = render(plate, 33.5, { ...params, voicing }, {
    feed: (b, l, rr) => {
      for (let i = 0; i < BLOCK; i++) {
        const at = b * BLOCK + i;
        if (at >= 2 * rate) return;
        l[i] = rr[i] = Math.sin((2 * Math.PI * 1000 * at) / rate) * 0.3;
      }
    },
    automate: (b, values) => {
      values.hold[0] = b >= Math.round((1.9 * rate) / BLOCK) ? 1 : 0;
    },
  });
  const window = rate / 100;
  return Math.max(
    ...[r.L, r.R].map((x) => {
      const from = 3 * rate;
      const envelope = new Float64Array(30 * 100);
      for (let w = 0; w < envelope.length; w++) {
        let e = 0;
        for (let i = 0; i < window; i++) e += x[from + w * window + i] ** 2;
        envelope[w] = Math.sqrt(e / window);
      }
      const mean = envelope.reduce((a, b) => a + b, 0) / envelope.length;
      const segment = 1000;
      const size = 1024;
      const power = new Float64Array(size / 2);
      const re = new Float64Array(size);
      const im = new Float64Array(size);
      let gain = 0;
      for (let i = 0; i < segment; i++) gain += 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (segment - 1));
      let count = 0;
      for (let at = 0; at + segment <= envelope.length; at += segment / 2) {
        re.fill(0);
        im.fill(0);
        for (let i = 0; i < segment; i++) {
          re[i] = (envelope[at + i] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (segment - 1)));
        }
        fft(re, im);
        for (let k = 0; k < size / 2; k++) power[k] += re[k] ** 2 + im[k] ** 2;
        count++;
      }
      let strongest = 0;
      for (let k = 1; k < size / 2; k++) {
        const hz = (k * 100) / size;
        if (hz < 0.1 || hz > 10) continue;
        strongest = Math.max(strongest, (2 * Math.sqrt(power[k] / count)) / gain);
      }
      return 20 * Math.log10(strongest / mean);
    }),
  );
}
