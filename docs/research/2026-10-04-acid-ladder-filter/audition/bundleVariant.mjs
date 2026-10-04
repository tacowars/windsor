/* global structuredClone, URL */
/**
 * The shipped FM bundle with the Acid Ladder's sound-design tunables
 * overridden (windsor#574), and a render of a list of frame-stamped events
 * through it. The bundle's text is
 * `packages/engine/src/worklet/generated/fm-processor.js`, evaluated under a
 * stand-in worklet scope as `scripts/sound-match/render.mjs` evaluates it;
 * an override rewrites one `var NAME = value;` line of that text before
 * evaluation, so the variant is the shipped code with one number changed.
 * With no overrides a note renders bit for bit as `render.mjs`'s
 * `renderNote` renders it (checked on the three acid patches and
 * `bass-digital` at notes 33, 45 and 57 when windsor#574 wrote this).
 *
 * The output is mono, (L + R) / 2, 48 kHz, 128-frame blocks, the processor
 * built with a seed, as `render.mjs` does.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BUNDLE = fileURLToPath(
  new URL('../../../../packages/engine/src/worklet/generated/fm-processor.js', import.meta.url),
);
export const SR = 48000;
const BLOCK = 128;
const MONO_GAIN = 0.5;

/** The constants an override may name: the three tunables of record decisions 4 and 7. */
export const TUNABLES = ['LADDER_FEEDBACK_MAX', 'LADDER_FEEDBACK_HP_HZ', 'LADDER_INPUT_SCALE'];

/** The bundle's text with each `{ NAME: value }` override written into its `var` line. */
function variantSource(overrides) {
  let source = readFileSync(BUNDLE, 'utf8');
  for (const [name, value] of Object.entries(overrides)) {
    if (!TUNABLES.includes(name)) throw new Error(`${name} is not one of ${TUNABLES.join(', ')}`);
    if (!Number.isFinite(value)) throw new Error(`${name} must be a number, got ${value}`);
    const line = new RegExp(`^var ${name} = [^;]+;$`, 'm');
    if (!line.test(source)) throw new Error(`the bundle has no "var ${name} = …;" line`);
    source = source.replace(line, `var ${name} = ${value};`);
  }
  return source;
}

/** The processor class of the bundle with `overrides`, and its frame setter. */
export function loadVariant(overrides = {}) {
  const source = variantSource(overrides);
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
    `let currentFrame = 0; ${source}; return { setFrame: (f) => { currentFrame = f; } };`,
  )(SR, PortShim, (_name, cls) => {
    Processor = cls;
  });
  return { Processor, setFrame: scope.setFrame };
}

/**
 * `events` (`{ type: 'noteOn', id, note, velocity, mod?, slide?, frame }` or
 * `{ type: 'noteOff', id, frame }`, frames from 0) through a fresh processor
 * playing `patch`, for `seconds`. Each event reaches the processor before the
 * block that holds its frame. `options`: `seconds`, and the processor's
 * `seed` (1), `maxVoices` (4) and `slideSeconds` (the processor's own 0 when
 * omitted; the engine passes `SLIDE_SECONDS_DEFAULT`). Mono, (L + R) / 2.
 */
export function renderEvents(variant, patch, events, options) {
  const { seconds, seed = 1, maxVoices = 4, slideSeconds } = options;
  const processorOptions = { maxVoices, patch: structuredClone(patch), seed };
  if (slideSeconds !== undefined) processorOptions.slideSeconds = slideSeconds;
  const processor = new variant.Processor({ processorOptions });
  const frames = Math.round(seconds * SR);
  const blocks = Math.ceil(frames / BLOCK);
  const out = new Float32Array(blocks * BLOCK);
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const params = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  const queue = [...events].sort((a, b) => a.frame - b.frame);
  let next = 0;
  variant.setFrame(0);
  for (let b = 0; b < blocks; b++) {
    const start = b * BLOCK;
    variant.setFrame(start);
    while (next < queue.length && queue[next].frame < start + BLOCK) {
      processor.inbox(queue[next++]);
    }
    processor.process([], [[left, right]], params);
    for (let i = 0; i < BLOCK; i++) out[start + i] = (left[i] + right[i]) * MONO_GAIN;
  }
  return out.subarray(0, frames);
}

/** One note-on at frame 0 and its note-off `gate` seconds later: `render.mjs`'s `renderNote`. */
export function renderNote(variant, patch, { note, velocity = 1, seconds, gate, seed = 1 }) {
  const events = [{ type: 'noteOn', id: 1, note, velocity, frame: 0 }];
  if (gate != null) events.push({ type: 'noteOff', id: 1, note, frame: Math.round(gate * SR) });
  return renderEvents(variant, patch, events, { seconds, seed });
}
