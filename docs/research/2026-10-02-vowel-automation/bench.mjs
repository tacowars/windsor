/* global process, structuredClone */
/**
 * What a vowel lane costs (windsor#406, decision 7): eight held Formant
 * voices of one patch, rendered through the FM bundle under Node, with the
 * vowel held and with a song lane ramping it from 0 (a) to 4 (u) over one
 * bar. Research only. The scenario and the method are windsor#331's bench
 * (`../2026-10-02-formant-filter/bench.mjs`): `pad-drift` with `spread` 0,
 * so one note is one voice, every sustain raised so dormancy never engages,
 * the filter envelope's amount at 0 so nothing but the lane moves the
 * peaks; variants interleaved in rounds, their order rotated, two warm-up
 * rounds.
 *
 *   node bench.mjs <repo> <before root> [--rounds 40] [--seconds 5]
 *
 * A root holds the FM bundle at
 * `packages/engine/src/worklet/generated/fm-processor.js`; `<before root>`
 * holds `origin/main`'s from before the change (`git show`). The lane is
 * slot 0 mapped to `filter.vowel` (`voiceSlots`), its offset written each
 * 128-sample block as the k-rate parameter would carry it: a sawtooth from
 * 0 to 4 over a bar of 2 s (120 bpm), so every block of the render moves
 * the vowel. "lane held" maps the slot and holds it at 1.5. Reported: the
 * median ns per voice per output sample over the rounds, and each variant's
 * median per-round difference from the same bundle's Off in that round
 * (the filter's own cost), with its interquartile range.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const SR = 48000;
const BLOCK = 128;
const WARMUP_ROUNDS = 2;
const NOTES = [43, 48, 52, 55, 59, 62, 64, 67];
const BAR_SECONDS = 2;
const VOWEL_TOP = 4;
const SLOTS = 8;

function parseArgs(argv) {
  const options = { rounds: 40, seconds: 5 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) options[argv[i].slice(2)] = Number(argv[++i]);
    else positional.push(argv[i]);
  }
  if (positional.length !== 2) {
    process.stderr.write('usage: node bench.mjs <repo> <before root> [--rounds n] [--seconds s]\n');
    process.exit(2);
  }
  return { options, roots: positional };
}

/** The processor class and the frame setter of one root's bundle, evaluated once. */
function loadBundle(root) {
  const source = readFileSync(
    join(root, 'packages', 'engine', 'src', 'worklet', 'generated', 'fm-processor.js'),
    'utf8',
  );
  let Processor = null;
  class PortShim {
    constructor() {
      this.port = { postMessage() {}, onmessage: null };
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

/** `pad-drift`, one voice a note, every operator held at its sustain, the filter at `mode`. */
function patchFor(repo, mode) {
  const file = join(repo, 'packages', 'engine', 'src', 'patches', 'pad-drift.json');
  const patch = { ...JSON.parse(readFileSync(file, 'utf8')).patch, spread: 0 };
  for (const op of patch.ops) op.env.sustainLevel = Math.max(op.env.sustainLevel, 0.6);
  patch.filter = { ...patch.filter, mode, slope24: false, vowel: 0, envAmount: 0 };
  return patch;
}

/** Slot 0's offset in block `b`: none, held, or the bar-long ramp from a to u. */
const LANES = {
  none: null,
  held: () => 1.5,
  moving: (b) => {
    const t = ((b * BLOCK) / SR / BAR_SECONDS) % 1;
    return Math.fround(VOWEL_TOP * t);
  },
};

/** Wall time of `seconds` of eight held voices, in ns per voice per output sample. */
function timeOne({ bundle, patch, lane }, seconds) {
  const slotted = lane !== null;
  const processor = new bundle.Processor({
    processorOptions: {
      maxVoices: NOTES.length,
      patch: structuredClone(patch),
      seed: 1,
      ...(slotted ? { voiceSlots: ['filter.vowel'] } : {}),
    },
  });
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const params = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    cutoffMod: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  for (let i = 0; i < SLOTS; i++) params[`voiceSlot${i}`] = new Float32Array([0]);
  const slot = params.voiceSlot0;
  bundle.setFrame(0);
  NOTES.forEach((note, i) =>
    processor.port.onmessage({ data: { type: 'noteOn', id: i + 1, note, velocity: 0.9, frame: 0 } }),
  );
  const blocks = Math.round((seconds * SR) / BLOCK);
  const started = performance.now();
  for (let b = 0; b < blocks; b++) {
    bundle.setFrame(b * BLOCK);
    if (slotted) slot[0] = lane(b);
    processor.process([], [[left, right]], params);
  }
  const elapsed = performance.now() - started;
  const held = processor.voices.filter((v) => v.active && !v.dormant).length;
  if (held !== NOTES.length) throw new Error(`expected ${NOTES.length} sounding voices, got ${held}`);
  return (elapsed * 1e6) / (blocks * BLOCK * NOTES.length);
}

function quantile(values, q) {
  const s = [...values].sort((a, b) => a - b);
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  return s[lo] + (s[Math.ceil(at)] - s[lo]) * (at - lo);
}

function bench(list, { rounds, seconds }) {
  const ns = list.map(() => []);
  const delta = list.map(() => []);
  for (let round = 0; round < rounds + WARMUP_ROUNDS; round++) {
    const times = new Array(list.length);
    for (let k = 0; k < list.length; k++) {
      const i = (k + round) % list.length;
      times[i] = timeOne(list[i], seconds);
    }
    if (round < WARMUP_ROUNDS) continue;
    times.forEach((t, i) => {
      ns[i].push(t);
      delta[i].push(t - times[list[i].offIndex]);
    });
  }
  return list.map((v, i) => ({
    name: v.name,
    ns: quantile(ns[i], 0.5),
    delta: quantile(delta[i], 0.5),
    q1: quantile(delta[i], 0.25),
    q3: quantile(delta[i], 0.75),
  }));
}

function variants(repo, before) {
  const off = patchFor(repo, 0);
  const formant = patchFor(repo, 5);
  const engine = loadBundle(repo);
  const old = loadBundle(before);
  const list = [];
  const rows = [
    ['before', old, [['off', off, 'none'], ['formant held', formant, 'none']]],
    [
      'engine',
      engine,
      [
        ['off', off, 'none'],
        ['formant held', formant, 'none'],
        ['formant lane held', formant, 'held'],
        ['formant lane moving', formant, 'moving'],
      ],
    ],
  ];
  for (const [label, bundle, names] of rows) {
    const offIndex = list.length;
    for (const [name, patch, lane] of names) {
      list.push({ name: `${label} ${name}`, bundle, patch, lane: LANES[lane], offIndex });
    }
  }
  return list;
}

function main() {
  const { options, roots } = parseArgs(process.argv.slice(2));
  const list = variants(roots[0], roots[1]);
  process.stdout.write(
    `node ${process.version}, ${options.rounds} rounds of ${options.seconds} s per variant, ${NOTES.length} voices\n`,
  );
  process.stdout.write('ns per voice-sample, and against its bundle Off (median [IQR])\n');
  const results = bench(list, options);
  for (const r of results) {
    const sign = r.delta >= 0 ? '+' : '';
    const d = `${sign}${r.delta.toFixed(2)} [${r.q1.toFixed(2)}, ${r.q3.toFixed(2)}]`;
    process.stdout.write(`  ${r.name.padEnd(28)} ${r.ns.toFixed(2).padStart(7)}  ${d}\n`);
  }
  const by = (name) => results.find((r) => r.name === name);
  const held = by('engine formant held');
  const moving = by('engine formant lane moving');
  process.stdout.write(
    `\nmoving / held: total ${(moving.ns / held.ns).toFixed(3)}x, filter alone ${(moving.delta / held.delta).toFixed(2)}x\n`,
  );
}

main();
