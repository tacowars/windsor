/* global process, console, Buffer */
/**
 * The Dub delay's listening renders (record `2026-10-17-dub-delay-regeneration`):
 * stereo 48 kHz 16-bit WAVs, written outside the repository for tacowars's
 * ear and never committed.
 *
 *   node docs/research/2026-10-17-dub-delay-regeneration/listen.mjs [--out ~/Desktop/dub-delay]
 *
 * The source is synthetic and deterministic: an offbeat chord skank (a
 * decaying, slightly detuned saw triad on the "and" of each beat) and a
 * rimshot click on beats 2 and 4, at 75 BPM, for 4 bars, then 4 bars of
 * silence so the repeats ring on alone. Each file plays it through the
 * shipped `worklet/generated/delay-processor.js`, its parameters written by
 * the engine's own `inserts/delayParameters.ts` and starting points (bundled
 * here with esbuild), so the render is what the browser plays.
 *
 * - `preset-<id>.wav`: each starting point, Mix 0.45.
 * - `ride-feedback.wav`: Roots dub with Feedback ridden from 0.6 to 1 over
 *   bars 2 to 6, the throw pushed into regeneration.
 * - `runaway-sustain.wav`: Runaway with Sustain pressed at bar 4 and its
 *   cutoff swept by hand from 400 Hz to 1.6 kHz while held, released at bar 7.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSync } from 'esbuild';

const RATE = 48000;
const BLOCK = 128;
const BPM = 75;
const BEAT = (60 / BPM) * RATE;
const BARS = 8;
const PLAYED = 4;

const args = { out: join(homedir(), 'Desktop', 'dub-delay'), repo: '.' };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
}
const engine = resolve(args.repo, 'packages/engine/src');

/** The engine's parameter mapping and presets, bundled from their TypeScript. */
async function engineModules() {
  const { outputFiles } = buildSync({
    stdin: {
      contents: `export { delayParameters } from './inserts/delayParameters';
        export { DEFAULT_DELAY } from './inserts/delaySpec';
        export { DELAY_PRESETS, applyDelayPreset } from './inserts/delayPresets';`,
      resolveDir: engine,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'neutral',
  });
  const url = `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`;
  return import(url);
}

/** The shipped processor, under the shims the test harness uses. */
function loadProcessor(params) {
  const source = readFileSync(join(engine, 'worklet/generated/delay-processor.js'), 'utf8');
  class Base {
    constructor() {
      this.port = { postMessage() {}, onmessage: null, close() {} };
    }
  }
  let Processor;
  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', source)(
    Base,
    RATE,
    (_name, cls) => (Processor = cls),
  );
  const parameterData = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v[0]]));
  return new Processor({ parameterData, processorOptions: {} });
}

/** The skank and the rim, left and right, deterministic. */
function source(frames) {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const chord = [220, 261.63, 329.63];
  let seed = 0x2545f491;
  // xorshift32: a click's noise, deterministic.
  const noise = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x7fffffff - 1;
  };
  for (let beat = 0; beat < PLAYED * 4; beat++) {
    const skank = Math.round((beat + 0.5) * BEAT);
    for (let i = 0; i < 0.12 * RATE && skank + i < frames; i++) {
      const t = i / RATE;
      const env = Math.exp(-t * 28) * 0.18;
      let s = 0;
      for (const hz of chord) s += 2 * ((t * hz * 1.003) % 1) - 1 + (2 * ((t * hz) % 1) - 1);
      left[skank + i] += env * s * 0.3;
      right[skank + i] += env * s * 0.26;
    }
    if (beat % 2 === 1) {
      const rim = Math.round(beat * BEAT);
      for (let i = 0; i < 0.035 * RATE; i++) {
        const t = i / RATE;
        const v = (noise() * 0.5 + Math.sin(2 * Math.PI * 1700 * t)) * Math.exp(-t * 160) * 0.35;
        left[rim + i] += v;
        right[rim + i] += v;
      }
    }
  }
  return [left, right];
}

/** `spec` rendered over the program; `automate(frame, params)` may move parameters per block. */
function render(m, spec, automate = () => {}) {
  const params = Object.fromEntries(
    Object.entries(m.delayParameters(spec, BPM)).map(([k, v]) => [k, new Float32Array([v])]),
  );
  const processor = loadProcessor(params);
  const frames = Math.ceil((BARS * 4 * BEAT) / BLOCK) * BLOCK;
  const [inL, inR] = source(frames);
  const out = [new Float32Array(frames), new Float32Array(frames)];
  const input = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  const output = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  for (let frame = 0; frame < frames; frame += BLOCK) {
    automate(frame, params);
    input[0].set(inL.subarray(frame, frame + BLOCK));
    input[1].set(inR.subarray(frame, frame + BLOCK));
    processor.process([input], [output], params);
    out[0].set(output[0], frame);
    out[1].set(output[1], frame);
  }
  return out;
}

/** Stereo 16-bit WAV. */
function wav([left, right]) {
  const data = Buffer.alloc(left.length * 4);
  for (let i = 0; i < left.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), i * 4 + 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(2, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 4, 28);
  head.writeUInt16LE(4, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

function save(name, channels) {
  const file = join(args.out, `${name}.wav`);
  writeFileSync(file, wav(channels));
  let peak = 0;
  for (const c of channels) for (const s of c) peak = Math.max(peak, Math.abs(s));
  console.log(`${file}: peak ${peak.toFixed(3)}`);
}

const m = await engineModules();
mkdirSync(args.out, { recursive: true });
const bar = 4 * BEAT;
for (const preset of m.DELAY_PRESETS) {
  save(`preset-${preset.id}`, render(m, { ...m.applyDelayPreset(m.DEFAULT_DELAY, preset.id), mix: 0.45 }));
}
save(
  'ride-feedback',
  render(m, { ...m.applyDelayPreset(m.DEFAULT_DELAY, 'dub'), mix: 0.45 }, (frame, p) => {
    const u = Math.min(1, Math.max(0, (frame - bar) / (4 * bar)));
    p.feedback[0] = 0.6 + 0.4 * u;
  }),
);
save(
  'runaway-sustain',
  render(m, { ...m.applyDelayPreset(m.DEFAULT_DELAY, 'runaway'), mix: 0.5 }, (frame, p) => {
    p.sustain[0] = frame >= 3 * bar && frame < 6 * bar ? 1 : 0;
    const u = Math.min(1, Math.max(0, (frame - 3 * bar) / (3 * bar)));
    p.cutoff[0] = 400 * 4 ** u;
  }),
);
