/* global sampleRate */
/**
 * Waveforms (#644): the wave ids, the exact sine table, the bandlimited
 * per-octave mip tables built from harmonic partials, the cache that shares
 * them across every part in this worklet global scope, and the render kind an
 * operator's wave selects. PULSE (#55) is two reads of the saw set, so its
 * waves are the saw's and the cache holds one copy. Invariants: `SIN_TAB` and `WAVE_CACHE` are
 * single-instance module state, never duplicated; `WAVE` mirrors `patch.ts`
 * (`patch.test.ts` pins the copy until #656 shares it); the warm-up at the end
 * runs inside `addModule()`, never in a render. `fmProcessorUserWave.test.ts`
 * and the golden test pin the tables' contents.
 */

import { MIP_BASE_HZ, MIP_COUNT, TABLE_MASK, TABLE_SIZE } from './fmConstants';
import { WAVE } from './waveIds';

/* ------------------------------------------------------------------ *
 * Wavetable construction
 *
 * Every non-noise, non-digital waveform is a list of harmonic amplitudes
 * rendered into TABLE_SIZE samples, once per octave, with harmonics above
 * Nyquist dropped. `tone` (0..1) scales the surviving harmonic count, which
 * is the cheap global brightness / anti-alias control.
 * ------------------------------------------------------------------ */

/** Exact sine table; sin(2*pi*h*i/N) == SIN_TAB[(h*i) & TABLE_MASK] */
const SIN_TAB = new Float32Array(TABLE_SIZE);
for (let i = 0; i < TABLE_SIZE; i++) {
  SIN_TAB[i] = Math.sin((2 * Math.PI * i) / TABLE_SIZE);
}

/** Harmonic amplitude arrays. Index 0 is the fundamental. */
function partialsFor(waveId: number, userPartials: number[] | null): Float32Array {
  const N = TABLE_SIZE >> 1;
  const a = new Float32Array(N);
  switch (waveId) {
    case WAVE.SAW:
      for (let n = 1; n <= N; n++) a[n - 1] = 1 / n;
      break;
    case WAVE.SQUARE:
      for (let n = 1; n <= N; n += 2) a[n - 1] = 1 / n;
      break;
    case WAVE.TRIANGLE:
      for (let n = 1, s = 1; n <= N; n += 2, s = -s) a[n - 1] = s / (n * n);
      break;
    case WAVE.USER:
      if (userPartials) {
        for (let i = 0; i < Math.min(N, userPartials.length); i++) a[i] = userPartials[i];
      } else {
        a[0] = 1;
      }
      break;
    default: // SINE and the quantised sines start from a pure fundamental
      a[0] = 1;
      break;
  }
  return a;
}

/**
 * Build MIP_COUNT bandlimited tables. Each has one guard sample at the end so
 * linear interpolation never wraps-checks in the inner loop.
 */
function buildMips(partials: Float32Array, sampleRate: number, tone: number): Float32Array[] {
  const nyquist = sampleRate * 0.5;
  const maxPossible = TABLE_SIZE >> 1;
  const mips: Float32Array[] = new Array(MIP_COUNT);

  for (let k = 0; k < MIP_COUNT; k++) {
    const topHz = MIP_BASE_HZ * Math.pow(2, k + 1);
    let maxH = Math.floor(nyquist / topHz);
    maxH = Math.min(maxH, maxPossible, partials.length);
    maxH = Math.max(1, Math.floor(maxH * tone));

    const t = new Float32Array(TABLE_SIZE + 1);
    for (let h = 1; h <= maxH; h++) {
      const amp = partials[h - 1];
      if (amp === 0) continue;
      let idx = 0;
      for (let i = 0; i < TABLE_SIZE; i++) {
        t[i] += amp * SIN_TAB[idx];
        idx = (idx + h) & TABLE_MASK;
      }
    }

    let peak = 0;
    for (let i = 0; i < TABLE_SIZE; i++) {
      const v = t[i] < 0 ? -t[i] : t[i];
      if (v > peak) peak = v;
    }
    if (peak > 1e-9) {
      const g = 1 / peak;
      for (let i = 0; i < TABLE_SIZE; i++) t[i] *= g;
    }
    t[TABLE_SIZE] = t[0];
    mips[k] = t;
  }
  return mips;
}

