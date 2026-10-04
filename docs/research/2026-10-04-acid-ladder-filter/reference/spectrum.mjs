/**
 * The measurements `compare.mjs` takes of one held note (windsor#574): a WAV
 * read as written (never normalised), a Hann-windowed spectrum of a window
 * inside the note, the level of each harmonic of its fundamental, the
 * spectral centroid, and the resonance's emphasis against the same note at
 * 0 % resonance. Pure arithmetic over `Float32Array`s; the ACB recordings and
 * Windsor's renders go through the same functions.
 */
import { readFileSync } from 'node:fs';

/** The transform's length: a 1.3 s window at 48 kHz zero-padded about four times. */
export const FFT_SIZE = 1 << 18;
/** The level a harmonic reads at when nothing is there, so a log never sees 0. */
const FLOOR_DB = -200;
/** The centroid's band, Hz. */
const CENTROID_BAND = [20, 20000];

/**
 * A WAV's first channel as written: 32-bit float (format 3, or extensible
 * with a float subformat) or 16/24-bit PCM. The eight ACB files are 48 kHz
 * float stereo with identical channels (`settings.txt`).
 */
export function readWav(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path}: not a RIFF WAVE file`);
  }
  let fmt = null;
  for (let at = 12; at + 8 <= b.length; ) {
    const id = b.toString('ascii', at, at + 4);
    const size = b.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ') fmt = readFormat(b, body);
    if (id === 'data') return { rate: fmt.rate, samples: readSamples(b, body, size, fmt) };
    at = body + size + (size & 1);
  }
  throw new Error(`${path}: no data chunk`);
}

function readFormat(b, at) {
  let tag = b.readUInt16LE(at);
  // WAVE_FORMAT_EXTENSIBLE: the subformat GUID's first two bytes are the tag.
  if (tag === 0xfffe) tag = b.readUInt16LE(at + 24);
  return {
    tag,
    channels: b.readUInt16LE(at + 2),
    rate: b.readUInt32LE(at + 4),
    bits: b.readUInt16LE(at + 14),
  };
}

function readSamples(b, at, size, { tag, channels, bits }) {
  const bytes = bits / 8;
  const frames = Math.floor(size / (bytes * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const p = at + i * bytes * channels;
    if (tag === 3 && bits === 32) out[i] = b.readFloatLE(p);
    else if (tag === 1 && bits === 16) out[i] = b.readInt16LE(p) / 32768;
    else if (tag === 1 && bits === 24) out[i] = b.readIntLE(p, 3) / 8388608;
    else throw new Error(`unsupported WAV format ${tag}, ${bits} bits`);
  }
  return out;
}

/** In-place radix-2 FFT of `re`, `im` (length a power of two). */
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
    const twiddle = { len, wr: Math.cos(ang), wi: Math.sin(ang) };
    for (let i = 0; i < n; i += len) butterflies(re, im, i, twiddle);
  }
}

/** One block of `len` from `i`: its butterflies, the twiddle turning by `wr + j wi`. */
function butterflies(re, im, i, { len, wr, wi }) {
  let cr = 1;
  let ci = 0;
  const half = len >> 1;
  for (let k = 0; k < half; k++) {
    const a = i + k;
    const b = a + half;
    const tr = re[b] * cr - im[b] * ci;
    const ti = re[b] * ci + im[b] * cr;
    re[b] = re[a] - tr;
    im[b] = im[a] - ti;
    re[a] += tr;
    im[a] += ti;
    const next = cr * wr - ci * wi;
    ci = cr * wi + ci * wr;
    cr = next;
  }
}

/**
 * The magnitude spectrum of `samples[start, end)` under a Hann window,
 * scaled so a sine of amplitude A reads A at its bin: `{ mag, binHz }`.
 */
export function spectrum(samples, rate, start, end) {
  const n = end - start;
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  let gain = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re[i] = samples[start + i] * w;
    gain += w;
  }
  fft(re, im);
  const mag = new Float64Array(FFT_SIZE / 2);
  for (let k = 0; k < mag.length; k++) mag[k] = (2 * Math.hypot(re[k], im[k])) / gain;
  return { mag, binHz: rate / FFT_SIZE };
}

const db = (a) => (a > 0 ? 20 * Math.log10(a) : FLOOR_DB);

/** The loudest bin within `±spread` Hz of `hz`, its level parabola-interpolated in dB: `{ hz, db }`. */
function peakNear({ mag, binHz }, hz, spread) {
  const lo = Math.max(1, Math.floor((hz - spread) / binHz));
  const hi = Math.min(mag.length - 2, Math.ceil((hz + spread) / binHz));
  let best = lo;
  for (let k = lo + 1; k <= hi; k++) if (mag[k] > mag[best]) best = k;
  const a = db(mag[best - 1]);
  const b = db(mag[best]);
  const c = db(mag[best + 1]);
  const denom = a - 2 * b + c;
  // A true peak's vertex lies within half a bin; a flat or empty stretch has none.
  const shift = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  return { hz: (best + shift) * binHz, db: b - 0.25 * (a - c) * shift };
}

/**
 * The fundamental, refined from the nominal: the first harmonic's peak, then
 * each of the first eight harmonics' peaks divided by its number, averaged
 * with their amplitudes as weights.
 */
export function fundamental(spec, nominalHz) {
  const first = peakNear(spec, nominalHz, nominalHz * 0.03).hz;
  let sum = 0;
  let weight = 0;
  for (let h = 1; h <= 8; h++) {
    const p = peakNear(spec, first * h, first * 0.25);
    const w = 10 ** (p.db / 20);
    sum += (p.hz / h) * w;
    weight += w;
  }
  return sum / weight;
}

/** Every harmonic's level in dB below `maxHz` (index 0 is harmonic 1). */
export function harmonicLevels(spec, f0, maxHz) {
  const out = [];
  for (let h = 1; h * f0 < maxHz; h++) out.push(peakNear(spec, h * f0, f0 * 0.25).db);
  return out;
}

/** The amplitude-weighted mean frequency of the spectrum within `CENTROID_BAND`. */
export function centroid({ mag, binHz }) {
  let num = 0;
  let den = 0;
  const lo = Math.ceil(CENTROID_BAND[0] / binHz);
  const hi = Math.min(mag.length - 1, Math.floor(CENTROID_BAND[1] / binHz));
  for (let k = lo; k <= hi; k++) {
    num += k * binHz * mag[k];
    den += mag[k];
  }
  return den > 0 ? num / den : 0;
}

const power = (dbValue) => 10 ** (dbValue / 10);

/**
 * The resonance's emphasis: the group of up to three neighbouring harmonics
 * whose power rose most against the same note at 0 % resonance (`base`),
 * counting only the harmonics `base` holds above `floorDb` (a square's
 * missing even harmonics drop out of their group), its centre within `band`
 * (`[lo, hi]` Hz, everything when omitted). Returns the group's
 * power-weighted frequency and its lift in dB.
 */
export function emphasis(levels, base, f0, floorDb, band = [0, Infinity]) {
  const count = Math.min(levels.length, base.length);
  let best = null;
  for (let centre = 0; centre < count; centre++) {
    const centreHz = (centre + 1) * f0;
    if (centreHz < band[0] || centreHz > band[1]) continue;
    let now = 0;
    let then = 0;
    let moment = 0;
    for (let i = Math.max(0, centre - 1); i <= Math.min(count - 1, centre + 1); i++) {
      if (base[i] < floorDb) continue;
      now += power(levels[i]);
      then += power(base[i]);
      moment += (i + 1) * power(levels[i]);
    }
    if (then === 0) continue;
    const lift = 10 * Math.log10(now / then);
    if (!best || lift > best.lift) best = { hz: (f0 * moment) / now, lift };
  }
  return best ?? { hz: NaN, lift: NaN };
}

/** One held note's readings: its fundamental, harmonic levels (dB, absolute) and centroid. */
export function measureNote(samples, rate, { onset, from, to, nominalHz, maxHz }) {
  const start = Math.round((onset + from) * rate);
  const end = Math.round((onset + to) * rate);
  const spec = spectrum(samples, rate, start, end);
  const f0 = fundamental(spec, nominalHz);
  return { f0, levels: harmonicLevels(spec, f0, maxHz), centroid: centroid(spec) };
}

