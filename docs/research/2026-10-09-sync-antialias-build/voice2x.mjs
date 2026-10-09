/* global process, console */
/**
 * The synced voice at twice the rate as built (windsor#656, decision 9),
 * measured as the study measured candidate AB2 + D
 * (`../2026-10-09-sync-antialias-study/`), whose scripts this imports
 * unchanged. Research only.
 *
 *   node docs/research/2026-10-09-sync-antialias-build/voice2x.mjs [--sections 1,2,3,4]
 *     [--base 9ea3051] [--direct ca831a6]
 *
 * The bundles, all under Node through the study's `render.mjs`:
 * - `A + D` (`--direct`): the bundle windsor#655 shipped, the direct shape
 *   at the part's rate, read with `git show`;
 * - `study AB2 + D`: the study's in-memory AB2 + D on the bundle before
 *   windsor#655 (`--base`), its whole voice at 96 kHz, decimated zero phase;
 * - `built`: this checkout's bundle; `built at 1×` is the same text with
 *   the part's `syncOversample` switch off.
 * The 16× reference is the `--base` bundle at 768 kHz through the study's
 * Kaiser decimator, as the study built it.
 *
 * 1. **Framed** on `lead-sync-sweep` at MIDI 72 and 84 (`spectrum.mjs`).
 * 2. **Brightness**: the study's synced carrier at ratio 3.7, harmonic
 *    energy per band against the 16× reference (`checks.mjs`'s method).
 * 3. **Level**: the synced carrier at MIDI 36, ratio 1, built against built
 *    at 1×, over the same 0.5 s, the 2× render's 16 samples of delay taken out.
 * 4. **Tables**: the build time and the size of a wave set at twice the
 *    rate, a fresh build each time, beside the part's own.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { direct, fineRatio, scaledIntervals } from '../2026-10-09-sync-antialias-study/candidates.mjs';
import { DECIMATORS } from '../2026-10-09-sync-antialias-study/decimators.mjs';
import { syncedCarrier } from '../2026-10-09-sync-antialias-study/fallbackPatches.mjs';
import { SR, library, noteHz, renderNote } from '../2026-10-09-sync-antialias-study/render.mjs';
import { framed, powerSpectrum } from '../2026-10-09-sync-antialias-study/spectrum.mjs';
import { at1x } from './voice2xBundles.mjs';

const BUNDLE = 'packages/engine/src/worklet/generated/fm-processor.js';
const args = { sections: '1,2,3,4', base: '9ea3051', direct: 'ca831a6' };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
}
const show = (rev) => execFileSync('git', ['show', `${rev}:${BUNDLE}`], { encoding: 'utf8' });
const baseText = show(args.base);
const builtText = readFileSync(BUNDLE, 'utf8');

/** A variant as `render.mjs`'s `variant` builds one. */
const at48 = (name, text, late = 0) => ({ name, text, factor: 1, rate: SR, stages: [], late });
const DIRECT = at48(`A + D (${args.direct})`, show(args.direct), 1);
const STUDY_AB2 = {
  name: 'study AB2 + D',
  text: fineRatio(direct(scaledIntervals(baseText, 2), 2)),
  factor: 2,
  rate: 2 * SR,
  stages: DECIMATORS.B2,
  late: 1,
};
const BUILT = at48('built', builtText);
const BUILT_1X = at48('built at 1×', at1x(builtText));
const REF16 = {
  name: 'ref16',
  text: baseText,
  factor: 16,
  rate: 16 * SR,
  stages: DECIMATORS.REF16,
  late: 0,
};
/** The built 2× voice's delay at 48 kHz: the FIR's 16 samples (its half sample of shape lateness stays). */
const DELAY = 16;

const db = (r) => 10 * Math.log10(r);

function section1() {
  const patch = library('.', 'lead-sync-sweep');
  const notes = [72, 84];
  console.log('1. lead-sync-sweep: framed alias under signal in dB, median / p90');
  console.log(`| Variant | ${notes.map((n) => `MIDI ${n} median | MIDI ${n} p90`).join(' | ')} |`);
  console.log(`|---|${notes.map(() => '---|---').join('|')}|`);
  for (const v of [DIRECT, STUDY_AB2, BUILT]) {
    const cells = notes.map((note) => {
      const { median, p90 } = framed(renderNote(v, patch, note, 8), noteHz(note));
      return `${median.toFixed(1)} | ${p90.toFixed(1)}`;
    });
    console.log(`| ${v.name} | ${cells.join(' | ')} |`);
  }
}

