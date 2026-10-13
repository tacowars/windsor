/**
 * Waveforms (#644): the wave ids, the exact sine table, the bandlimited
 * per-octave mip tables built from harmonic partials, each sized to the
 * harmonics it holds, the cache that shares
 * them across every part in this worklet global scope, and the render kind an
 * operator's wave selects. PULSE (#55) is two reads of the saw set, so its
 * waves are the saw's and the cache holds one copy. Invariants: `SIN_TAB` and the cache are
 * single-instance module state, never duplicated; `WAVE` mirrors `patch.ts`
 * (`patch.test.ts` pins the copy until #656 shares it). The module touches no
 * worklet scope at load: the main thread imports it too (windsor#795), builds
 * a set with `waveSetFor` under the key `waveSetKey` gives, the same code and
 * so the same bits, into its own cache, and sends it ahead of a patch; the
 * processor installs it (`installWaveSet`) and builds only what it was not
 * sent. The warm-up is `warmWaveCache`, which the processor runs once inside
 * `addModule()`, never in a render. `fmProcessorUserWave.test.ts`
 * and the golden test pin the tables' contents. A synced note at twice the
 * rate (windsor#656) reads a second set built at that rate, the same sizing
 * rule over twice the harmonics, each table scaled by the gain that
 * normalised the part's own table of that octave, not by its own peak, so
 * the harmonics both hold play at one level (`waveTables.test.ts`).
 */

import {
  MIP_BASE_HZ,
  MIP_COUNT,
  MIP_TABLE_RATIO,
  TABLE_MASK,
  TABLE_SIZE,
  TABLE_SIZE_MAX,
} from './fmConstants';
import { sineSeriesByFft } from './waveTableFft';
import { WAVE } from './waveIds';

/* ------------------------------------------------------------------ *
 * Wavetable construction
 *
 * Every non-noise, non-digital waveform is a list of harmonic amplitudes
 * rendered once per octave, into a table sized to the harmonics it holds,
 * with harmonics above Nyquist dropped. `tone` (0..1) scales the surviving harmonic count, which
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
        for (let i = 0; i < Math.min(N, userPartials.length); i++) a[i] = userPartials[i]!;
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
 * linear interpolation never wraps-checks in the inner loop. Each octave's
 * table is the smallest power of two at least MIP_TABLE_RATIO times its
 * highest harmonic, from TABLE_SIZE to TABLE_SIZE_MAX, so a table of many
 * harmonics is long enough that interpolating it leaves no audible floor; a
 * table of TABLE_SIZE is summed as it always was, to the bit, and a longer
 * one is built by the inverse FFT (`waveTableFft.ts`). Each is normalised to
 * its own peak, the gain written to `gains`, or, with `fixed`, scaled by the
 * gain `gains` already holds for its octave (windsor#656).
 */
function buildMips(
  partials: Float32Array,
  sampleRate: number,
  tone: number,
  gains: Float64Array,
  fixed: boolean,
): Float32Array[] {
  const nyquist = sampleRate * 0.5;
  const maxPossible = TABLE_SIZE >> 1;
  const mips: Float32Array[] = new Array(MIP_COUNT);

  for (let k = 0; k < MIP_COUNT; k++) {
    const topHz = MIP_BASE_HZ * Math.pow(2, k + 1);
    let maxH = Math.floor(nyquist / topHz);
    maxH = Math.min(maxH, maxPossible, partials.length);
    maxH = Math.max(1, Math.floor(maxH * tone));
    // Sized by the highest harmonic it holds, so a sine or a sparse User wave
    // keeps a short table.
    let top = maxH;
    while (top > 1 && partials[top - 1] === 0) top--;
    let size = TABLE_SIZE;
    while (size < MIP_TABLE_RATIO * top && size < TABLE_SIZE_MAX) size *= 2;

    const t = new Float32Array(size + 1);
    if (size > TABLE_SIZE) sineSeriesByFft(partials, maxH, size, t);
    else {
      for (let h = 1; h <= maxH; h++) {
        const amp = partials[h - 1]!;
        if (amp === 0) continue;
        let idx = 0;
        for (let i = 0; i < TABLE_SIZE; i++) {
          t[i] = t[i]! + amp * SIN_TAB[idx]!;
          idx = (idx + h) & TABLE_MASK;
        }
      }
    }

    if (fixed) {
      const g = gains[k]!;
      for (let i = 0; i < size; i++) t[i] = t[i]! * g;
    } else {
      let peak = 0;
      for (let i = 0; i < size; i++) {
        const x = t[i]!;
        const v = x < 0 ? -x : x;
        if (v > peak) peak = v;
      }
      gains[k] = 1;
      if (peak > 1e-9) {
        const g = 1 / peak;
        gains[k] = g;
        for (let i = 0; i < size; i++) t[i] = t[i]! * g;
      }
    }
    t[size] = t[0]!;
    mips[k] = t;
  }
  return mips;
}

