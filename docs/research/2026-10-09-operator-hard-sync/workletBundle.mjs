/* global structuredClone */
/**
 * The shipped FM bundle under Node for windsor#646's research, as
 * `__fixtures__/workletHarness.ts` and `scripts/sound-match/render.mjs`
 * evaluate it: the bundle's text with a stand-in `AudioWorkletProcessor`,
 * 128-frame blocks, one held note-on at frame 0, seed 1. Research only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BLOCK = 128;

/** The bundle's text at `repo`. */
export function bundleText(repo) {
  return readFileSync(join(repo, 'packages/engine/src/worklet/generated/fm-processor.js'), 'utf8');
}

/** The bundle with its polyBLEP's gain set to 0: the resets uncorrected, still a sample late. */
export function withoutBlep(text) {
  const line = 'var SYNC_BLEP_GAIN = 0.5;';
  if (!text.includes(line)) throw new Error(`the bundle has no "${line}"`);
  return text.replace(line, 'var SYNC_BLEP_GAIN = 0;');
}

/** The processor class from a bundle's text, evaluated at `sampleRate`. */
export function processorClass(text, sampleRate) {
  let Processor = null;
  class PortShim {
    constructor() {
      this.port = { postMessage() {}, onmessage: null };
    }
    inbox(message) {
      this.port.onmessage?.({ data: message });
    }
  }
  new Function(
    'sampleRate',
    'AudioWorkletProcessor',
    'registerProcessor',
    `let currentFrame = 0; ${text}; return null;`,
  )(sampleRate, PortShim, (_name, cls) => {
    Processor = cls;
  });
  return Processor;
}

/** A part playing `patch`, one held note at `note` from frame 0. */
export function heldPart(Processor, patch, note, specialise = true) {
  const processor = new Processor({
    processorOptions: { maxVoices: 4, patch: structuredClone(patch), seed: 1, specialise },
  });
  processor.inbox({ type: 'noteOn', id: 1, note, velocity: 1, frame: 0 });
  return processor;
}

/** Render `blocks` quanta of `processor`; `each(left, b)` sees every block's left channel. */
export function renderBlocks(processor, blocks, each) {
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const params = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  for (let b = 0; b < blocks; b++) {
    processor.process([], [[left, right]], params);
    each(left, b);
  }
}

/** The left channel of one held note, `frames` long, at `sampleRate`. */
export function renderNote(Processor, patch, note, frames) {
  const out = new Float64Array(frames);
  const processor = heldPart(Processor, patch, note);
  renderBlocks(processor, Math.ceil(frames / BLOCK), (left, b) => {
    for (let i = 0; i < BLOCK && b * BLOCK + i < frames; i++) out[b * BLOCK + i] = left[i];
  });
  return out;
}

/** Every envelope of `patch` held at its peak: attack 0, sustain 1, so nothing decays or sleeps. */
export function held(patch) {
  const out = structuredClone(patch);
  for (const op of out.ops) op.env = { ...op.env, attackTime: 0, sustainLevel: 1 };
  return out;
}

export { BLOCK };
