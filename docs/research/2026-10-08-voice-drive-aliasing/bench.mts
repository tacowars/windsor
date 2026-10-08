// windsor: how much the voice drive aliases, and what each fix buys.
// Usage (from the repo root): npx tsx docs/research/2026-10-08-voice-drive-aliasing/bench.mts [results.json]
// Prints the summary tables; with a path, also writes every reading there (about 1 MB, not committed).
//
// 1. Capture: the engine's own pre-drive signal, through the worklet harness
//    (`fm-processor.js`), drive and filter off, one held note on fixed-frequency
//    operators so f0 is exact. Normalised to peak 1, so a drive's gain is the
//    shaper's peak operand.
// 2. Check: the engine rendered with each shape on matches `naive` on the
//    capture, so the capture is what the drive sees.
// 3. Read: every shape × drive × method across the keyboard.
import { writeFileSync } from 'node:fs';
import { loadProcessor, render } from '../../../packages/engine/src/__fixtures__/workletHarness.ts';
import { DRIVE_SHAPE, FILTER_MODE, makePatch, WAVE } from '../../../packages/engine/src/patch/patch.ts';
import type { PartialPatch } from '../../../packages/engine/src/patch/patch.ts';
import { type Drive, type Method, naive, run, type Shape } from './shapers.mts';
import { N, read, type Reading } from './spectrum.mts';

const loaded = loadProcessor();
const BLOCK = 128;
const SETTLE = 12000; // 0.25 s: every envelope is at sustain
const PRE = 8192; // samples of run-in before the analysis window, for each method's filters
const LEN = PRE + N + 512;
const BLOCKS = Math.ceil((SETTLE + LEN) / BLOCK);

type Input = 'saw' | 'square' | 'fm';
const INPUTS: Input[] = ['saw', 'square', 'fm'];
const NOTES = Array.from({ length: 15 }, (_, i) => 24 + 6 * i); // C1 .. C8 every half octave
const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n: number) => NAMES[n % 12] + String(Math.floor(n / 12) - 1);

const env = { attackTime: 0.001, decayTime: 0.001, sustainLevel: 1, releaseTime: 0.1 };
const silent = { level: 0, env };

function patchFor(input: Input, f: number, drive?: object): PartialPatch {
  const carrier = { fixed: true, fixedHz: f, level: 1, env };
  const ops =
    input === 'fm'
      ? [carrier, { wave: WAVE.SINE, fixed: true, fixedHz: f, level: 0.5, env }, silent, silent]
      : [{ ...carrier, wave: input === 'saw' ? WAVE.SAW : WAVE.SQUARE }, silent, silent, silent];
  return {
    algorithm: 0,
    volume: 0.5,
    tone: 1,
    spread: 0,
    pan: 0,
    panRandom: 0,
    glide: 0,
    filter: { mode: FILTER_MODE.OFF },
    ops,
    ...(drive ? { drive } : {}),
  } as PartialPatch;
}

function engineLeft(p: PartialPatch): Float64Array {
  const proc = loaded.create(makePatch(p), 4);
  const out = render(loaded, proc, BLOCKS, [{ type: 'noteOn', id: 1, note: 60, velocity: 1, frame: 0 }]).samples;
  const x = new Float64Array(LEN);
  for (let i = 0; i < LEN; i++) x[i] = out[(SETTLE + i) * 2];
  return x;
}