/** Quantise a mip set in place to `levels` steps — the 4-bit / 8-bit sines. */
function quantiseMips(mips: Float32Array[], levels: number): Float32Array[] {
  for (let k = 0; k < mips.length; k++) {
    const t = mips[k]!;
    for (let i = 0; i < t.length; i++) {
      t[i] = Math.round(t[i]! * levels) / levels;
    }
  }
  return mips;
}

/** A cached mip set and each octave's normalising gain, which a set at twice the rate takes (windsor#656). */
interface WaveSet {
  mips: Float32Array[];
  gains: Float64Array;
}

/**
 * Shared across every processor instance in this worklet global scope, so 16
 * parts using a saw pay for the tables once. Keyed by waveform + quantised
 * tone + the rate it is built at and, for a set at twice the rate, the rate
 * it is normalised to (windsor#656),
 * and for a User wave by the partials themselves (#511). The key used to be the
 * patch's `userKey`, which only worked while every author picked a unique one:
 * a User wave left at the default '' shared the first such table built, and a
 * harmonic edit kept playing the old one. `null` (a sine) and `[]` (silence)
 * keep distinct keys. Equal partials still share a table,
 * so the scoring bank's User presets render exactly as before. Only a `patch`
 * or `waves` message reaches here, never the audio loop, so the string is fine.
 *
 * Two FIFOs of fixed slots, evicting oldest first as the `Map` they replaced
 * did (windsor#795). A slot is written in place, so installing a set the
 * main thread sent allocates nothing but the arrays it was handed, where the
 * map's insert and eviction did (`fmProcessorAllocation.test.ts`: 51 KB over
 * the run against none).
 *
 * - `SENT_SETS` (`WAVE_SENT_LIMIT` slots) takes the warm-up and every
 *   install, and nothing else. `synth/waveSetSender.ts` keeps the same FIFO
 *   of the keys it sent, the warm-up's first, so the two agree by
 *   construction: the sender never believes this scope holds a key it has
 *   evicted. A key installed again moves to newest, as the sender's memory
 *   moves a key it sends again.
 * - `BUILT_SETS` (`WAVE_BUILT_LIMIT` slots) takes the sets this scope builds
 *   on a miss (a 2× set for a voice sounding at it, an offline context's
 *   every set, the main thread's own builds). The sender never sees them, so
 *   they never evict a set it sent.
 *
 * A lookup scans both: at most 64 string compares, at a message.
 */
const WAVE_SENT_LIMIT = 32;
const WAVE_BUILT_LIMIT = 32;

/** One FIFO: `size` slots in use, the oldest at 0 and the newest at `size - 1`. */
interface WaveSetFifo {
  keys: string[];
  sets: (WaveSet | null)[];
  size: number;
}

function waveSetFifo(limit: number): WaveSetFifo {
  const keys = new Array<string>(limit).fill('');
  return { keys, sets: new Array<WaveSet | null>(limit).fill(null), size: 0 };
}

const SENT_SETS = waveSetFifo(WAVE_SENT_LIMIT);
const BUILT_SETS = waveSetFifo(WAVE_BUILT_LIMIT);

/** Sets built in this scope since load, rather than found or installed: how a test sees a message build nothing. */
let waveSetBuilds = 0;

/** The slot holding `key` in `fifo`, or -1. */
function fifoSlot(fifo: WaveSetFifo, key: string): number {
  for (let i = 0; i < fifo.size; i++) if (fifo.keys[i] === key) return i;
  return -1;
}

/** Empty slot `at` of `fifo`, each newer slot moving down one. */
function fifoDrop(fifo: WaveSetFifo, at: number): void {
  for (let i = at + 1; i < fifo.size; i++) {
    fifo.keys[i - 1] = fifo.keys[i]!;
    fifo.sets[i - 1] = fifo.sets[i]!;
  }
  fifo.size--;
  fifo.keys[fifo.size] = '';
  fifo.sets[fifo.size] = null;
}

/** `set` under `key`, a key `fifo` does not hold, as its newest, over its oldest once every slot is in use. */
function fifoPush(fifo: WaveSetFifo, key: string, set: WaveSet): void {
  if (fifo.size === fifo.keys.length) fifoDrop(fifo, 0);
  fifo.keys[fifo.size] = key;
  fifo.sets[fifo.size] = set;
  fifo.size++;
}

/** The cached set under `key`, or null. */
function cachedWaveSet(key: string): WaveSet | null {
  const sent = fifoSlot(SENT_SETS, key);
  if (sent >= 0) return SENT_SETS.sets[sent]!;
  const built = fifoSlot(BUILT_SETS, key);
  return built >= 0 ? BUILT_SETS.sets[built]! : null;
}

/**
 * Cache a set built elsewhere, on the main thread (windsor#795), under the
 * key it was built for, as handed over, never copied, as the sent FIFO's
 * newest. A key that FIFO holds keeps its set and moves to newest.
 */
function installWaveSet(key: string, set: WaveSet): void {
  const at = fifoSlot(SENT_SETS, key);
  let held = set;
  if (at >= 0) {
    held = SENT_SETS.sets[at]!;
    fifoDrop(SENT_SETS, at);
  }
  fifoPush(SENT_SETS, key, held);
}

