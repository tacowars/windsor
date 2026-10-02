/* global URL, structuredClone, Buffer, process, console */
/**
 * The listen for windsor#347: a held pad and a plucked bass, each rendered
 * plain and under decay lanes, through the shipped FM worklet bundle under
 * Node, the way `scripts/sound-match/render.mjs` and the tests' harness run
 * it. Each lane is fed as the browser feeds it: the part's slot map at
 * construction (`voiceSlots`), and each slot's k-rate value read once per
 * 128-frame quantum, from the lane's value at that quantum's start.
 *
 *   node docs/research/2026-10-01-automation-decay-listen/render.mjs [--out <dir>]
 *
 * writes the eight WAVs (16-bit PCM, mono as (L + R) / 2, 48 kHz) into
 * `--out`, or `windsor-decay-listen` in the system temp folder, never into
 * the repository (tacowars keeps audio out of git), and prints each render's largest
 * sample-to-sample step, the click measure of `__fixtures__/voiceClicks.ts`.
 * Each instrument's renders share one gain, so they compare level for level.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE = fileURLToPath(new URL('../../../packages/engine/src/', import.meta.url));
const SR = 48000;
const BLOCK = 128;
const SECONDS = 6;
/** 120 BPM: a sixteenth is 125 ms. */
const SIXTEENTH = 0.125;
/** The player's de-click ramp on a square's edge (`AUTOMATION_STEP_RAMP_SECONDS`). */
const EDGE = 0.004;
/** Each instrument's loudest render peaks here, in dBFS. */
const PEAK_DB = -1;

/** The processor class, from the shipped bundle evaluated once. */
function loadProcessor() {
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
  return { Processor, scope };
}

const { Processor, scope } = loadProcessor();
const libraryPatch = (id) =>
  JSON.parse(readFileSync(`${ENGINE}patches/${id}.json`, 'utf8')).patch;

/** The number at `path` in `patch`. */
function valueAt(patch, path) {
  let at = patch;
  for (const key of path.split('.')) at = at[key];
  return at;
}

/**
 * The slot offset that makes `value` sound over the patch's `base`, as
 * `voiceOffset` (`synth/voiceAutomation.ts`) works it out: a decay time's
 * log2 ratio from its 1 ms floor, a decay curve's difference.
 */
function offsetOf(path, base, value) {
  if (!path.endsWith('decayTime')) return value - base;
  const floor = 0.001;
  return Math.log2(Math.max(value, floor) / Math.max(base, floor));
}

/**
 * Render `events` on `patch` for SECONDS, slot `s` moving `lanes[s].path` to
 * `lanes[s].at(t)` (the lane's absolute value at `t` seconds, given the
 * patch's own value), mono.
 */
function render(patch, events, lanes = []) {
  const voiceSlots = lanes.map((lane) => lane.path);
  const processor = new Processor({
    processorOptions: { maxVoices: 8, patch: structuredClone(patch), seed: 1, voiceSlots },
  });
  const params = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    cutoffMod: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  for (let s = 0; s < 8; s++) params[`voiceSlot${s}`] = new Float32Array([0]);
  const frames = SECONDS * SR;
  const out = new Float32Array(frames);
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const queue = [...events].sort((a, b) => a.frame - b.frame);
  let next = 0;
  for (let start = 0; start < frames; start += BLOCK) {
    scope.setFrame(start);
    while (next < queue.length && queue[next].frame < start + BLOCK) {
      processor.inbox(queue[next++]);
    }
    lanes.forEach((lane, s) => {
      const base = valueAt(patch, lane.path);
      params[`voiceSlot${s}`][0] = offsetOf(lane.path, base, lane.at(start / SR, base));
    });
    processor.process([], [[left, right]], params);
    for (let i = 0; i < BLOCK && start + i < frames; i++) {
      out[start + i] = (left[i] + right[i]) / 2;
    }
  }
  return out;
}

/** A note from `on` to `off` seconds. */
const note = (id, pitch, on, off, velocity = 0.9) => [
  { type: 'noteOn', id, note: pitch, velocity, frame: Math.round(on * SR) },
  { type: 'noteOff', id, frame: Math.round(off * SR) },
];

/** 0 → 1 → 0 across the render. */
const triangle = (t) => 1 - Math.abs((2 * t) / SECONDS - 1);

/**
 * A square at a sixteenth's rate: 1 for a sixteenth, 0 for the next, each
 * edge a 4 ms ramp, starting `shift` seconds late so its edges fall inside
 * the notes rather than on them.
 */
