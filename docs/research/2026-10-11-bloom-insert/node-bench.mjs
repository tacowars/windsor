/* global console, process, URL */
// bloom's cost per render quantum under Node: the generated bundle
// (`generated/bloom-processor.js`) in a minimal AudioWorkletGlobalScope, fed
// this folder's inputs (`inputs.js`, the Chrome bench's own),
// `--instances` processors interleaved quantum by quantum as the Chrome bench
// runs them. The input loops for `--passes` passes; the first is warmup, and
// the figure is the best of the rest, in ms per quantum per instance.
//
//   node docs/research/2026-10-11-bloom-insert/node-bench.mjs [--rate 48000|96000] [--input sines48|chord4]
//     [--seconds 4] [--passes 4] [--instances 1] [--params '{"sustain":2,"octave":12}']
//     [--bundle path/to/candidate.js]
//
// It also prints a checksum, so a change meant to be bit-exact can prove it:
// FNV-1a over the float32 bits of instance 0's stereo output in the first two
// passes (it depends on rate, input, seconds, params and bundle, not on passes
// or instances). And the bands at work, a mean per analysis step: the bands the
// bands module lists (`active`), the envelope lists (`sounding`), the synthesis
// rendered. `--bundle` times another build (a candidate change) instead.
//
// Limits: it calls `process` directly, without the AudioWorklet bridge, and
// Node's V8 is not Chrome's; read ratios, and check absolute figures in
// `bundle.html` beside this file.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { makeInput } from './inputs.js';

const QUANTUM = 128;
const { values: args } = parseArgs({
  options: {
    rate: { type: 'string', default: '48000' },
    input: { type: 'string', default: 'sines48' },
    seconds: { type: 'string', default: '4' },
    passes: { type: 'string', default: '4' },
    instances: { type: 'string', default: '1' },
    params: { type: 'string', default: '{}' },
    /** Another build of the bundle to time (a candidate change), instead of the generated one. */
    bundle: { type: 'string' },
  },
});
const rate = Number(args.rate),
  seconds = Number(args.seconds),
  passes = Math.max(2, Number(args.passes)),
  instances = Math.max(1, Number(args.instances)),
  overrides = JSON.parse(args.params);
if (args.input !== 'sines48' && args.input !== 'chord4') throw new Error(`--input ${args.input}`);

const bundle = readFileSync(
  args.bundle ??
    new URL('../../../packages/engine/src/worklet/generated/bloom-processor.js', import.meta.url),
  'utf8',
);

class Processor {
  port = { postMessage() {}, onmessage: null };
}

/** The processor class, from the bundle run in a fresh scope at `rate` (which builds its tables). */
function load() {
  let registered;
  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', 'currentTime', bundle)(
    Processor,
    rate,
    (_, cls) => (registered = cls),
    0,
  );
  return registered;
}

const Bloom = load();
const values = {};
for (const d of Bloom.parameterDescriptors) values[d.name] = d.defaultValue;
for (const name of Object.keys(overrides)) {
  if (!(name in values)) throw new Error(`--params: no parameter ${name}`);
  values[name] = overrides[name];
}
const params = Object.fromEntries(
  Object.entries(values).map(([k, v]) => [k, new Float32Array([v])]),
);

const input = makeInput(args.input, rate, seconds),
  quanta = Math.floor(input.length / QUANTUM);
const processors = Array.from({ length: instances }, () => new Bloom({ parameterData: values }));
const outs = processors.map(() => [new Float32Array(QUANTUM), new Float32Array(QUANTUM)]);
const block = new Float32Array(QUANTUM);
const inputs = [[block, block]];
/** Instance 0's output this pass, interleaved, hashed after the pass. */
const kept = new Float32Array(2 * quanta * QUANTUM);

let hash = 0x811c9dc5;
function fold(data) {
  const words = new Uint32Array(data.buffer, data.byteOffset, data.length);
  let h = hash;
  for (let i = 0; i < words.length; i++) {
    let w = words[i];
    for (let k = 0; k < 4; k++, w >>>= 8) h = Math.imul(h ^ (w & 0xff), 0x01000193);
  }
  hash = h >>> 0;
}

/** Per analysis step, summed: the bands' `active`, the envelope's `sounding`, the synthesis's rendered. */
const bandSums = { steps: 0, active: 0, sounding: 0, rendered: 0 };
function countBands(dsp) {
  bandSums.steps++;
  bandSums.active += dsp.bands.activeCount;
  bandSums.sounding += dsp.envelope.soundingCount;
  bandSums.rendered += dsp.synth.liveCount;
}

const took = [];
for (let pass = 0; pass < passes; pass++) {
  const start = process.hrtime.bigint();
  for (let q = 0; q < quanta; q++) {
    block.set(input.subarray(q * QUANTUM, (q + 1) * QUANTUM));
    for (let p = 0; p < instances; p++) processors[p].process(inputs, [outs[p]], params);
    kept.set(outs[0][0], 2 * q * QUANTUM);
    kept.set(outs[0][1], (2 * q + 1) * QUANTUM);
  }
  took.push(Number(process.hrtime.bigint() - start) / 1e6 / (quanta * instances));
  if (pass < 2) fold(kept);
}

// The bands at work, from a separate instance stepped untimed over one pass (after a pass of settling).
// It runs the processor's own loop (configure once a block, then `tick` a sample), so it can look in.
const probe = new Bloom({ parameterData: values }).dsp;
for (let pass = 0; pass < 2; pass++)
  for (let q = 0; q < quanta; q++) {
    probe.configure(QUANTUM);
    for (let i = q * QUANTUM; i < (q + 1) * QUANTUM; i++) {
      probe.inputLeft = probe.inputRight = input[i];
      probe.tick();
      if (pass === 1 && probe.decimator.ready) countBands(probe);
    }
  }

const best = Math.min(...took.slice(1)),
  quantumMs = (QUANTUM / rate) * 1000,
  mean = (x) => +(x / bandSums.steps).toFixed(2);
console.log(
  JSON.stringify({
    node: process.version,
    rate,
    input: args.input,
    seconds,
    instances,
    params: overrides,
    passesMs: took.map((x) => +x.toFixed(4)),
    msPerQuantum: +best.toFixed(4),
    percentOfQuantum: +((100 * best) / quantumMs).toFixed(2),
    bands: {
      active: mean(bandSums.active),
      sounding: mean(bandSums.sounding),
      rendered: mean(bandSums.rendered),
    },
    checksum: hash.toString(16).padStart(8, '0'),
  }),
);
