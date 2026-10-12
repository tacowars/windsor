// The figures windsor#763's criteria read off a stereo render, shared by
// `chains.mjs` (the right chain's lengths), `criteria.mjs` (the note's
// tables) and `sweep.mjs` (the whole box).
import {
  BLOCK,
  CASES,
  clickAt,
  correlation,
  db,
  energy,
  noiseFrom,
  render,
  t30,
} from './rig.mjs';

/** Seconds the plate settles at its Size and Build before the input. */
export const SETTLE = 0.5;

const settleBlocks = (rate) => Math.round((SETTLE * rate) / BLOCK);

/** Sample where the input lands, plus the pre-delay: every window is read from here. */
const origin = (rate, preDelay) =>
  settleBlocks(rate) * BLOCK + Math.round((preDelay ?? 0) * rate);

/**
 * One click on `side` ('left', 'right', 'centred', 'anti'), and the wet L and
 * R energy in each of `windows` (ms pairs) from the end of the pre-delay.
 */
export function clickWindows(plate, params, side, windows, extra = {}) {
  const rate = plate.sampleRate;
  const last = Math.max(...windows.map(([, to]) => to)) / 1000;
  const r = render(plate, SETTLE + (params.preDelay ?? 0) + last + 0.01, params, {
    feed: clickAt(settleBlocks(rate), CASES[side]),
    ...extra,
  });
  const from = origin(rate, params.preDelay);
  return windows.map(([a, b]) => {
    const lo = from + Math.round((a * rate) / 1000);
    const hi = from + Math.round((b * rate) / 1000);
    return { l: energy(r.L, lo, hi), r: energy(r.R, lo, hi) };
  });
}

/** The third-octave centres from 100 Hz to 10 kHz. */
export const THIRDS = [
  100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000,
  6300, 8000, 10000,
];

function biquad(x, kind, hz, rate) {
  const w = (2 * Math.PI * hz) / rate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / Math.SQRT2;
  const edge = kind === 'lp' ? (1 - cos) / 2 : (1 + cos) / 2;
  const b = [edge, kind === 'lp' ? 2 * edge : -2 * edge, edge].map((v) => v / (1 + alpha));
  const a1 = (-2 * cos) / (1 + alpha);
  const a2 = (1 - alpha) / (1 + alpha);
  const y = new Float64Array(x.length);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const out = b[0] * x[i] + z1;
    z1 = b[1] * x[i] - a1 * out + z2;
    z2 = b[2] * x[i] - a2 * out;
    y[i] = out;
  }
  return y;
}

/** Energy in the third-octave around `hz`: fourth-order edges a sixth of an octave either side. */
export function thirdEnergy(x, hz, rate) {
  const low = hz / 2 ** (1 / 6);
  const high = hz * 2 ** (1 / 6);
  const y = biquad(biquad(biquad(biquad(x, 'lp', high, rate), 'lp', high, rate), 'hp', low, rate), 'hp', low, rate);
  return energy(y);
}

/**
 * Ten seconds of noise on `side` (a channel count of 1 feeds L alone into a
 * one-channel input), read from its start to a second past its end: the wet
 * L and R RMS, their correlation, the mono sum's RMS and its third-octave
 * energies.
 */
export function noiseFigures(plate, params, side, { channels = 2, seconds = 10, bands = true } = {}) {
  const rate = plate.sampleRate;
  const r = render(plate, SETTLE + seconds + 1, params, {
    feed: noiseFrom(settleBlocks(rate), seconds, CASES[side], rate),
    channels,
  });
  const from = settleBlocks(rate) * BLOCK;
  const to = from + Math.round((seconds + 1) * rate);
  const n = to - from;
  const mono = new Float64Array(n);
  for (let i = 0; i < n; i++) mono[i] = (r.L[from + i] + r.R[from + i]) / 2;
  return {
    rmsL: Math.sqrt(energy(r.L, from, to) / n),
    rmsR: Math.sqrt(energy(r.R, from, to) / n),
    corr: correlation(r.L, r.R, from, to),
    rmsMono: Math.sqrt(energy(mono) / n),
    bands: bands ? THIRDS.map((hz) => thirdEnergy(mono, hz, rate)) : [],
  };
}

/** One click on `side`: the wet L and R RMS and the mono sum's RMS over the first second. */
export function clickSecond(plate, params, side, extra = {}) {
  const rate = plate.sampleRate;
  const r = render(plate, SETTLE + (params.preDelay ?? 0) + 1.01, params, {
    feed: clickAt(settleBlocks(rate), CASES[side]),
    ...extra,
  });
  const from = origin(rate, params.preDelay);
  const to = from + rate;
  let mono = 0;
  for (let i = from; i < to; i++) mono += ((r.L[i] + r.R[i]) / 2) ** 2;
  return {
    rmsL: Math.sqrt(energy(r.L, from, to) / rate),
    rmsR: Math.sqrt(energy(r.R, from, to) / rate),
    rmsMono: Math.sqrt(mono / rate),
  };
}

/** T30 of one click on `side`, rendered for `seconds` after it. */
export function clickT30(plate, params, side, seconds) {
  const rate = plate.sampleRate;
  const r = render(plate, SETTLE + (params.preDelay ?? 0) + seconds, params, {
    feed: clickAt(settleBlocks(rate), CASES[side]),
  });
  return t30(r.L, r.R, origin(rate, params.preDelay), rate);
}

/** `mixer/reverbSpace.ts`'s `plate` and `hall`, over its defaults, for the Build rise. */
export const SPACES = {
  plate: {
    size: 0.5,
    decay: 1.25,
    preDelay: 0.005,
    inputLowCut: 100,
    inputHighCut: 12000,
    tankLowCut: 120,
    tankHighCut: 7000,
    modRate: 1,
    modDepth: 0.5,
  },
  hall: {
    size: 1.4,
    decay: 6.35,
    preDelay: 0.025,
    inputLowCut: 60,
    tankLowCut: 60,
    tankHighCut: 6500,
    modDepth: 0.8,
  },
};

/**
 * The time to the wet envelope's peak for one centred click, as
 * `mixer/reverbBuild.test.ts` reads it: the first 10 ms window at which the
 * envelope (each window's energy averaged with two either side) comes within
 * 1 dB of its peak.
 */
export function riseMs(plate, params) {
  const w = clickWindows(
    plate,
    params,
    'centred',
    Array.from({ length: 100 }, (_, i) => [i * 10, (i + 1) * 10]),
  ).map(({ l, r }) => l + r);
  const envelope = w.map((_, i) => {
    const near = w.slice(Math.max(0, i - 2), i + 3);
    return near.reduce((s, e) => s + e, 0) / near.length;
  });
  const top = Math.max(...envelope);
  return envelope.findIndex((e) => e >= top * 10 ** -0.1) * 10;
}

export { db };
