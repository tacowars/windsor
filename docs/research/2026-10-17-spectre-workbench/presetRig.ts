/* global process, console */
// Spectre's preset rig (record `2026-10-17-spectre-drawn-cells` decision 12):
// renders each preset at Mix 1, 48 kHz, through the worklet's own DSP class
// (`SpectreDsp`, the cells loaded as the processor loads them), and prints its
// wet RMS and peak on its group's material, a 2 s drum loop, a sung-like line
// or a pad chord, with 2 s of tail. The level rule: each preset within ±2 dB
// of its group's first.
//
//   npx esbuild docs/research/2026-10-17-spectre-workbench/presetRig.ts --bundle \
//     --platform=node --format=esm --outfile=/tmp/spectre-rig.mjs && node /tmp/spectre-rig.mjs
//
// It writes no audio; `--wav <dir>` writes each render there for a listen.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spectreCellPayload } from '../../../packages/engine/src/inserts/spectreCells';
import { SPECTRE_PARAMS, spectreParameters } from '../../../packages/engine/src/inserts/spectreParameters';
import { SPECTRE_PRESETS, applySpectrePreset } from '../../../packages/engine/src/inserts/spectrePresets';
import { DEFAULT_SPECTRE } from '../../../packages/engine/src/inserts/spectreSpec';
import { SpectreDsp } from '../../../packages/engine/src/worklet/spectre/spectreDsp';

const RATE = 48000;
const MATERIAL_S = 2;
const TAIL_S = 2;
const BPM = 120;

type Material = 'drums' | 'line' | 'pad';
const GROUP_MATERIAL: Record<string, Material> = {
  Drums: 'drums',
  'Vocals & leads': 'line',
  'Pads & textures': 'pad',
  'Freeze & FX': 'drums',
};

function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    return (s / 2 ** 32) * 2 - 1;
  };
}

/** Two seconds of each material, then silence for the tail. */
function material(kind: Material): Float32Array {
  const n = (MATERIAL_S + TAIL_S) * RATE,
    x = new Float32Array(n),
    hiss = noise(7),
    beat = (60 / BPM) * RATE;
  for (let i = 0; i < MATERIAL_S * RATE; i++) {
    const t = i / RATE;
    if (kind === 'drums') {
      const inBeat = i % beat,
        inEighth = i % (beat / 2),
        bar = Math.floor(i / beat) % 4;
      const kick = inBeat < 0.25 * RATE ? 0.8 * Math.exp(-inBeat / (0.05 * RATE)) * Math.sin(2 * Math.PI * 55 * (inBeat / RATE) * (1 + 2 * Math.exp(-inBeat / 800))) : 0;
      const snare = (bar === 1 || bar === 3) && inBeat < 0.2 * RATE ? 0.4 * Math.exp(-inBeat / (0.04 * RATE)) * hiss() : 0;
      const hat = inEighth < 0.05 * RATE ? 0.15 * Math.exp(-inEighth / (0.01 * RATE)) * hiss() : 0;
      x[i] = kick + snare + hat;
    } else if (kind === 'line') {
      const f = 220 * 2 ** ([0, 3, 5, 7, 5, 3, 0, -2][Math.floor(t * 4) % 8]! / 12) * (1 + 0.01 * Math.sin(2 * Math.PI * 5.5 * t));
      let v = 0;
      for (let h = 1; h <= 20; h++) {
        const formant = Math.exp(-(((h * f - 700) / 400) ** 2)) + 0.6 * Math.exp(-(((h * f - 1800) / 600) ** 2)) + 0.05;
        v += (formant / h) * Math.sin(2 * Math.PI * h * f * t);
      }
      x[i] = 0.25 * v * Math.min(1, t * 20, (MATERIAL_S - t) * 20);
    } else {
      let v = 0;
      for (const f of [130.81, 164.81, 196, 246.94]) for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * h * f * t * (1 + 0.002 * h)) / h;
      x[i] = 0.08 * v * Math.min(1, t * 4, (MATERIAL_S - t) * 4);
    }
  }
  return x;
}

function render(number: number, kind: Material): { left: Float32Array; right: Float32Array } {
  const spec = { ...applySpectrePreset(DEFAULT_SPECTRE, number), mix: 1 };
  // Every declared param, the stage's own `pitches` at its default, as Chrome hands them.
  const values = {
    ...Object.fromEntries(SPECTRE_PARAMS.map((p) => [p.name, p.defaultValue])),
    ...spectreParameters(spec, BPM),
  };
  const params: Record<string, Float32Array> = {};
  for (const [k, v] of Object.entries(values)) params[k] = new Float32Array([v]);
  const dsp = new SpectreDsp(RATE, params, false);
  dsp.cells.load(spectreCellPayload(spec));
  const input = material(kind);
  const left = new Float32Array(input.length),
    right = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    if (i % 128 === 0) dsp.configure(params);
    dsp.inputLeft = input[i]!;
    dsp.inputRight = input[i]!;
    dsp.tick();
    left[i] = dsp.left;
    right[i] = dsp.right;
  }
  return { left, right };
}

const db = (v: number): number => 20 * Math.log10(Math.max(v, 1e-12));

const wavAt = process.argv.indexOf('--wav');
const wavDir = wavAt > 0 ? process.argv[wavAt + 1] : undefined;
const reference: Record<string, number> = {};
console.log('#  preset              group             RMS dBFS  vs first  peak');
for (const preset of SPECTRE_PRESETS) {
  const kind = GROUP_MATERIAL[preset.group]!;
  const { left, right } = render(preset.number, kind);
  let sum = 0,
    peak = 0;
  for (let i = 0; i < left.length; i++) {
    sum += left[i]! * left[i]! + right[i]! * right[i]!;
    peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
  }
  const rms = db(Math.sqrt(sum / (2 * left.length)));
  reference[preset.group] ??= rms;
  const off = rms - reference[preset.group]!;
  console.log(
    `${String(preset.number).padStart(2)} ${preset.label.padEnd(20)}${preset.group.padEnd(18)}${rms.toFixed(1).padStart(8)}${off.toFixed(1).padStart(10)}${db(peak).toFixed(1).padStart(7)}${Math.abs(off) > 2 ? '  ← outside ±2 dB' : ''}`,
  );
  if (wavDir) {
    const data = new Int16Array(2 * left.length);
    for (let i = 0; i < left.length; i++) {
      data[2 * i] = Math.max(-1, Math.min(1, left[i]!)) * 32767;
      data[2 * i + 1] = Math.max(-1, Math.min(1, right[i]!)) * 32767;
    }
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.byteLength, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(2, 22);
    header.writeUInt32LE(RATE, 24);
    header.writeUInt32LE(RATE * 4, 28);
    header.writeUInt16LE(4, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.byteLength, 40);
    writeFileSync(join(wavDir, `${String(preset.number).padStart(2, '0')} ${preset.label}.wav`), Buffer.concat([header, Buffer.from(data.buffer)]));
  }
}
