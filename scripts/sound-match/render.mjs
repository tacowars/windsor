/* global URL, structuredClone, Buffer, process */
/**
 * Renders one note of a patch through the shipped FM worklet bundle
 * (`packages/engine/src/worklet/generated/fm-processor.js`) under Node, the way
 * `__fixtures__/workletHarness.ts` does: the bundle's text evaluated with a
 * stand-in `AudioWorkletProcessor`, one note-on at frame 0, 128-frame blocks
 * at 48 kHz, the left channel kept.
 *
 * Every render passes `processorOptions.seed`, so noise, free-running start
 * phases and random pan are reproducible here. Live playback passes none and
 * keeps drawing from `Math.random` (`worklet/fm/prng.ts`); nothing here
 * changes that.
 *
 * One render, to a WAV (32-bit float, mono, 48 kHz):
 *
 *   node render.mjs <patch> [--note 60] [--velocity 1] [--seconds 1]
 *                   [--gate <s>] [--seed 1] [--out out.wav]
 *
 * `<patch>` is a library id (`tr909-kick`), a library file (`{ format, …,
 * patch }`) or a bare patch JSON file. `--gate` sends a note-off that many
 * seconds after the note-on; without it no note-off is sent. `--out` defaults
 * to `<tmp>/sound-match/render.wav`.
 *
 * Server mode, for a fitter that must not pay Node's start-up per render:
 *
 *   node render.mjs --server
 *
 * reads one JSON request per stdin line, `{ patch, note, velocity, seconds,
 * gate, seed, out }`, where `patch` is an id, a path or a patch object. With
 * `out` it writes that WAV and answers `{"ok":true,"frames":n,"out":path}`.
 * Without it the answer line is followed by `frames` little-endian float32
 * samples on stdout. A failed request answers `{"ok":false,"error":…}`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ENGINE = fileURLToPath(new URL('../../packages/engine/src/', import.meta.url));
const SR = 48000;
const BLOCK = 128;
const DEFAULTS = { note: 60, velocity: 1, seconds: 1, gate: null, seed: 1 };

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
const patchCache = new Map();

/** A patch from an id, a path, a library wrapper or a bare patch object. */
export function resolvePatch(source) {
  if (typeof source === 'object' && source !== null) return source.patch ?? source;
  if (!patchCache.has(source)) {
    const path = existsSync(source) ? source : `${ENGINE}patches/${source}.json`;
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    patchCache.set(source, parsed.patch ?? parsed);
  }
  return patchCache.get(source);
}

/** One note-on at frame 0 (and a note-off at `gate` seconds, if given); the left channel. */
export function renderNote(patch, options = {}) {
  const { note, velocity, seconds, gate, seed } = { ...DEFAULTS, ...options };
  const processor = new Processor({
    processorOptions: { maxVoices: 4, patch: structuredClone(patch), seed },
  });
  const frames = Math.round(seconds * SR);
  const blocks = Math.ceil(frames / BLOCK);
  const out = new Float32Array(blocks * BLOCK);
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const params = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    cutoffMod: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  const gateFrame = gate == null ? -1 : Math.round(gate * SR);
  scope.setFrame(0);
  processor.inbox({ type: 'noteOn', id: 1, note, velocity, frame: 0 });
  for (let b = 0; b < blocks; b++) {
    const start = b * BLOCK;
    scope.setFrame(start);
    if (gateFrame >= start && gateFrame < start + BLOCK) {
      processor.inbox({ type: 'noteOff', id: 1, note, frame: gateFrame });
    }
    processor.process([], [[left, right]], params);
    out.set(left, start);
  }
  return out.subarray(0, frames);
}

/** A 32-bit float mono WAV at the worklet's rate. */
export function writeWav(path, samples) {
  const bytes = samples.length * 4;
  const b = Buffer.alloc(44 + bytes);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + bytes, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(3, 20); // IEEE float
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(32, 34);
  b.write('data', 36);
  b.writeUInt32LE(bytes, 40);
  Buffer.from(samples.buffer, samples.byteOffset, bytes).copy(b, 44);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, b);
}

/** `--name value` pairs after the first positional argument. */
function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) options[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  return { options, positional };
}

function numberOr(value, fallback) {
  return value === undefined || value === null ? fallback : Number(value);
}

/** The render options of a request or a command line, defaults filled. */
function renderOptions(source) {
  return {
    note: numberOr(source.note, DEFAULTS.note),
    velocity: numberOr(source.velocity, DEFAULTS.velocity),
    seconds: numberOr(source.seconds, DEFAULTS.seconds),
    gate: numberOr(source.gate, DEFAULTS.gate),
    seed: numberOr(source.seed, DEFAULTS.seed),
  };
}

function answer(request) {
  const samples = renderNote(resolvePatch(request.patch), renderOptions(request));
  if (request.out) {
    writeWav(request.out, samples);
    process.stdout.write(
      `${JSON.stringify({ ok: true, frames: samples.length, out: request.out })}\n`,
    );
    return;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, frames: samples.length })}\n`);
  process.stdout.write(Buffer.from(samples.buffer, samples.byteOffset, samples.length * 4));
}

async function serve() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      answer(JSON.parse(line));
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: String(error?.message ?? error) })}\n`,
      );
    }
  }
}

function main() {
  const { options, positional } = parseArgs(process.argv.slice(2));
  if ('server' in options || positional[0] === '--server') return serve();
  if (positional.length !== 1) {
    process.stderr.write(
      'usage: node render.mjs <patch> [--note n] [--velocity v] [--seconds s] [--gate s] [--seed n] [--out wav]\n       node render.mjs --server\n',
    );
    process.exit(2);
  }
  const out = options.out ?? join(tmpdir(), 'sound-match', 'render.wav');
  writeWav(out, renderNote(resolvePatch(positional[0]), renderOptions(options)));
  process.stdout.write(`${out}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