// From the study's checks.mjs: every figure skips 0.1 s and reads 0.5 s.
const FROM = 4800;
const LEN = 24000;
const BANDS = [0, 5000, 10000, 15000, 20000];
const WAVES = { saw: 1, square: 2, pulse: 10 };
const carrier = (wave, ratio) => syncedCarrier(WAVES[wave], ratio, wave === 'pulse' ? 0.3 : 1);
const SECONDS = (FROM + LEN + DELAY) / SR + 0.01;

/** The harmonic energy in each band of `x` over `ref`'s, in dB (`checks.mjs`'s `bandLevels`). */
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

function section2() {
  console.log('\n2. Harmonic energy against the 16x reference, per band (dB), ratio 3.7');
  console.log('| Variant | Wave | Note | 0-5k | 5-10k | 10-15k | 15-20k |');
  console.log('|---|---|---|---|---|---|---|');
  for (const note of [72, 84]) {
    for (const wave of Object.keys(WAVES)) {
      const patch = carrier(wave, 3.7);
      const ref = renderNote(REF16, patch, note, SECONDS);
      for (const v of [DIRECT, STUDY_AB2, BUILT]) {
        const bands = bandLevels(renderNote(v, patch, note, SECONDS), ref, noteHz(note));
        console.log(`| ${v.name} | ${wave} | ${note} | ${bands.join(' | ')} |`);
      }
    }
  }
}

function section3() {
  console.log('\n3. Level, MIDI 36, ratio 1: built against built at 1x, RMS over 0.5 s');
  console.log('| Wave | RMS built / at 1x | dB |');
  console.log('|---|---|---|');
  for (const wave of Object.keys(WAVES)) {
    const patch = carrier(wave, 1);
    const twice = renderNote(BUILT, patch, 36, SECONDS).subarray(DELAY);
    const once = renderNote(BUILT_1X, patch, 36, SECONDS);
    const rms = (x) => Math.sqrt(x.subarray(FROM, FROM + LEN).reduce((a, s) => a + s * s, 0) / LEN);
    const [a, b] = [rms(twice), rms(once)];
    console.log(`| ${wave} | ${a.toFixed(4)} / ${b.toFixed(4)} | ${(20 * Math.log10(a / b)).toFixed(3)} |`);
  }
}

/** The bundle's `getMips`, `WAVE` and cache, at 48 kHz. */
function tables(text) {
  return new Function(
    'sampleRate',
    'AudioWorkletProcessor',
    'registerProcessor',
    `let currentFrame = 0; ${text}; return { getMips, WAVE, WAVE_CACHE };`,
  )(SR, class {}, () => {});
}

function section4() {
  const { getMips, WAVE, WAVE_CACHE } = tables(builtText);
  const ROUNDS = 20;
  const bytes = (mips) => mips.reduce((n, t) => n + t.byteLength, 0);
  /** A fresh build's median time in ms, and its size: the cache is emptied before each. */
  const measure = (build) => {
    const times = [];
    let size = 0;
    for (let r = 0; r < ROUNDS + 2; r++) {
      WAVE_CACHE.clear();
      if (build.base) getMips(build.wave, SR, 1, null);
      const t0 = performance.now();
      const mips = build.twice
        ? getMips(build.wave, 2 * SR, 1, null, SR)
        : getMips(build.wave, SR, 1, null);
      if (r >= 2) times.push(performance.now() - t0);
      size = bytes(mips);
    }
    times.sort((a, b) => a - b);
    return { ms: times[times.length >> 1], kb: size / 1024 };
  };
  console.log('\n4. Wave sets: a fresh build on a patch message, median of 20, and its size');
  console.log('| Wave | Set | Build ms | KB |');
  console.log('|---|---|---|---|');
  for (const [name, wave] of [
    ['saw', WAVE.SAW],
    ['square', WAVE.SQUARE],
    ['triangle', WAVE.TRIANGLE],
    ['sine', WAVE.SINE],
  ]) {
    const once = measure({ wave });
    const twice = measure({ wave, twice: true, base: true });
    console.log(`| ${name} | 48 kHz | ${once.ms.toFixed(2)} | ${once.kb.toFixed(0)} |`);
    console.log(`| ${name} | 96 kHz | ${twice.ms.toFixed(2)} | ${twice.kb.toFixed(0)} |`);
  }
}

const SECTIONS = { 1: section1, 2: section2, 3: section3, 4: section4 };
for (const s of args.sections.split(',')) SECTIONS[s]();
