/* global process, console */
/**
 * Hard sync's folded alias energy (windsor#646, record decision 13), on the
 * shipped FM bundle under Node. Research only.
 *
 *   node alias.mjs <repo> [--notes 60,72,84,96] [--ratio 3.7]
 *
 * One operator, a carrier at `ratio` synced to the note, held at full level,
 * the voice filter off (a Pulse at a 0.3 duty, every other wave unsqueezed),
 * rendered at each note four ways:
 *
 * - `raw`: 48 kHz with the polyBLEP's gain at 0 (every reset uncorrected);
 * - `shipped`: 48 kHz as shipped (the Sine and Triangle corrected, the Saw,
 *   Square and Pulse not, so for those it is `raw`);
 * - `forced`: the Saw and Square at 48 kHz with their resets corrected as the
 *   Sine's are, which the shipped bundle does not do;
 * - `ref`: 768 kHz (16×) as shipped, decimated to 48 kHz through a
 *   2 049-tap Blackman-windowed sinc lowpass at 22 kHz.
 *
 * Synced to the note, the wave repeats at the note's period, so every
 * component that is not a harmonic of the note is folded alias. Each render
 * is analysed over 32 768 samples from 0.1 s in, through a four-term
 * Blackman-Harris window: the energy within ±6 bins of each harmonic is the
 * signal, everything else from 20 Hz to 20 kHz the alias, reported in dB
 * under the signal. The reference's figure is the measurement's floor.
 */
import {
  BLOCK,
  bundleText,
  processorClass,
  renderNote,
  withEveryTableCorrected,
  withoutBlep,
} from './workletBundle.mjs';

const SR = 48000;
const OVERSAMPLE = 16;
const TAPS = 2049;
const CUTOFF_HZ = 22000;
const SKIP = 4800;
const N = 32768;
const HARMONIC_HALF_WIDTH = 6;
const BAND = { from: 20, to: 20000 };
/** The corrected waves, then the three the shipped bundle leaves uncorrected. */
const WAVES = { sine: 0, triangle: 3, saw: 1, square: 2, pulse: 10 };
/** The waves the shipped bundle leaves uncorrected that `forced` corrects. */
const FORCED = new Set(['saw', 'square']);
const PULSE = 10;
const PULSE_DUTY = 0.3;

function parseArgs(argv) {
  const options = { notes: '60,72,84,96', ratio: '3.7' };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) options[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  if (positional.length !== 1) {
    process.stderr.write('usage: node alias.mjs <repo> [--notes 60,72,84,96] [--ratio 3.7]\n');
    process.exit(2);
  }
  return {
    repo: positional[0],
    notes: options.notes.split(',').map(Number),
    ratio: Number(options.ratio),
  };
}

/** One synced carrier on `wave` at `ratio`, held. */
function syncedCarrier(wave, ratio) {
  const env = { attackTime: 0, decayTime: 0.01, sustainLevel: 1, releaseTime: 0.1 };
  const silent = { level: 0 };
  const width = wave === PULSE ? PULSE_DUTY : 1;
  return {
    algorithm: 0,
    filter: { mode: 0 },
    ops: [{ wave, ratio, level: 1, velSens: 0, width, sync: 'note', env }, silent, silent, silent],
  };
}

/** A Blackman-windowed sinc lowpass at `cutoff` Hz for `rate`, unity at DC. */
function lowpass(cutoff, rate, taps) {
  const h = new Float64Array(taps);
  const mid = (taps - 1) / 2;
  const fc = cutoff / rate;
  let sum = 0;
  for (let k = 0; k < taps; k++) {
    const t = k - mid;
    const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    const w =
      0.42 - 0.5 * Math.cos((2 * Math.PI * k) / (taps - 1)) +
      0.08 * Math.cos((4 * Math.PI * k) / (taps - 1));
    h[k] = sinc * w;
    sum += h[k];
  }
  for (let k = 0; k < taps; k++) h[k] /= sum;
  return h;
}

/** `x` at `factor` times the rate, filtered by `h` and kept every `factor`-th sample. */
function decimate(x, h, factor) {
  const out = new Float64Array(Math.floor((x.length - h.length) / factor));
  for (let m = 0; m < out.length; m++) {
    let acc = 0;
    const at = m * factor;
    for (let k = 0; k < h.length; k++) acc += h[k] * x[at + k];
    out[m] = acc;
  }
  return out;
}

/** The power spectrum of `x` (length a power of two) through a four-term Blackman-Harris window. */
function powerSpectrum(x) {
  const n = x.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const a = [0.35875, 0.48829, 0.14128, 0.01168];
  for (let k = 0; k < n; k++) {
    const p = (2 * Math.PI * k) / (n - 1);
    re[k] = x[k] * (a[0] - a[1] * Math.cos(p) + a[2] * Math.cos(2 * p) - a[3] * Math.cos(3 * p));
  }
  fft(re, im);
  const power = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];
  return power;
}

/** In-place iterative radix-2 FFT. */
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
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const ai = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
      }
    }
  }
}

/** The alias energy under the harmonic energy, in dB, of a render at 48 kHz playing `f0`. */
function aliasDb(x, f0) {
  const power = powerSpectrum(x.subarray(SKIP, SKIP + N));
  const binHz = SR / N;
  let signal = 0;
  let alias = 0;
  for (let k = Math.ceil(BAND.from / binHz); k <= BAND.to / binHz; k++) {
    const h = Math.round((k * binHz) / f0);
    const harmonic = h >= 1 && Math.abs(k - (h * f0) / binHz) <= HARMONIC_HALF_WIDTH;
    if (harmonic) signal += power[k];
    else alias += power[k];
  }
  return 10 * Math.log10(alias / signal);
}

const args = parseArgs(process.argv.slice(2));
const text = bundleText(args.repo);
const at48 = processorClass(text, SR);
const raw48 = processorClass(withoutBlep(text), SR);
const forced48 = processorClass(withEveryTableCorrected(text), SR);
const at768 = processorClass(text, SR * OVERSAMPLE);
const h = lowpass(CUTOFF_HZ, SR * OVERSAMPLE, TAPS);
const frames = SKIP + N;
console.log(`ratio ${args.ratio}, ${SR} Hz, block ${BLOCK}; alias under signal in dB`);
console.log('| Wave | Note | Uncorrected | Shipped | Forced | 16x reference | Removed |');
console.log('|---|---|---|---|---|---|---|');
for (const note of args.notes) {
  const f0 = 440 * 2 ** ((note - 69) / 12);
  for (const [name, wave] of Object.entries(WAVES)) {
    const patch = syncedCarrier(wave, args.ratio);
    const raw = aliasDb(renderNote(raw48, patch, note, frames), f0);
    const shipped = aliasDb(renderNote(at48, patch, note, frames), f0);
    const forced = FORCED.has(name) ? aliasDb(renderNote(forced48, patch, note, frames), f0) : NaN;
    const long = renderNote(at768, patch, note, frames * OVERSAMPLE + TAPS);
    const ref = aliasDb(decimate(long, h, OVERSAMPLE), f0);
    const cells = [raw, shipped, forced, ref, raw - shipped].map((v) =>
      Number.isNaN(v) ? '—' : v.toFixed(1),
    );
    console.log(`| ${name} | ${note} | ${cells.join(' | ')} |`);
  }
}
