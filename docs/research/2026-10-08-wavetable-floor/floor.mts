// The table oscillator's noise floor across the keyboard, and what a larger
// table or a cubic read buys. Usage (from the repo root):
//   npx tsx docs/research/2026-10-08-wavetable-floor/floor.mts
// 1. Check: `tables.mts` builds the engine's tables to the bit (the shipped
//    `getMips`), and its read gives the engine's floor (the worklet harness).
// 2. Read every semitone C0..C8 for saw, square and triangle at each table
//    size and read, with the drive note's meter (`spectrum.mts`).
import { loadProcessor, render } from '../../../packages/engine/src/__fixtures__/workletHarness.ts';
import { FILTER_MODE, makePatch, WAVE } from '../../../packages/engine/src/patch/patch.ts';
import { N, read } from '../2026-10-08-voice-drive-aliasing/spectrum.mts';
import { buildMips, buildMipsSized, ideal, MIP_BASE_HZ, mipIndex, play, type Read, SR, type Wave } from './tables.mts';

(globalThis as { sampleRate?: number }).sampleRate = 48000;
const engineTables = await import('../../../packages/engine/src/worklet/fm/waveTables.ts');

const WAVES: Wave[] = ['saw', 'square', 'triangle'];
const WAVE_ID: Record<Wave, number> = { saw: WAVE.SAW, square: WAVE.SQUARE, triangle: WAVE.TRIANGLE };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n: number) => NAMES[n % 12] + String(Math.floor(n / 12) - 1);
const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);
const VERBOSE = process.argv.includes('--notes');
const NOTES = Array.from({ length: 97 }, (_, i) => 12 + i); // C0 .. C8

// ---- 1. The checks --------------------------------------------------------
for (const w of WAVES) {
  const ours = buildMips(w, 2048);
  const theirs = engineTables.getMips(WAVE_ID[w], 48000, 1, null) as Float32Array[];
  const same = ours.every((t, k) => Buffer.compare(Buffer.from(t.buffer), Buffer.from(theirs[k].buffer)) === 0);
  console.log(`tables ${w}: ${same ? 'bit-identical to getMips' : 'DIFFER from getMips'}`);
  // A sized table that stays at 2048 keeps the shipped bits.
  const sized = buildMipsSized(w, 22, 2048, 16384);
  const kept = sized.map((t, k) => t.length === 2049 && Buffer.compare(Buffer.from(t.buffer), Buffer.from(theirs[k].buffer)) === 0);
  console.log(`  sized 22x: table sizes ${sized.map((t) => t.length - 1).join(' ')}; unchanged at 2048: ${kept.filter(Boolean).length} of ${kept.filter((_, k) => sized[k].length === 2049).length}`);
}

const loaded = loadProcessor();
const env = { attackTime: 0.001, decayTime: 0.001, sustainLevel: 1 };
function engineTone(w: Wave, f: number): Float64Array {
  const p = makePatch({
    algorithm: 0, volume: 0.5, tone: 1, spread: 0, panRandom: 0, filter: { mode: FILTER_MODE.OFF },
    ops: [{ wave: WAVE_ID[w], fixed: true, fixedHz: f, level: 1, env }, { level: 0, env }, { level: 0, env }, { level: 0, env }],
  } as never);
  const out = render(loaded, loaded.create(p, 4), Math.ceil((12000 + N) / 128), [{ type: 'noteOn', id: 1, note: 60, velocity: 1, frame: 0 }]).samples;
  const x = new Float64Array(N);
  for (let i = 0; i < N; i++) x[i] = out[(12000 + i) * 2];
  return x;
}
const saw2048 = buildMips('saw', 2048);
console.log('floor check, A-weighted dB: engine | this read | the exact sum of the same harmonics');
for (const n of [24, 36, 48, 60]) {
  const f = hz(n);
  const e = read(engineTone('saw', f), 0, f).asrA;
  const o = read(play(saw2048, f, N, 'linear'), 0, f).asrA;
  const i = read(ideal(saw2048, 'saw', f, N, 2048), 0, f).asrA;
  console.log(`  ${noteName(n).padEnd(4)} ${e.toFixed(1)} | ${o.toFixed(1)} | ${i.toFixed(1)}`);
}