function square(t, shift) {
  const u = t - shift;
  if (u < 0) return 0;
  const into = u % (2 * SIXTEENTH);
  if (into < SIXTEENTH) return Math.min(1, into / EDGE);
  return Math.max(0, 1 - (into - SIXTEENTH) / EDGE);
}

/** A lane on each of `paths`, its value `shape(t, base)`. */
const lanesOn = (paths, shape) => paths.map((path) => ({ path, at: shape }));

/** The decay times: each target's own, swept down to an eighth and back, log-even. */
const sweep = (t, base) => base * 2 ** (-3 * triangle(t));
/** The decay times: each target's own, or a sixteenth of it, a sixteenth at a time. */
const timeSquare = (t, base) => base * 2 ** (-4 * square(t, SIXTEENTH / 2));
/** The decay curves: from -1 (bowing up, fast first) to +1 (bowing down), a sixteenth at a time. */
const curveSquare = (t) => 2 * square(t, SIXTEENTH / 2) - 1;

/**
 * The held pad: `pad-drift`, its attacks shortened to 0.3 s and its
 * carriers' sustains lowered, so a four-second decay runs under the whole
 * chord. A C minor seventh, held 5.5 s.
 */
function pad() {
  const patch = structuredClone(libraryPatch('pad-drift'));
  for (const op of patch.ops) {
    op.env.attackTime = 0.3;
    op.env.decayTime = 4;
    op.env.sustainLevel = 0.2;
  }
  patch.filter.env.attackTime = 0.3;
  patch.filter.env.decayTime = 4;
  patch.filter.env.sustainLevel = 0;
  const events = [48, 55, 58, 63].flatMap((pitch, i) => note(i + 1, pitch, 0, 5.5, 0.8));
  return { patch, events };
}

/** The plucked bass: `bass-digital` as shipped, on a sixteenth-note line in C minor. */
function bass() {
  const patch = libraryPatch('bass-digital');
  const line = [36, 36, 48, 36, 39, 36, 46, 36, 34, 34, 46, 34, 31, 43, 34, 38];
  const steps = Math.floor(SECONDS / SIXTEENTH) - 2;
  const events = Array.from({ length: steps }, (_, k) =>
    note(k + 1, line[k % line.length], k * SIXTEENTH, k * SIXTEENTH + 0.9 * SIXTEENTH),
  ).flat();
  return { patch, events };
}

const DECAY_TIMES = ['filter.env.decayTime', ...[0, 1, 2, 3].map((i) => `ops.${i}.env.decayTime`)];
const DECAY_CURVES = [0, 1, 2, 3].map((i) => `ops.${i}.env.decayCurve`);

const RENDERS = [
  ['pad-plain', pad, []],
  ['pad-decay-sweep', pad, lanesOn(DECAY_TIMES, sweep)],
  ['pad-decay-square', pad, lanesOn(DECAY_TIMES, timeSquare)],
  ['pad-curve-square', pad, lanesOn(DECAY_CURVES, curveSquare)],
  ['bass-plain', bass, []],
  ['bass-decay-sweep', bass, lanesOn(DECAY_TIMES, sweep)],
  ['bass-decay-square', bass, lanesOn(DECAY_TIMES, timeSquare)],
  ['bass-curve-square', bass, lanesOn(DECAY_CURVES, curveSquare)],
];

/** 16-bit PCM mono at the worklet's rate. */
function writeWav(path, samples, gain) {
  const bytes = samples.length * 2;
  const b = Buffer.alloc(44 + bytes);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + bytes, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(bytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] * gain));
    b.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(path, b);
}

const peakOf = (s) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
function largestStep(s) {
  let max = 0;
  for (let i = 1; i < s.length; i++) max = Math.max(max, Math.abs(s[i] - s[i - 1]));
  return max;
}

function main() {
  const at = process.argv.indexOf('--out');
  const dir = at > 0 ? process.argv[at + 1] : join(tmpdir(), 'windsor-decay-listen');
  mkdirSync(dir, { recursive: true });
  const rendered = RENDERS.map(([name, make, lanes]) => {
    const { patch, events } = make();
    return { name, group: name.split('-')[0], samples: render(patch, events, lanes) };
  });
  const target = 10 ** (PEAK_DB / 20);
  for (const group of new Set(rendered.map((r) => r.group))) {
    const mine = rendered.filter((r) => r.group === group);
    const gain = target / Math.max(...mine.map((r) => peakOf(r.samples)));
    for (const r of mine) {
      writeWav(join(dir, `${r.name}.wav`), r.samples, gain);
      const step = (largestStep(r.samples) * gain).toFixed(4);
      console.log(`${r.name}.wav  gain ${gain.toFixed(3)}  largest step ${step}`);
    }
  }
}

main();
