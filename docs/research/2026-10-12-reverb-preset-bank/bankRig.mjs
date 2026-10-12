/* global process, console, URL, Buffer */
// The Reverb preset bank's rig (windsor#774): renders each preset at Mix 1,
// 48 kHz, through the shipped reverb-processor.js, and prints its broadband
// T30 from an impulse and its wet RMS and peak on two short materials, a drum
// loop and a pad chord. It loads the processor with the Build rig's loader.
//
//   node docs/research/2026-10-12-reverb-preset-bank/bankRig.mjs [--wav <dir>]
//
// The bank is read from the engine's table files themselves (Node strips
// their types). `--wav` writes each render to <dir> for a listen; no audio
// belongs in git.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BLOCK, loadPlate, render, t30 } from '../2026-10-12-plate-build/buildRig.mjs';
import { EVERYDAY_PRESETS } from '../../../packages/engine/src/inserts/reverbPresetsEveryday.ts';
import { DRUMS_PRESETS } from '../../../packages/engine/src/inserts/reverbPresetsDrums.ts';
import { PADS_PRESETS } from '../../../packages/engine/src/inserts/reverbPresetsPads.ts';
import { AMBIENT_PRESETS } from '../../../packages/engine/src/inserts/reverbPresetsAmbient.ts';

const RATE = 48000;
const BUNDLE = fileURLToPath(
  new URL('../../../packages/engine/src/worklet/generated/reverb-processor.js', import.meta.url),
);
/** Seconds the plate settles at its Size before any input. */
const SETTLE = 0.5;
/** The materials last this long; the render runs on for the tail. */
const MATERIAL_S = 2;
/** The longest a material render runs, tail included. */
const CAP_S = 12;

export const BANK = [...EVERYDAY_PRESETS, ...DRUMS_PRESETS, ...PADS_PRESETS, ...AMBIENT_PRESETS];

/** The note's Decay aims (§8), seconds; Resident's is today's `hall`. */
export const AIMS = {
  Resident: 6.35, 'House Plate': 1.6, 'Main Room': 1, 'Back Room': 0.6, 'Warm-up': 1.1,
  Booth: 0.35, 'Mic Check': 1, 'Long Set': 3, Dubplate: 0.9, Rewind: 1.6, 'Club Toilets': 0.6,
  'Railway Arch': 0.5, Cloakroom: 1.2, Stairwell: 1.3, 'Sound Clash': 1.2, Acetate: 1.8,
  'White Label': 2.5, Euphoria: 3.5, 'Hands in the Air': 4, Breakdown: 3, 'Sunrise Set': 4,
  Afters: 6, 'Last Train': 8, Comedown: 5, 'Old Mill': 4, 'Lights Up': 5, 'Sound System': 4,
};

/** The material each group's level is read on. */
export const GROUP_MATERIAL = {
  Everyday: 'drums', Drums: 'drums', 'Pads & leads': 'pad', Ambient: 'pad',
};

/** A seeded uniform in [-1, 1), so every run renders the same noise. */
function noise(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 2 ** 32) * 2 - 1;
  };
}

/**
 * One bar at 120 bpm: a kick on each beat, a snare on 2 and 4, and closed
 * hats on the off-beats, panned left and right in turn so a stereo input
 * shows. Peak 0.5.
 */
function drumLoop() {
  const n = MATERIAL_S * RATE;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rnd = noise(7);
  const beat = RATE / 2;
  for (let b = 0; b < 4; b++) {
    const at = b * beat;
    let phase = 0;
    for (let i = 0; i < 0.35 * RATE && at + i < n; i++) {
      const t = i / RATE;
      phase += (2 * Math.PI * (45 + 90 * Math.exp(-t / 0.03))) / RATE;
      const v = 0.9 * Math.sin(phase) * Math.exp(-t / 0.12);
      L[at + i] += v;
      R[at + i] += v;
    }
    if (b % 2 === 1) {
      for (let i = 0; i < 0.2 * RATE && at + i < n; i++) {
        const t = i / RATE;
        const v = 0.5 * rnd() * Math.exp(-t / 0.05) + 0.3 * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t / 0.04);
        L[at + i] += v;
        R[at + i] += v;
      }
    }
    const hat = at + beat / 2;
    let previous = 0;
    for (let i = 0; i < 0.05 * RATE && hat + i < n; i++) {
      const white = rnd();
      const v = 0.3 * (white - previous) * Math.exp(-(i / RATE) / 0.012);
      previous = white;
      L[hat + i] += b % 2 === 0 ? v : 0.3 * v;
      R[hat + i] += b % 2 === 0 ? 0.3 * v : v;
    }
  }
  return normalise(L, R);
}

/**
 * An A minor seventh (A3 C4 E4 G4), two detuned saws a note, softened by a
 * one-pole low-pass at 2.5 kHz: a 0.2 s attack, held, and a 0.3 s release
 * ending at 2 s. Peak 0.5.
 */
