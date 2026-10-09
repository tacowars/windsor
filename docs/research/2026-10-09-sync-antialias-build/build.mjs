/* global process, console */
/**
 * The built direct shape (windsor#655) measured as the study measured
 * candidate A (`../2026-10-09-sync-antialias-study/`), whose scripts this
 * imports unchanged. Research only.
 *
 *   node docs/research/2026-10-09-sync-antialias-build/build.mjs [--base 9ea3051]
 *
 * Three bundles, all under Node through the study's `render.mjs`:
 * - `shipped`: the FM bundle at `--base` (`origin/main` before this build),
 *   read with `git show`;
 * - `study A + D`: the study's in-memory edits of that bundle
 *   (`candidates.mjs`'s `direct(text, 2)` and `fineRatio`);
 * - `built`: this checkout's generated bundle.
 * The two direct shapes send their wave a sample late, which `render.mjs`
 * takes out (`late: 1`), so every render is aligned with shipped's.
 *
 * 1. **Framed** (decision 8): the study's framed metric on `lead-sync-sweep`
 *    at MIDI 72 and 84 (`spectrum.mjs`'s `framed`).
 * 2. **Against the table path at a low note**: MIDI 36, the study's synced
 *    carrier (`fallbackPatches.mjs`) at ratio 1 and 3.7, the peak, the mean,
 *    and the worst level and phase gap over the first ten harmonics against
 *    shipped's. `harmonic` and `againstTable` are the study's `checks.mjs`
 *    functions, copied here because that script exports nothing.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { direct, fineRatio } from '../2026-10-09-sync-antialias-study/candidates.mjs';
import { syncedCarrier } from '../2026-10-09-sync-antialias-study/fallbackPatches.mjs';
import { SR, library, noteHz, renderNote } from '../2026-10-09-sync-antialias-study/render.mjs';
import { framed } from '../2026-10-09-sync-antialias-study/spectrum.mjs';

const BUNDLE = 'packages/engine/src/worklet/generated/fm-processor.js';
const args = { base: '9ea3051' };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
}

const baseText = execFileSync('git', ['show', `${args.base}:${BUNDLE}`], { encoding: 'utf8' });
/** A variant as `render.mjs`'s `variant` builds one: 48 kHz, no decimator. */
const at48 = (name, text, late) => ({ name, text, factor: 1, rate: SR, stages: [], late });
const VARIANTS = [
  at48(`shipped (${args.base})`, baseText, 0),
  at48('study A + D', fineRatio(direct(baseText, 2)), 1),
  at48('built', readFileSync(BUNDLE, 'utf8'), 1),
];

function section1() {
  const patch = library('.', 'lead-sync-sweep');
  const notes = [72, 84];
  console.log('1. lead-sync-sweep: framed alias under signal in dB, median / p90');
  console.log(`| Variant | ${notes.map((n) => `MIDI ${n} median | MIDI ${n} p90`).join(' | ')} |`);
  console.log(`|---|${notes.map(() => '---|---').join('|')}|`);
  for (const v of VARIANTS) {
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
const HARMONICS = 10;

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

function section2() {
  const waves = { saw: 1, square: 2, pulse: 10 };
  const seconds = (FROM + LEN) / SR + 0.01;
  console.log('\n2. Against the table path, MIDI 36: peak, mean, worst gap over harmonics 1-10');
  console.log(
    '| Variant | Wave | Ratio | Peak (variant / shipped) | Mean (variant / shipped) | Level gap dB | Phase gap ° |',
  );
  console.log('|---|---|---|---|---|---|---|');
  for (const ratio of [1, 3.7]) {
    for (const [wave, id] of Object.entries(waves)) {
      const patch = syncedCarrier(id, ratio, wave === 'pulse' ? 0.3 : 1);
      const ref = renderNote(VARIANTS[0], patch, 36, seconds);
      for (const v of VARIANTS.slice(1)) {
        const c = againstTable(renderNote(v, patch, 36, seconds), ref, noteHz(36));
        const pair = ([a, b], d) => `${a.toFixed(d)} / ${b.toFixed(d)}`;
        console.log(
          `| ${v.name} | ${wave} | ${ratio} | ${pair(c.peak, 3)} | ${pair(c.mean, 4)} | ${c.level.toFixed(2)} | ${c.phase.toFixed(1)} |`,
        );
      }
    }
  }
}

section1();
section2();