const peakOf = (x: Float64Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

// The pan gain at centre, read off the engine: a hard clip at full gain sits at ±panL.
const panL = peakOf(engineLeft(patchFor('saw', 220, { on: true, shape: DRIVE_SHAPE.HARD, gain: 64, bias: 0, tone: 1 })));

const SHAPES: Shape[] = ['soft', 'hard', 'fold'];
const SHAPE_ID: Record<Shape, number> = { soft: DRIVE_SHAPE.SOFT, hard: DRIVE_SHAPE.HARD, fold: DRIVE_SHAPE.FOLD };
/** Shaper peak operand: 1 a light touch (soft barely bends), 3 soft's full knee, 8 heavy. */
const DRIVES: { gain: number; bias: number }[] = [
  { gain: 1, bias: 0 },
  { gain: 3, bias: 0 },
  { gain: 8, bias: 0 },
];
const SOFT_BIASED = { gain: 3, bias: 0.3 };
const METHODS: Method[] = ['naive', 'adaa1', 'os2', 'os2-adaa1', 'os4', 'iir2', 'iir2-adaa1', 'ref16'];

interface Row {
  input: Input;
  note: string;
  f0: number;
  shape: Shape | 'input';
  gain: number;
  bias: number;
  method: Method | 'input';
  reading: Omit<Reading, 'harmonics'>;
  /** Largest |harmonic − reference| below 16 kHz, dB, over harmonics within 40 dB of the strongest. */
  toneErr: number;
}

const rows: Row[] = [];
const checks: { input: Input; note: string; shape: Shape; maxErr: number }[] = [];

function toneErr(h: number[], ref: number[]): number {
  const top = Math.max(...ref);
  let e = 0;
  for (let i = 0; i < ref.length; i++) if (ref[i] > top - 40) e = Math.max(e, Math.abs(h[i] - ref[i]));
  return e;
}

/** The engine with the drive on against `naive` on the capture: the largest difference, normalised. */
function captureCheck(input: Input, n: number, x: Float64Array, peak: number, d: Drive): void {
  const f0 = hz(n);
  const eng = engineLeft(patchFor(input, f0, { on: true, shape: SHAPE_ID[d.shape], gain: (d.gain * panL) / peak, bias: 0, tone: 1 }));
  const ours = naive(x, d);
  let maxErr = 0;
  for (let i = PRE; i < PRE + N; i++) maxErr = Math.max(maxErr, Math.abs(eng[i] / panL - ours[i]));
  checks.push({ input, note: noteName(n), shape: d.shape, maxErr });
}

for (const input of INPUTS) {
  for (const n of NOTES) {
    const f0 = hz(n);
    const raw = engineLeft(patchFor(input, f0));
    const peak = peakOf(raw);
    const x = raw.map((v) => v / peak);
    const inRead = read(x, PRE, f0);
    rows.push({ input, note: noteName(n), f0, shape: 'input', gain: 1, bias: 0, method: 'input', reading: inRead, toneErr: 0 });

    const cases: Drive[] = [];
    for (const shape of SHAPES) for (const d of DRIVES) cases.push({ shape, ...d });
    cases.push({ shape: 'soft', ...SOFT_BIASED });

    for (const d of cases) {
      // The capture check, on the unbiased middle drive at three notes.
      if (d.gain === 3 && d.bias === 0 && (n === 36 || n === 72 || n === 102)) captureCheck(input, n, x, peak, d);
      const out = new Map<Method, Reading>();
      for (const m of METHODS) out.set(m, read(run(m, x, d), PRE, f0));
      const ref = out.get('ref16')!.harmonics;
      for (const m of METHODS) {
        const { harmonics, ...reading } = out.get(m)!;
        rows.push({ input, note: noteName(n), f0, shape: d.shape, gain: d.gain, bias: d.bias, method: m, reading, toneErr: toneErr(harmonics, ref) });
      }
    }
    process.stderr.write(`${input} ${noteName(n)} done\n`);
  }
}

if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ panL, checks, rows }));

// ---- Summary ------------------------------------------------------------
const f1 = (v: number) => (v >= 0 ? ' ' : '') + v.toFixed(1);
const median = (a: number[]) => {
  const s = [...a].sort((p, q) => p - q);
  return s[s.length >> 1];
};
console.log(`panL ${panL.toFixed(6)}`);
console.log('capture check (engine drive vs naive on the capture, max |diff|):');
for (const c of checks) console.log(`  ${c.input} ${c.note} ${c.shape}: ${c.maxErr.toExponential(2)}`);

for (const input of INPUTS) {
  const floor = rows.filter((r) => r.input === input && r.method === 'input').map((r) => r.reading.asrA);
  console.log(`\n## ${input}  (input floor, A-weighted ASR: median ${f1(median(floor))}, worst ${f1(Math.max(...floor))} dB)`);
  console.log('shape  gain bias | ' + METHODS.map((m) => m.padStart(15)).join(''));
  const keys = [...new Set(rows.filter((r) => r.input === input && r.shape !== 'input').map((r) => `${r.shape}|${r.gain}|${r.bias}`))];
  for (const k of keys) {
    const [shape, gain, bias] = k.split('|');
    const cells = METHODS.map((m) => {
      const rs = rows.filter((r) => r.input === input && r.shape === shape && String(r.gain) === gain && String(r.bias) === bias && r.method === m);
      const a = rs.map((r) => r.reading.asrA);
      return `${f1(median(a))}/${f1(Math.max(...a))}`.padStart(15);
    });
    console.log(`${shape.padEnd(5)} ${gain.padStart(4)} ${bias.padStart(4)} | ${cells.join('')}`);
  }
}

console.log('\nTone error vs ref16 (max dB over notes, harmonics < 16 kHz within 40 dB of the top):');
console.log('input  shape  gain | ' + METHODS.slice(0, 7).map((m) => m.padStart(10)).join(''));
for (const input of INPUTS) for (const shape of SHAPES) for (const d of DRIVES) {
  const cells = METHODS.slice(0, 7).map((m) => {
    const rs = rows.filter((r) => r.input === input && r.shape === shape && r.gain === d.gain && r.bias === 0 && r.method === m);
    return Math.max(...rs.map((r) => r.toneErr)).toFixed(2).padStart(10);
  });
  console.log(`${input.padEnd(6)} ${shape.padEnd(5)} ${String(d.gain).padStart(4)} | ${cells.join('')}`);
}
