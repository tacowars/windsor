/* global console, process, structuredClone */
// windsor#301 dev-machine microbench: the FM part's render with envelope
// edges at their own samples against main. The shipped bundle of a checkout,
// evaluated as `scripts/sound-match/render.mjs` evaluates it, so one script
// measures both checkouts (no TypeScript, no harness).
// Usage: node bench.mjs <checkout root> <scenario> [runs]
//
// - `held`: the #548 / windsor#300 bench's four parts (`pad-drift`,
//   `horde-horn`, and `pickup-blip` and `hat` with every sustain raised to
//   0.7), three held notes each, 10 s; after the first attacks no segment
//   ends, so this is the steady per-sample cost of the knot test.
// - `hits`: four drum parts (`tr808-kick`, `tr808-clap`, `tr909-snare`,
//   `tr909-hat-closed`), a hit every 125 ms (sixteenths at 120 BPM) gated
//   50 ms, 10 s: each hit's attacks, decays and releases end inside blocks,
//   so the knots and the envelope's carry run on every note.
// Each part renders one after another; a reading is the median of `runs`
// renders of the four, after one warm-up.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const [root, scenario, runsArg] = process.argv.slice(2);
const ENGINE = `${root}/packages/engine/src`;
const SR = 48000;
const BLOCK = 128;
const SECONDS = 10;
const BLOCKS = Math.round((SECONDS * SR) / BLOCK);
const RUNS = Number(runsArg ?? 5);
const HIT_EVERY = 6000;
const HIT_GATE = 2400;

function loadProcessor() {
  const bundle = readFileSync(`${ENGINE}/worklet/generated/fm-processor.js`, 'utf8');
  let Processor = null;
  class PortShim {
    constructor() {
      this.port = { postMessage() {}, onmessage: null };
    }
    inbox(data) {
      this.port.onmessage?.({ data });
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

function patch(id, sustain) {
  const p = { ...JSON.parse(readFileSync(`${ENGINE}/patches/${id}.json`, 'utf8')).patch, spread: 0 };
  if (sustain !== undefined) for (const op of p.ops) op.env = { ...op.env, sustainLevel: sustain };
  return p;
}

const held = (id, sustain) => ({
  patch: patch(id, sustain),
  events: [48, 55, 60].map((note, i) => ({ type: 'noteOn', id: i + 1, note, velocity: 0.9, frame: 0 })),
});

function hits(id) {
  const events = [];
  for (let f = 0, n = 1; f < BLOCKS * BLOCK; f += HIT_EVERY, n++) {
    events.push({ type: 'noteOn', id: n, note: 60, velocity: 0.9, frame: f });
    events.push({ type: 'noteOff', id: n, frame: f + HIT_GATE });
  }
  return { patch: patch(id), events };
}

const SCENARIOS = {
  held: () => [held('pad-drift'), held('horde-horn'), held('pickup-blip', 0.7), held('hat', 0.7)],
  hits: () => [hits('tr808-kick'), hits('tr808-clap'), hits('tr909-snare'), hits('tr909-hat-closed')],
};

const params = {
  pitchBend: new Float32Array([0]),
  modWheel: new Float32Array([0]),
  cutoffMod: new Float32Array([0]),
  gain: new Float32Array([1]),
};
const left = new Float32Array(BLOCK);
const right = new Float32Array(BLOCK);

function renderPart({ patch: p, events }) {
  const processor = new Processor({ processorOptions: { maxVoices: 16, patch: structuredClone(p), seed: 1 } });
  let next = 0;
  const t0 = performance.now();
  for (let b = 0; b < BLOCKS; b++) {
    const start = b * BLOCK;
    scope.setFrame(start);
    while (next < events.length && events[next].frame < start + BLOCK) processor.inbox(events[next++]);
    processor.process([], [[left, right]], params);
  }
  return performance.now() - t0;
}

const median = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
const parts = SCENARIOS[scenario]();
for (const part of parts) renderPart(part);
const totals = [];
for (let r = 0; r < RUNS; r++) totals.push(parts.reduce((sum, part) => sum + renderPart(part), 0));
console.log(`${scenario}: median ${median(totals).toFixed(1)} ms [${totals.map((t) => t.toFixed(0)).join(',')}]`);
