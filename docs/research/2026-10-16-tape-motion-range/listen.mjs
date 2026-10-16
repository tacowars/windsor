/* global URL, structuredClone, Buffer, process, console */
/**
 * The listen for windsor#818: a held C minor seventh (C3, G3, B♭3, E♭4),
 * rendered once through the shipped FM worklet bundle and then through the
 * shipped Tape bundle on the Ferric model, split, at Wow 0, 25, 50, 75 and
 * 100 (Flutter 0) and at Flutter 25, 50 and 100 (Wow 0), each at the default
 * rates, with Drive 0, Dropouts 0 and the hiss off, so the transport's pitch
 * motion is the only thing that differs. The pad is `pad-drift` with its
 * pitch LFO, its operator LFO and its unison spread off and its attacks
 * shortened, so it holds a still pitch for the tape to move.
 *
 *   node docs/research/2026-10-16-tape-motion-range/listen.mjs [--out <dir>]
 *
 * writes the eight WAVs (16-bit PCM stereo, 48 kHz, 12 s) into `--out`, or
 * `windsor-tape-motion-listen` in the system temp folder, never into the
 * repository (tacowars keeps audio out of git). Every render shares one
 * gain, so they compare level for level.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE = fileURLToPath(new URL('../../../packages/engine/src/', import.meta.url));
const SR = 48000;
const BLOCK = 128;
const SECONDS = 12;
const HOLD = 11;
const PEAK_DB = -1;
const CHORD = [48, 55, 58, 63];
const FERRIC = 1;
const SEED = 12345;

/** A bundle's processor class, evaluated under Node with the worklet scope's names. */
function loadProcessor(file) {
  const bundle = readFileSync(`${ENGINE}worklet/generated/${file}`, 'utf8');
  let Processor = null;
  class PortShim {
    constructor() {
      this.port = { postMessage() {}, onmessage: null };
    }
    inbox(message) {
      this.port.onmessage?.({ data: message });
    }
  }
  const scope = new Function(
    'sampleRate',
    'AudioWorkletProcessor',
    'registerProcessor',
    `let currentFrame = 0; ${bundle}; return { setFrame: (f) => { currentFrame = f; } };`,
  )(SR, PortShim, (_name, cls) => {
    Processor = cls;
  });
  return { Processor, scope };
}

/** `pad-drift`, still: no pitch or operator LFO, no unison spread, a 0.3 s attack. */
function stillPad() {
  const patch = structuredClone(
    JSON.parse(readFileSync(`${ENGINE}patches/pad-drift.json`, 'utf8')).patch,
  );
  patch.lfo.toPitch = 0;
  patch.lfo.toOp = [0, 0, 0, 0];
  patch.spread = 0;
  for (const op of patch.ops) op.env.attackTime = 0.3;
  patch.filter.env.attackTime = 0.3;
  return patch;
}

/** The held chord through the FM bundle, stereo. */
function renderChord() {
  const { Processor, scope } = loadProcessor('fm-processor.js');
  const processor = new Processor({
    processorOptions: { maxVoices: 8, patch: stillPad(), seed: 1, voiceSlots: [] },
  });
  const params = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    cutoffMod: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  for (let s = 0; s < 8; s++) params[`voiceSlot${s}`] = new Float32Array([0]);
  const events = CHORD.flatMap((note, i) => [
    { type: 'noteOn', id: i + 1, note, velocity: 0.8, frame: 0 },
    { type: 'noteOff', id: i + 1, frame: HOLD * SR },
  ]).sort((a, b) => a.frame - b.frame);
  const frames = SECONDS * SR;
  const out = [new Float32Array(frames), new Float32Array(frames)];
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  let next = 0;
  for (let start = 0; start < frames; start += BLOCK) {
    scope.setFrame(start);
    while (next < events.length && events[next].frame < start + BLOCK)
      processor.inbox(events[next++]);
    processor.process([], [[left, right]], params);
    out[0].set(left.subarray(0, Math.min(BLOCK, frames - start)), start);
    out[1].set(right.subarray(0, Math.min(BLOCK, frames - start)), start);
  }
  return out;
}

const TAPE = loadProcessor('tape-processor.js').Processor;

/** `dry` through the Tape bundle at `setting` over its defaults, stereo. */
function renderTape(dry, setting) {
  const values = Object.fromEntries(
    TAPE.parameterDescriptors.map((d) => [d.name, d.defaultValue]),
  );
  Object.assign(values, { model: FERRIC, seed: SEED, split: 1 }, setting);
  const params = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, new Float32Array([value])]),
  );
  const processor = new TAPE({ parameterData: values, processorOptions: {} });
  const frames = dry[0].length;
  const out = [new Float32Array(frames), new Float32Array(frames)];
  const outputs = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
  for (let start = 0; start < frames; start += BLOCK) {
    const inputs = [[dry[0].subarray(start, start + BLOCK), dry[1].subarray(start, start + BLOCK)]];
    processor.process(inputs, outputs, params);
    const n = Math.min(BLOCK, frames - start);
    out[0].set(outputs[0][0].subarray(0, n), start);
    out[1].set(outputs[0][1].subarray(0, n), start);
  }
  return out;
}

const RENDERS = [
  ['wow-000', { wow: 0 }],
  ['wow-025', { wow: 25 }],
  ['wow-050', { wow: 50 }],
  ['wow-075', { wow: 75 }],
  ['wow-100', { wow: 100 }],
  ['flutter-025', { flutter: 25 }],
  ['flutter-050', { flutter: 50 }],
  ['flutter-100', { flutter: 100 }],
];

/** 16-bit PCM stereo at the worklet's rate. */
function writeWav(path, [left, right], gain) {
  const bytes = left.length * 4;
  const b = Buffer.alloc(44 + bytes);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + bytes, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(bytes, 40);
  const pcm = (v) => Math.round(Math.max(-1, Math.min(1, v * gain)) * 32767);
  for (let i = 0; i < left.length; i++) {
    b.writeInt16LE(pcm(left[i]), 44 + i * 4);
    b.writeInt16LE(pcm(right[i]), 46 + i * 4);
  }
  writeFileSync(path, b);
}

const peakOf = (channels) =>
  channels.reduce((m, s) => s.reduce((n, v) => Math.max(n, Math.abs(v)), m), 0);

function main() {
  const at = process.argv.indexOf('--out');
  const dir = at > 0 ? process.argv[at + 1] : join(tmpdir(), 'windsor-tape-motion-listen');
  mkdirSync(dir, { recursive: true });
  const dry = renderChord();
  const rendered = RENDERS.map(([name, setting]) => ({ name, out: renderTape(dry, setting) }));
  const gain = 10 ** (PEAK_DB / 20) / Math.max(...rendered.map((r) => peakOf(r.out)));
  for (const r of rendered) {
    const path = join(dir, `tape-${r.name}.wav`);
    writeWav(path, r.out, gain);
    console.log(`${path}  gain ${gain.toFixed(3)}`);
  }
}

main();