/**
 * The mip set for `wave` at `sampleRate`. A set at another rate than the
 * part's (`baseRate`, twice it for a synced note: windsor#656) scales each
 * octave by the gain that normalised the part's own set, so its fundamental
 * and every harmonic the two share play at the part's table's level.
 */
function getMips(
  wave: number,
  sampleRate: number,
  tone: number,
  userPartials: number[] | null,
  baseRate: number = sampleRate,
): Float32Array[] {
  return waveSetFor(wave, sampleRate, tone, userPartials, baseRate).mips;
}

/** `tone` (0..1) quantised to the twentieths a set is built at, from 0.02. */
function toneStep(tone: number): number {
  return Math.max(0.02, Math.min(1, Math.round(tone * 20) / 20));
}

/**
 * The cache key of `wave`'s set at `sampleRate`, normalised to `baseRate`
 * (windsor#656): the one both threads compute for the same inputs
 * (windsor#795). PULSE is two reads of the saw's tables (#55): one key, one copy.
 */
function waveSetKey(
  wave: number,
  sampleRate: number,
  tone: number,
  userPartials: number[] | null,
  baseRate: number = sampleRate,
): string {
  const waveId = wave === WAVE.PULSE ? WAVE.SAW : wave;
  // null plays a sine and [] plays silence: the two must never share a key.
  let content = '';
  if (waveId === WAVE.USER) content = userPartials ? '[' + userPartials.join(',') + ']' : 'null';
  const rate = baseRate === sampleRate ? '' + sampleRate : sampleRate + '/' + baseRate;
  return waveId + '|' + toneStep(tone) + '|' + rate + '|' + content;
}

/** The cached set `waveSetKey` names, built and cached on a miss: the builder both threads run. */
function waveSetFor(
  wave: number,
  sampleRate: number,
  tone: number,
  userPartials: number[] | null,
  baseRate: number = sampleRate,
): WaveSet {
  const key = waveSetKey(wave, sampleRate, tone, userPartials, baseRate);
  let set = cachedWaveSet(key);
  if (set) return set;

  const waveId = wave === WAVE.PULSE ? WAVE.SAW : wave;
  const gains = new Float64Array(MIP_COUNT);
  const fixed = baseRate !== sampleRate;
  if (fixed) gains.set(waveSetFor(wave, baseRate, tone, userPartials, baseRate).gains);
  const mips = buildMips(
    partialsFor(waveId, userPartials),
    sampleRate,
    toneStep(tone),
    gains,
    fixed,
  );
  if (waveId === WAVE.SINE_4BIT) quantiseMips(mips, 8);
  else if (waveId === WAVE.SINE_8BIT) quantiseMips(mips, 128);

  waveSetBuilds++;
  set = { mips, gains };
  fifoPush(BUILT_SETS, key, set);
  return set;
}

/** How many sets this scope has built since load (`waveSetBuilds`). */
function waveSetBuildCount(): number {
  return waveSetBuilds;
}

/**
 * Which octave table to read for the frequency `freqs[i]`. The frequency is
 * read from an array rather than passed, so no double crosses the call
 * (windsor#233): the control update calls this once per operator a block, and
 * a double passed to a call V8 does not inline is a new heap number.
 */
function mipIndexAt(freqs: Float64Array, i: number): number {
  const freq = freqs[i]!;
  if (freq <= MIP_BASE_HZ) return 0;
  const k = Math.floor(Math.log2(freq / MIP_BASE_HZ));
  return k < 0 ? 0 : k >= MIP_COUNT ? MIP_COUNT - 1 : k;
}

/** `mipIndex`'s one slot. */
const MIP_FREQ = new Float64Array(1);

/** Which octave table to read for a given frequency: `mipIndexAt`, for the tests. */
function mipIndex(freq: number): number {
  MIP_FREQ[0] = freq;
  return mipIndexAt(MIP_FREQ, 0);
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

/** The waves `warmWaveCache` builds, in order, at Tone 1. */
const WARM_WAVES: readonly number[] = [WAVE.SINE, WAVE.SAW, WAVE.SQUARE, WAVE.TRIANGLE];

/**
 * Warm the common waveforms at `rate`. The processor calls this once at
 * module load, inside addModule(), before the context renders anything, so
 * the build never stalls a live audio callback; the main thread, which
 * imports this module too, never does (windsor#795).
 */
function warmWaveCache(rate: number): void {
  // Into the sent FIFO too, first, as the sender remembers them (windsor#795).
  for (const w of WARM_WAVES) {
    installWaveSet(waveSetKey(w, rate, 1, null), waveSetFor(w, rate, 1, null));
  }
}

export type { WaveSet };
export {
  SIN_TAB,
  WARM_WAVES,
  WAVE_BUILT_LIMIT,
  WAVE_SENT_LIMIT,
  cachedWaveSet,
  getMips,
  installWaveSet,
  mipIndex,
  mipIndexAt,
  KIND_TABLE,
  KIND_NOISE,
  KIND_SAW_D,
  KIND_SQUARE_D,
  KIND_PULSE,
  warmWaveCache,
  waveKind,
  waveSetBuildCount,
  waveSetFor,
  waveSetKey,
};