/** Quantise a mip set in place to `levels` steps — the 4-bit / 8-bit sines. */
function quantiseMips(mips: Float32Array[], levels: number): Float32Array[] {
  for (let k = 0; k < mips.length; k++) {
    const t = mips[k];
    for (let i = 0; i <= TABLE_SIZE; i++) {
      t[i] = Math.round(t[i] * levels) / levels;
    }
  }
  return mips;
}

/**
 * Shared across every processor instance in this worklet global scope, so 16
 * parts using a saw pay for the tables once. Keyed by waveform + quantised tone,
 * and for a User wave by the partials themselves (#511). The key used to be the
 * patch's `userKey`, which only worked while every author picked a unique one:
 * a User wave left at the default '' shared the first such table built, and a
 * harmonic edit kept playing the old one. `null` (a sine) and `[]` (silence)
 * keep distinct keys. Equal partials still share a table,
 * so the scoring bank's User presets render exactly as before. Only a `patch`
 * message reaches here, never the audio loop, so the string is fine.
 */
const WAVE_CACHE = new Map<string, Float32Array[]>();
const WAVE_CACHE_LIMIT = 64;

function getMips(
  wave: number,
  sampleRate: number,
  tone: number,
  userPartials: number[] | null,
): Float32Array[] {
  // PULSE is two reads of the saw's tables (#55): one key, one copy.
  const waveId = wave === WAVE.PULSE ? WAVE.SAW : wave;
  const toneQ = Math.max(0.02, Math.min(1, Math.round(tone * 20) / 20));
  // null plays a sine and [] plays silence: the two must never share a key.
  let content = '';
  if (waveId === WAVE.USER) content = userPartials ? '[' + userPartials.join(',') + ']' : 'null';
  const key = waveId + '|' + toneQ + '|' + content;
  let mips = WAVE_CACHE.get(key);
  if (mips) return mips;

  mips = buildMips(partialsFor(waveId, userPartials), sampleRate, toneQ);
  if (waveId === WAVE.SINE_4BIT) quantiseMips(mips, 8);
  else if (waveId === WAVE.SINE_8BIT) quantiseMips(mips, 128);

  if (WAVE_CACHE.size >= WAVE_CACHE_LIMIT) {
    WAVE_CACHE.delete(WAVE_CACHE.keys().next().value!);
  }
  WAVE_CACHE.set(key, mips);
  return mips;
}

/** Which octave table to read for a given frequency. */
function mipIndex(freq: number): number {
  if (freq <= MIP_BASE_HZ) return 0;
  const k = Math.floor(Math.log2(freq / MIP_BASE_HZ));
  return k < 0 ? 0 : k >= MIP_COUNT ? MIP_COUNT - 1 : k;
}

const KIND_TABLE = 0,
  KIND_NOISE = 1,
  KIND_SAW_D = 2,
  KIND_SQUARE_D = 3,
  KIND_PULSE = 4;

/**
 * The render kind an operator's wave id selects; everything not raw, noise or
 * PULSE is a table. A PULSE operator reads its saw table twice (#55).
 */
function waveKind(wave: number): number {
  switch (wave) {
    case WAVE.NOISE:
      return KIND_NOISE;
    case WAVE.SAW_D:
      return KIND_SAW_D;
    case WAVE.SQUARE_D:
      return KIND_SQUARE_D;
    case WAVE.PULSE:
      return KIND_PULSE;
    default:
      return KIND_TABLE;
  }
}

/* Warm the common waveforms at module-load time — this runs inside
 * addModule(), before the context renders anything, so the table build never
 * stalls a live audio callback. */
for (const w of [WAVE.SINE, WAVE.SAW, WAVE.SQUARE, WAVE.TRIANGLE]) {
  getMips(w, sampleRate, 1, null);
}

export {
  SIN_TAB,
  getMips,
  mipIndex,
  KIND_TABLE,
  KIND_NOISE,
  KIND_SAW_D,
  KIND_SQUARE_D,
  KIND_PULSE,
  waveKind,
};