// ---- 2. The sweep ---------------------------------------------------------
const CANDIDATES: { label: string; size: number; read: Read; ratio?: number }[] = [
  { label: 'linear 2048 (shipped)', size: 2048, read: 'linear' },
  { label: 'linear 4096', size: 4096, read: 'linear' },
  { label: 'linear 8192', size: 8192, read: 'linear' },
  { label: 'linear 16384', size: 16384, read: 'linear' },
  { label: 'cubic 2048', size: 2048, read: 'cubic' },
  { label: 'cubic 4096', size: 4096, read: 'cubic' },
  { label: 'sized 11x (to 8192)', size: 8192, read: 'linear', ratio: 11 },
  { label: 'sized 22x (to 16384)', size: 16384, read: 'linear', ratio: 22 },
];

/** The level the harmonics should have against the fundamental, dB. */
function expected(w: Wave, h: number): number {
  if (w === 'square' && h % 2 === 0) return NaN;
  if (w === 'triangle') return h % 2 === 0 ? NaN : -40 * Math.log10(h);
  return -20 * Math.log10(h);
}

for (const w of WAVES) {
  console.log(`\n## ${w}: A-weighted floor (dB) by note, and the top harmonics' level error (dB, worst below 16 kHz)`);
  const sets = CANDIDATES.map((c) => (c.ratio ? buildMipsSized(w, c.ratio, 2048, c.size) : buildMips(w, c.size)));
  console.log('              | ' + CANDIDATES.map((c) => c.label.padStart(22)).join(''));
  const floors: number[][] = CANDIDATES.map(() => []);
  const errs: number[][] = CANDIDATES.map(() => []);
  for (const n of NOTES) {
    const f = hz(n);
    const cells = CANDIDATES.map((c, ci) => {
      const r = read(play(sets[ci], f, N, c.read), 0, f);
      // Only the harmonics the table holds: its octave's cutoff drops the rest by design.
      const maxH = Math.floor((SR * 0.5) / (MIP_BASE_HZ * 2 ** (mipIndex(f) + 1)));
      let e = 0;
      for (let h = 2; h <= Math.min(r.harmonics.length, maxH); h++) {
        const want = expected(w, h);
        if (Number.isNaN(want)) continue;
        e = Math.max(e, Math.abs(r.harmonics[h - 1] - r.harmonics[0] - want));
      }
      floors[ci].push(r.asrA);
      errs[ci].push(e);
      return `${r.asrA.toFixed(1)} / ${e.toFixed(2)}`.padStart(22);
    });
    if (VERBOSE) console.log(`${noteName(n).padEnd(4)} ${f.toFixed(0).padStart(6)} ${String(mipIndex(f)).padStart(4)} | ${cells.join('')}`);
  }
  const med = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];
  // Worst floor in each octave, C to B.
  for (let o = 0; o < 8; o++) {
    const idx = NOTES.map((n, i) => [n, i]).filter(([n]) => Math.floor(n / 12) - 1 === o).map(([, i]) => i);
    console.log(`octave ${o} worst | ` + floors.map((a) => Math.max(...idx.map((i) => a[i])).toFixed(1).padStart(22)).join(''));
  }
  console.log('median  floor | ' + floors.map((a) => med(a).toFixed(1).padStart(22)).join(''));
  console.log('worst   floor | ' + floors.map((a) => Math.max(...a).toFixed(1).padStart(22)).join(''));
  console.log('worst   tone  | ' + errs.map((a) => Math.max(...a).toFixed(2).padStart(22)).join(''));
}
