/* global URL, structuredClone, Buffer */
// Renders one kick hit through the shipped FM worklet bundle under Node, the
// way `__fixtures__/workletHarness.ts` does, and writes 16-bit mono WAVs.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENGINE = fileURLToPath(new URL('../../../packages/engine/src/', import.meta.url));
const SR = 48000;
const BLOCK = 128;

const bundle = readFileSync(`${ENGINE}worklet/generated/fm-processor.js`, 'utf8');
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

/** A library patch by id, e.g. `tr909-kick`. */
export function loadPatch(id) {
  return JSON.parse(readFileSync(`${ENGINE}patches/${id}.json`, 'utf8')).patch;
}

/** One note-on at frame 0, rendered for `seconds`; the left channel. */
export function renderHit(patch, { note = 60, vel = 1, seconds = 0.6, seed = 0xa204 } = {}) {
  const processor = new Processor({
    processorOptions: { maxVoices: 4, patch: structuredClone(patch), seed },
  });
  const blocks = Math.ceil((seconds * SR) / BLOCK);
  const out = new Float32Array(blocks * BLOCK);
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const params = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    cutoffMod: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  scope.setFrame(0);
  processor.inbox({ type: 'noteOn', id: 1, note, velocity: vel, frame: 0 });
  for (let b = 0; b < blocks; b++) {
    scope.setFrame(b * BLOCK);
    processor.process([], [[left, right]], params);
    out.set(left, b * BLOCK);
  }
  return out;
}

/** A 16-bit mono WAV at the worklet's rate. */
export function writeWav(path, samples) {
  const n = samples.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767)));
    b.writeInt16LE(v, 44 + i * 2);
  }
  writeFileSync(path, b);
}