function padChord() {
  const n = MATERIAL_S * RATE;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const notes = [220, 261.63, 329.63, 392];
  const pole = Math.exp((-2 * Math.PI * 2500) / RATE);
  let lowL = 0;
  let lowR = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / 0.2, Math.max(0, (MATERIAL_S - t) / 0.3));
    let l = 0;
    let r = 0;
    for (const f of notes) {
      l += ((t * f * 1.003) % 1) * 2 - 1;
      r += ((t * f * 0.997) % 1) * 2 - 1;
    }
    lowL = (1 - pole) * l * env + pole * lowL;
    lowR = (1 - pole) * r * env + pole * lowR;
    L[i] = lowL;
    R[i] = lowR;
  }
  return normalise(L, R);
}

function normalise(L, R) {
  let peak = 0;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  for (let i = 0; i < L.length; i++) {
    L[i] *= 0.5 / peak;
    R[i] *= 0.5 / peak;
  }
  return { L, R };
}

export const MATERIALS = { drums: drumLoop(), pad: padChord() };

/** A space as the processor's parameters, at Mix 1. */
export const params = (space) => ({
  ...space,
  voicing: space.voicing === 'room' ? 1 : 0,
  wet: 1,
  dry: 0,
});

const plate = loadPlate(BUNDLE, RATE);

/** Broadband T30 of one click, rendered for long enough to reach −35 dB. */
export function measureT30(space) {
  const { L, R } = render(plate, space.preDelay + 1.2 * space.decay * space.lowDecay + 1, params(space));
  return t30(L, R, RATE);
}

/**
 * A material render's length: the material, the pre-delay, then the tail's
 * nominal RT60 (Decay, or the low band's when it rings longer), capped.
 */
export const tailSeconds = (space) =>
  Math.min(CAP_S, MATERIAL_S + space.preDelay + space.decay * Math.max(1, space.lowDecay));

/** The wet render of `material` after the settle, the material then its tail, capped. */
export function renderMaterial(space, material) {
  const settleBlocks = Math.round((SETTLE * RATE) / BLOCK);
  const start = settleBlocks * BLOCK;
  const { L: inL, R: inR } = MATERIALS[material];
  const seconds = SETTLE + tailSeconds(space);
  const feed = (block, l, r) => {
    for (let i = 0; i < BLOCK; i++) {
      const at = block * BLOCK + i - start;
      if (at >= 0 && at < inL.length) {
        l[i] = inL[at];
        r[i] = inR[at];
      }
    }
  };
  const { L, R } = render(plate, seconds, params(space), { feed });
  return { L: L.subarray(start), R: R.subarray(start) };
}

/** Wet RMS and peak (dBFS) over the whole render: the material and its tail. */
export function level({ L, R }) {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < L.length; i++) {
    sum += L[i] * L[i] + R[i] * R[i];
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  return { rms: 10 * Math.log10(sum / (2 * L.length)), peak: 20 * Math.log10(peak) };
}

/** A 16-bit stereo WAV of a render, for a listen. */
function wav(path, { L, R }) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  const clip = (v) => Math.round(Math.max(-1, Math.min(1, v)) * 32767);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(clip(L[i]), 44 + i * 4);
    buf.writeInt16LE(clip(R[i]), 46 + i * 4);
  }
  writeFileSync(path, buf);
}

/** Every figure for one preset; the level against `resident`'s on the group's material. */
export function measure(preset, resident) {
  const renders = { drums: renderMaterial(preset.settings, 'drums'), pad: renderMaterial(preset.settings, 'pad') };
  const drums = level(renders.drums);
  const pad = level(renders.pad);
  const material = GROUP_MATERIAL[preset.group];
  const own = material === 'drums' ? drums : pad;
  return {
    t30: measureT30(preset.settings),
    drums,
    pad,
    material,
    vsResident: resident ? own.rms - resident[material].rms : 0,
    peak: own.peak,
    renders,
  };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const wavAt = process.argv.indexOf('--wav');
  const dir = wavAt > 0 ? process.argv[wavAt + 1] : undefined;
  const resident = measure(BANK[0]);
  const fmt = (v, d = 1) => (v >= 0 ? '+' : '') + v.toFixed(d);
  console.log('| # | Preset | Group | Voicing | Aim s | T30 s | vs aim | Material | Level vs Resident dB | Peak dBFS | Drums RMS | Pad RMS |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const preset of BANK) {
    const m = preset === BANK[0] ? resident : measure(preset, resident);
    const aim = AIMS[preset.label];
    const off = (m.t30 / aim - 1) * 100;
    console.log(
      `| ${preset.number} | ${preset.label} | ${preset.group} | ${preset.settings.voicing} | ${aim} | ${m.t30.toFixed(2)} | ${fmt(off, 0)} % | ${m.material} | ${fmt(m.vsResident)} | ${m.peak.toFixed(1)} | ${m.drums.rms.toFixed(1)} | ${m.pad.rms.toFixed(1)} |`,
    );
    if (dir) {
      const slug = `${String(preset.number).padStart(2, '0')}-${preset.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      wav(join(dir, `${slug}-drums.wav`), m.renders.drums);
      wav(join(dir, `${slug}-pad.wav`), m.renders.pad);
    }
  }
}
